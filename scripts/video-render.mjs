import {createHash} from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {videoRun} from './video-run.mjs';

function usage() {
  throw new Error(
    'Usage:\n' +
    '  VIDEO_RUN=videos/<run> node scripts/video-render.mjs preview [--port 3000]\n' +
    '  VIDEO_RUN=videos/<run> node scripts/video-render.mjs preview-stop\n' +
    '  VIDEO_RUN=videos/<run> node scripts/video-render.mjs render <composition> <filename.mp4> [cpu|gpu] [--bundle <bundleDir>] [--review-manifest <review-manifest.json>] [--concurrency N] [--stage-only]\n' +
    '  VIDEO_RUN=videos/<run> node scripts/video-render.mjs publish <staged.mp4> <filename.mp4> --review-manifest <review-manifest.json> --post-report <post-encode-report.json>\n' +
    '  VIDEO_RUN=videos/<run> node scripts/video-render.mjs export <input.mp4> <youtube-1080p|linkedin-1080p|shorts-1080x1920|square-1080x1080> <out.mp4> [--fit contain|cover] [--encoder libx264|nvenc] [--assume-sdr]'
  );
}

function runSyncOrThrow(cmd, args) {
  const res = spawnSync(cmd, args, {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024});
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`${cmd} failed: ${res.stderr.trim() || res.status}`);
  return res;
}

function previewCmd(dir, params) {
  let port = '3000';
  for (let i = 0; i < params.length; i++) {
    if (params[i] === '--port') port = params[++i];
    else usage();
  }
  const entry = join(dir, 'src/index.ts');
  const publicDir = `--public-dir=${join(dir, 'public')}`;
  const cli = fileURLToPath(new URL('../node_modules/@remotion/cli/remotion-cli.js', import.meta.url));
  const pidPath = join(dir, 'out/.studio.pid');
  mkdirSync(join(dir, 'out'), {recursive: true});

  const child = spawn(
    process.execPath,
    [cli, 'studio', entry, publicDir, '--no-open', `--port=${port}`],
    {
      stdio: 'inherit',
      env: {...process.env, HOST: '127.0.0.1'},
    }
  );
  writeFileSync(pidPath, String(child.pid), 'utf8');
  const cleanup = () => {
    try { rmSync(pidPath, {force: true}); } catch {}
  };
  process.on('SIGINT', () => { child.kill('SIGTERM'); cleanup(); });
  process.on('SIGTERM', () => { child.kill('SIGTERM'); cleanup(); });
  child.on('exit', (code) => {
    cleanup();
    process.exitCode = code ?? 0;
  });
}

function previewStopCmd(dir) {
  const pidPath = join(dir, 'out/.studio.pid');
  if (!existsSync(pidPath)) {
    console.log('No active Studio PID file.');
    return;
  }
  const pid = Number(readFileSync(pidPath, 'utf8').trim());
  try {
    process.kill(pid, 'SIGTERM');
  } catch {}
  rmSync(pidPath, {force: true});
  console.log(`Stopped Studio PID ${pid}`);
}

function renderChildWorkerScript() {
  return `
import {openBrowser, renderMedia, selectComposition} from '@remotion/renderer';
const [serveUrl, id, outPath, concurrencyStr, mode, propsJson] = process.argv.slice(2);
const concurrency = Number(concurrencyStr);
const inputProps = propsJson ? JSON.parse(propsJson) : {};
const browser = await openBrowser('chrome');
try {
  const comp = await selectComposition({serveUrl, id, inputProps, puppeteerInstance: browser});
  await renderMedia({
    composition: comp,
    serveUrl,
    codec: 'h264',
    outputLocation: outPath,
    concurrency,
    inputProps,
    puppeteerInstance: browser,
    hardwareAcceleration: mode === 'gpu' ? 'required' : 'disable',
    ...(mode === 'gpu' ? {videoBitrate: '8M'} : {}),
  });
} finally {
  await browser.close({silent: true});
}
`;
}

function runWorkerProcessGroup(cmd, args, cwd, attemptTmpDir) {
  return new Promise((resolvePromise) => {
    let cancelled = false;
    const child = spawn(cmd, args, {
      cwd,
      detached: true,
      stdio: 'inherit',
      env: {...process.env, TMPDIR: attemptTmpDir},
    });
    const killGroupAndBrowsers = () => {
      if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      }
      // Remotion/Puppeteer puts Chrome's profile under TMPDIR (even when Chrome calls setsid).
      spawnSync('pkill', ['-KILL', '-f', attemptTmpDir], {stdio: 'ignore'});
    };
    const onSig = () => {
      cancelled = true;
      killGroupAndBrowsers();
    };
    process.once('SIGINT', onSig);
    process.once('SIGTERM', onSig);
    child.on('exit', (status, signal) => {
      process.removeListener('SIGINT', onSig);
      process.removeListener('SIGTERM', onSig);
      killGroupAndBrowsers();
      resolvePromise({status, signal, cancelled});
    });
  });
}

function hashSourceSnapshot(root, dir) {
  const h = createHash('sha256');
  const walk = (p) => {
    if (!existsSync(p)) return;
    const entries = spawnSync('find', [p, '-maxdepth', '6', '-not', '-path', '*/node_modules*', '-not', '-path', '*/.bundle-*', '-type', 'f'], {encoding: 'utf8'}).stdout
      .split('\n').filter(Boolean).sort();
    for (const f of entries) {
      h.update(f);
      h.update(readFileSync(f));
    }
  };
  walk(join(dir, 'src'));
  walk(join(dir, 'public'));
  for (const f of [join(root, 'package.json'), join(root, 'package-lock.json'), join(root, 'tsconfig.json')]) {
    if (existsSync(f)) {
      h.update(f);
      h.update(readFileSync(f));
    }
  }
  return h.digest('hex');
}

async function renderCmd(dir, params) {
  const [composition, filename, ...rest] = params;
  if (!composition || !/^[A-Za-z0-9_-]+$/.test(composition) || !filename || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.mp4$/.test(filename)) {
    usage();
  }
  let mode = 'cpu', bundleDir = null, reviewManifestPath = null, requestedConc = Number(process.env.REMOTION_CONCURRENCY || 2), stageOnly = false;
  for (let i = 0; i < rest.length; i++) {
    if (['cpu', 'gpu'].includes(rest[i])) mode = rest[i];
    else if (rest[i] === '--bundle') bundleDir = resolve(rest[++i]);
    else if (rest[i] === '--review-manifest') reviewManifestPath = resolve(rest[++i]);
    else if (rest[i] === '--concurrency') requestedConc = Math.max(1, Number(rest[++i]) || 2);
    else if (rest[i] === '--stage-only') stageOnly = true;
    else usage();
  }

  const rootDir = fileURLToPath(new URL('../', import.meta.url));
  let inputProps = {};
  if (reviewManifestPath) {
    if (!existsSync(reviewManifestPath)) throw new Error(`Review manifest not found: ${reviewManifestPath}`);
    const manifest = JSON.parse(readFileSync(reviewManifestPath, 'utf8'));
    if (!bundleDir) bundleDir = manifest.bundle_dir;
    inputProps = manifest.render_spec?.inputProps || {};
    const recomputedSpecHash = createHash('sha256').update(JSON.stringify(manifest.render_spec || {})).digest('hex');
    if (recomputedSpecHash !== manifest.render_spec_hash) {
      throw new Error(`Tampered or mismatched render_spec in ${reviewManifestPath} (${recomputedSpecHash} !== ${manifest.render_spec_hash}).`);
    }
    const markerPath = join(bundleDir, '.snapshot.json');
    if (!existsSync(markerPath)) throw new Error(`Missing bundle snapshot marker in ${bundleDir}`);
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
    if (marker.snapshot_hash !== manifest.snapshot_hash) {
      throw new Error(`Stale bundle snapshot (${marker.snapshot_hash} !== ${manifest.snapshot_hash}). Re-run video:review -- pre.`);
    }
    if (marker.render_spec_hash !== recomputedSpecHash) {
      throw new Error(`Stale render_spec_hash (${marker.render_spec_hash} !== ${recomputedSpecHash}). Re-run video:review -- pre.`);
    }
    if (manifest.render_spec?.compositionId && manifest.render_spec.compositionId !== composition) {
      throw new Error(`Manifest composition mismatch (${manifest.render_spec.compositionId} !== ${composition}).`);
    }
  } else if (bundleDir) {
    const markerPath = join(bundleDir, '.snapshot.json');
    if (!existsSync(markerPath)) throw new Error(`Missing bundle snapshot marker in ${bundleDir}; pass verified bundle from video:review -- pre.`);
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
    if (marker.render_spec?.compositionId && marker.render_spec.compositionId !== composition) {
      throw new Error(`Bundle render_spec composition mismatch (${marker.render_spec.compositionId} !== ${composition}).`);
    }
    inputProps = marker.render_spec?.inputProps || {};
  }

  const outRoot = join(dir, 'out');
  mkdirSync(outRoot, {recursive: true});
  const dest = join(outRoot, filename);
  if (existsSync(dest)) throw new Error(`Output already exists: ${dest}`);

  // If no verified bundle was passed, prepare one once via @remotion/bundler
  if (!bundleDir) {
    const {bundle} = await import('@remotion/bundler');
    const entry = join(dir, 'src/index.ts');
    const publicDir = join(dir, 'public');
    const tmpBundle = mkdtempSync(join(outRoot, '.bundle-tmp-'));
    bundleDir = await bundle({
      entryPoint: entry,
      publicDir: existsSync(publicDir) ? publicDir : null,
      outDir: tmpBundle,
    });
    process.on('exit', () => {
      try { rmSync(tmpBundle, {recursive: true, force: true}); } catch {}
    });
  }

  // External supervisor with stepped-down OOM recovery (requested -> 2 -> 1)
  const ladder = [...new Set([requestedConc, Math.min(2, requestedConc), 1])].sort((a, b) => b - a);
  let lastErr = null;
  const simKillFirst = process.env.VIDEO_TEST_KILL_CONCURRENCY_ONCE === '1';

  for (const conc of ladder) {
    const tempDir = mkdtempSync(join(outRoot, `.render-${process.pid}-`));
    const attemptTmp = join(tempDir, 'tmp');
    mkdirSync(attemptTmp, {recursive: true});
    const stagedPath = join(tempDir, filename);
    const workerFile = join(tempDir, 'worker.mjs');
    writeFileSync(workerFile, renderChildWorkerScript(), 'utf8');

    const childRes = simKillFirst && conc === ladder[0] && ladder.length > 1
      ? {status: null, signal: 'SIGKILL', cancelled: false}
      : await runWorkerProcessGroup(
          process.execPath,
          [workerFile, bundleDir, composition, stagedPath, String(conc), mode, JSON.stringify(inputProps)],
          rootDir,
          attemptTmp
        );

    if (childRes.cancelled) {
      rmSync(tempDir, {recursive: true, force: true});
      throw new Error('Render cancelled by signal.');
    }

    if (childRes.status === 0 && existsSync(stagedPath)) {
      runSyncOrThrow('ffmpeg', ['-hide_banner', '-v', 'error', '-xerror', '-i', stagedPath, '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-']);
      const hash = createHash('sha256').update(readFileSync(stagedPath)).digest('hex');
      if (stageOnly) {
        const stagedOut = join(outRoot, `.staged-${process.pid}-${filename}`);
        linkSync(stagedPath, stagedOut);
        rmSync(tempDir, {recursive: true, force: true});
        console.log(JSON.stringify({staged_path: stagedOut, staged_export_hash: hash, concurrency: conc, mode}, null, 2));
        return;
      }
      linkSync(stagedPath, dest);
      rmSync(tempDir, {recursive: true, force: true});
      console.log(JSON.stringify({output: dest, sha256: hash, concurrency: conc, mode}, null, 2));
      return;
    }

    lastErr = new Error(`Render worker failed at concurrency=${conc} (status=${childRes.status}, signal=${childRes.signal})`);
    rmSync(tempDir, {recursive: true, force: true});
    console.error(`${lastErr.message}; retrying at lower concurrency if available...`);
  }

  throw lastErr || new Error('Render failed at concurrency=1');
}

function exportPresetCmd(dir, params) {
  const [inArg, preset, outName, ...rest] = params;
  if (!inArg || !preset || !outName || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.mp4$/.test(outName)) usage();
  const presets = {
    'youtube-1080p': {w: 1920, h: 1080, lufs: -14, tp: -1.0, maxrate: '12M', bufsize: '24M'},
    'linkedin-1080p': {w: 1920, h: 1080, lufs: -14, tp: -1.5, maxrate: '10M', bufsize: '20M'},
    'shorts-1080x1920': {w: 1080, h: 1920, lufs: -14, tp: -1.0, maxrate: '10M', bufsize: '20M'},
    'square-1080x1080': {w: 1080, h: 1080, lufs: -14, tp: -1.0, maxrate: '10M', bufsize: '20M'},
  };
  const cfg = presets[preset];
  if (!cfg) throw new Error(`Unknown preset ${preset}`);

  let fit = 'contain', encoder = 'libx264', assumeSdr = false;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--fit') fit = rest[++i];
    else if (rest[i] === '--encoder') encoder = rest[++i];
    else if (rest[i] === '--assume-sdr') assumeSdr = true;
    else usage();
  }
  if (!['contain', 'cover'].includes(fit)) throw new Error('--fit must be contain or cover (use Remotion for recompose)');
  if (!['libx264', 'nvenc'].includes(encoder)) throw new Error('--encoder must be libx264 or nvenc');

  const input = realpathSync(resolve(inArg));
  const outRoot = join(dir, 'out');
  mkdirSync(outRoot, {recursive: true});
  const dest = join(outRoot, outName);
  if (existsSync(dest)) throw new Error(`Output already exists: ${dest}`);

  const info = JSON.parse(runSyncOrThrow('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', input]).stdout);
  const v = (info.streams || []).find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const a = (info.streams || []).find((s) => s.codec_type === 'audio');
  if (!v) throw new Error('Input has no video stream.');

  const trc = v.color_transfer || 'unknown';
  const primaries = v.color_primaries || 'unknown';
  const isHdr = ['smpte2084', 'arib-std-b67'].includes(trc) || primaries === 'bt2020';
  const sdrTrc = ['bt709', 'iec61966-2-1', 'smpte170m'].includes(trc);
  const sdrPrim = ['bt709', 'smpte170m'].includes(primaries);
  const sdrSpace = ['bt709', 'smpte170m'].includes(v.color_space || 'unknown');
  const isKnownSdr = sdrTrc && sdrPrim && sdrSpace;
  if (!isHdr && !isKnownSdr && !assumeSdr) {
    throw new Error(
      `Input color tags are incomplete/unknown (space=${v.color_space}, transfer=${trc}, primaries=${primaries}). Pass --assume-sdr to confirm SDR source.`
    );
  }

  const fitFilter = fit === 'contain'
    ? `scale=${cfg.w}:${cfg.h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${cfg.w}:${cfg.h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`
    : `scale=${cfg.w}:${cfg.h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${cfg.w}:${cfg.h},setsar=1`;

  const colorFilter = isHdr
    ? 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p'
    : 'format=yuv420p';

  const tempDir = mkdtempSync(join(outRoot, `.export-${process.pid}-`));
  const staged = join(tempDir, outName);
  try {
    const ffArgs = [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', input,
      '-vf', `${fitFilter},${colorFilter}`,
      '-map', '0:v:0',
    ];
    if (encoder === 'nvenc') {
      ffArgs.push('-c:v', 'h264_nvenc', '-preset', 'p6', '-rc', 'vbr', '-cq', '18', '-maxrate', cfg.maxrate, '-bufsize', cfg.bufsize);
    } else {
      ffArgs.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-maxrate', cfg.maxrate, '-bufsize', cfg.bufsize);
    }
    ffArgs.push('-profile:v', 'high', '-g', '60', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709');
    if (a) {
      ffArgs.push('-map', '0:a:0', '-af', `loudnorm=I=${cfg.lufs}:TP=${cfg.tp}:LRA=7`, '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2');
    }
    ffArgs.push('-movflags', '+faststart', staged);
    runSyncOrThrow('ffmpeg', ffArgs);
    runSyncOrThrow('ffmpeg', ['-hide_banner', '-v', 'error', '-xerror', '-i', staged, '-map', '0:v:0', ...(a ? ['-map', '0:a:0'] : []), '-f', 'null', '-']);
    linkSync(staged, dest);
    console.log(JSON.stringify({output: dest, preset, fit, encoder, hdr_tonemapped: isHdr}, null, 2));
  } finally {
    rmSync(tempDir, {recursive: true, force: true});
  }
}

function publishCmd(dir, params) {
  const [stagedArg, outName, ...rest] = params;
  if (!stagedArg || !outName || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.mp4$/.test(outName)) usage();
  let reviewManifestPath = null, postReportPath = null;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--review-manifest') reviewManifestPath = resolve(rest[++i]);
    else if (rest[i] === '--post-report') postReportPath = resolve(rest[++i]);
    else usage();
  }
  if (!reviewManifestPath || !postReportPath) {
    throw new Error('publish requires --review-manifest <review-manifest.json> and --post-report <post-encode-report.json>.');
  }
  const staged = realpathSync(resolve(stagedArg));
  const stagedHash = createHash('sha256').update(readFileSync(staged)).digest('hex');
  const pre = JSON.parse(readFileSync(reviewManifestPath, 'utf8'));
  const post = JSON.parse(readFileSync(postReportPath, 'utf8'));
  const recomputedSpecHash = createHash('sha256').update(JSON.stringify(pre.render_spec || {})).digest('hex');
  if (recomputedSpecHash !== pre.render_spec_hash) {
    throw new Error(`Tampered render_spec in ${reviewManifestPath} (${recomputedSpecHash} !== ${pre.render_spec_hash}).`);
  }
  if (!post.full_decode_ok) throw new Error('Post-encode report did not pass full decode.');
  if (post.snapshot_hash !== pre.snapshot_hash || post.render_spec_hash !== pre.render_spec_hash) {
    throw new Error(`Stale QA hash mismatch between pre (${pre.snapshot_hash}/${pre.render_spec_hash}) and post (${post.snapshot_hash}/${post.render_spec_hash}).`);
  }
  if (post.staged_export_hash !== stagedHash) {
    throw new Error(`Staged file hash mismatch (${post.staged_export_hash} !== ${stagedHash}).`);
  }
  const dest = join(dir, 'out', outName);
  if (existsSync(dest)) throw new Error(`Output already exists: ${dest}`);
  linkSync(staged, dest);
  console.log(JSON.stringify({published: dest, sha256: stagedHash, snapshot_hash: pre.snapshot_hash, render_spec_hash: pre.render_spec_hash}, null, 2));
}

try {
  const [action, ...params] = process.argv.slice(2);
  const dir = videoRun();
  if (!dir) throw new Error('Set VIDEO_RUN to the path returned by video:new.');
  if (action === 'preview') previewCmd(dir, params);
  else if (action === 'preview-stop') previewStopCmd(dir);
  else if (action === 'render') await renderCmd(dir, params);
  else if (action === 'publish') publishCmd(dir, params);
  else if (action === 'export') exportPresetCmd(dir, params);
  else usage();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
