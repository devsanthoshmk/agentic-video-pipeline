import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {basename, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {openBrowser, renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import {videoRun} from './video-run.mjs';

function usage() {
  console.error(
    'Usage:\n' +
    '  node scripts/review-bundle.mjs pre <composition> [--frames 0,60,120] [--slice 140:180] [--beat-map out/beat-map.json] [--out-dir out/review] [--props JSON] [--scale 1]\n' +
    '  node scripts/review-bundle.mjs post <staged.mp4> [--beat-map out/beat-map.json] [--snapshot-hash H] [--render-spec-hash H] [--out-dir out/review-post]'
  );
  process.exit(2);
}

function hashFileTree(paths) {
  const h = createHash('sha256');
  const walk = (p) => {
    if (!existsSync(p)) return;
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const name of readdirSync(p).sort()) {
        if (name === 'node_modules' || name.startsWith('.bundle-')) continue;
        walk(join(p, name));
      }
    } else if (st.isFile()) {
      h.update(p);
      h.update(readFileSync(p));
    }
  };
  for (const p of paths) walk(p);
  return h.digest('hex');
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function runCmd(cmd, args) {
  const res = spawnSync(cmd, args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`${cmd} failed: ${res.stderr.trim() || res.status}`);
  return res;
}

function buildLabeledContactSheets(frameItems, outDir, width, height) {
  // Place frame/time label in a 32px dark margin banner OUTSIDE video pixels.
  const isPortrait = height > width;
  const cols = isPortrait ? 4 : 3;
  const rows = isPortrait ? 2 : 3;
  const perSheet = cols * rows;
  const cellW = isPortrait ? 320 : 540;
  const cellH = Math.round((cellW * height) / width);
  const sheets = [];

  for (let start = 0; start < frameItems.length; start += perSheet) {
    const chunk = frameItems.slice(start, start + perSheet);
    const sheetIdx = Math.floor(start / perSheet) + 1;
    const sheetPath = join(outDir, `contact-sheet-${sheetIdx}.png`);
    const ffArgs = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'];
    for (const item of chunk) ffArgs.push('-i', item.path);

    const parts = [];
    for (let i = 0; i < chunk.length; i++) {
      const label = `f${chunk[i].frame} (${chunk[i].time_s}s)`.replace(/:/g, '\\:');
      parts.push(
        `[${i}:v]scale=${cellW}:${cellH}:flags=lanczos,` +
        `pad=${cellW}:${cellH + 32}:0:32:color=#0F172A,` +
        `drawtext=text='${label}':x=10:y=8:fontsize=16:fontcolor=white[c${i}]`
      );
    }
    const inputs = chunk.map((_, i) => `[c${i}]`).join('');
    parts.push(`${inputs}xstack=inputs=${chunk.length}:layout=${layoutGrid(chunk.length, cols, cellW, cellH + 32)}:fill=#020617[out]`);
    ffArgs.push('-filter_complex', parts.join(';'), '-map', '[out]', '-frames:v', '1', sheetPath);
    runCmd('ffmpeg', ffArgs);
    sheets.push(sheetPath);
  }
  return sheets;
}

function layoutGrid(count, cols, w, h) {
  const coords = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    coords.push(`${col * w}_${row * h}`);
  }
  return coords.join('|');
}

async function preMode(args) {
  const compositionId = args[0];
  if (!compositionId) usage();
  let explicitFrames = null, sliceStr = null, beatMapPath = null, outDirArg = null, propsJson = '{}', scale = 1;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--frames') explicitFrames = args[++i].split(',').map((s) => Number(s.trim())).filter(Number.isInteger);
    else if (a === '--slice') sliceStr = args[++i];
    else if (a === '--beat-map') beatMapPath = resolve(args[++i]);
    else if (a === '--out-dir') outDirArg = resolve(args[++i]);
    else if (a === '--props') propsJson = args[++i];
    else if (a === '--scale') scale = Number(args[++i]) || 1;
    else usage();
  }

  const root = fileURLToPath(new URL('../', import.meta.url));
  const runDir = videoRun();
  const baseDir = runDir || root;
  const entry = join(baseDir, 'src/index.ts');
  const publicDir = join(baseDir, 'public');
  const outRoot = join(baseDir, 'out');
  const reviewDir = outDirArg || join(outRoot, 'review');
  const stillsDir = join(reviewDir, 'stills');
  const mobileDir = join(reviewDir, 'mobile-360');
  mkdirSync(stillsDir, {recursive: true});
  mkdirSync(mobileDir, {recursive: true});

  const inputProps = JSON.parse(propsJson);
  const renderSpec = {compositionId, inputProps, scale, entry};
  const snapshotHash = hashFileTree([
    join(baseDir, 'src'),
    publicDir,
    join(root, 'src'),
    join(root, 'package.json'),
    join(root, 'package-lock.json'),
    join(root, 'tsconfig.json'),
  ]);
  const renderSpecHash = createHash('sha256').update(JSON.stringify(renderSpec)).digest('hex');

  const bundleDir = join(outRoot, `.bundle-${snapshotHash.slice(0, 12)}`);
  const bundleMarker = join(bundleDir, '.snapshot.json');
  let serveUrl = bundleDir;
  if (!existsSync(bundleMarker) || JSON.parse(readFileSync(bundleMarker, 'utf8')).snapshot_hash !== snapshotHash) {
    rmSync(bundleDir, {recursive: true, force: true});
    mkdirSync(bundleDir, {recursive: true});
    serveUrl = await bundle({
      entryPoint: entry,
      publicDir: existsSync(publicDir) ? publicDir : null,
      outDir: bundleDir,
    });
    writeFileSync(bundleMarker, JSON.stringify({
      snapshot_hash: snapshotHash,
      render_spec_hash: renderSpecHash,
      render_spec: renderSpec,
      created_at: new Date().toISOString(),
    }, null, 2), 'utf8');
  }

  const browser = await openBrowser('chrome');
  try {
    const comp = await selectComposition({serveUrl, id: compositionId, inputProps, puppeteerInstance: browser});
    const maxFrame = Math.max(0, comp.durationInFrames - 1);
    const frameSet = new Set();

    if (explicitFrames && explicitFrames.length > 0) {
      for (const f of explicitFrames) frameSet.add(Math.min(maxFrame, Math.max(0, f)));
    } else {
      frameSet.add(0);
      frameSet.add(Math.round(maxFrame * 0.25));
      frameSet.add(Math.round(maxFrame * 0.5));
      frameSet.add(Math.round(maxFrame * 0.75));
      frameSet.add(maxFrame);
      if (beatMapPath && existsSync(beatMapPath)) {
        const bm = JSON.parse(readFileSync(beatMapPath, 'utf8'));
        for (const seg of (bm.segments || [])) {
          if (Number.isInteger(seg.start_frame)) frameSet.add(Math.min(maxFrame, Math.max(0, seg.start_frame + 5)));
          if (Number.isInteger(seg.end_frame)) frameSet.add(Math.min(maxFrame, Math.max(0, seg.end_frame - 2)));
        }
      }
    }

    const frames = [...frameSet].sort((a, b) => a - b).slice(0, 18);
    const stillItems = [];
    for (const f of frames) {
      const stillPath = join(stillsDir, `frame-${String(f).padStart(5, '0')}.png`);
      await renderStill({
        composition: comp,
        serveUrl,
        output: stillPath,
        frame: f,
        inputProps,
        scale,
        puppeteerInstance: browser,
      });
      stillItems.push({frame: f, time_s: (f / comp.fps).toFixed(2), path: stillPath});
    }

    // Generate 360px playback-width previews for legibility check at mobile feed scale
    const mobileTargets = [stillItems[0], stillItems[Math.floor(stillItems.length / 2)], stillItems[stillItems.length - 1]].filter(Boolean);
    const mobilePreviews = [];
    for (const item of mobileTargets) {
      const mPath = join(mobileDir, basename(item.path));
      runCmd('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-i', item.path, '-vf', 'scale=360:-2:flags=lanczos', '-frames:v', '1', mPath,
      ]);
      mobilePreviews.push(mPath);
    }

    const sheets = buildLabeledContactSheets(stillItems, reviewDir, comp.width * scale, comp.height * scale);

    let slicePath = null;
    if (sliceStr) {
      const [s0, s1] = sliceStr.split(':').map(Number);
      if (!Number.isInteger(s0) || !Number.isInteger(s1) || s0 < 0 || s1 <= s0 || s1 > maxFrame) {
        throw new Error(`Invalid --slice range ${sliceStr} for 0..${maxFrame}`);
      }
      slicePath = join(reviewDir, `slice-${s0}-${s1}.mp4`);
      await renderMedia({
        composition: comp,
        serveUrl,
        codec: 'h264',
        outputLocation: slicePath,
        frameRange: [s0, s1],
        inputProps,
        puppeteerInstance: browser,
        concurrency: 2,
      });
    }

    const manifest = {
      run: runDir || '.',
      snapshot_hash: snapshotHash,
      render_spec_hash: renderSpecHash,
      render_spec: renderSpec,
      bundle_dir: bundleDir,
      composition: {id: comp.id, width: comp.width, height: comp.height, fps: comp.fps, durationInFrames: comp.durationInFrames},
      stills: stillItems,
      mobile_previews: mobilePreviews,
      contact_sheets: sheets,
      transition_slice: slicePath,
    };
    const manifestPath = join(reviewDir, 'review-manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(JSON.stringify(manifest, null, 2));
  } finally {
    await browser.close({silent: true});
  }
}

function postMode(args) {
  const mp4Arg = args[0];
  if (!mp4Arg) usage();
  const mp4 = realpathSync(resolve(mp4Arg));
  let beatMapPath = null, outDirArg = null, snapshotHash = null, renderSpecHash = null, reviewManifestPath = null;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--beat-map') beatMapPath = resolve(args[++i]);
    else if (a === '--out-dir') outDirArg = resolve(args[++i]);
    else if (a === '--snapshot-hash') snapshotHash = args[++i];
    else if (a === '--render-spec-hash') renderSpecHash = args[++i];
    else if (a === '--review-manifest') reviewManifestPath = resolve(args[++i]);
    else usage();
  }

  const runDir = videoRun();
  const baseDir = runDir || fileURLToPath(new URL('../', import.meta.url));
  const outDir = outDirArg || join(baseDir, 'out/review-post');
  const defaultManifest = join(baseDir, 'out/review/review-manifest.json');
  if (reviewManifestPath && !existsSync(reviewManifestPath)) {
    throw new Error(`Review manifest not found: ${reviewManifestPath}`);
  }
  const mPath = reviewManifestPath || (existsSync(defaultManifest) ? defaultManifest : null);
  if ((snapshotHash || renderSpecHash) && !mPath) {
    throw new Error('Cannot validate --snapshot-hash or --render-spec-hash without an existing review-manifest.json.');
  }
  if (mPath && existsSync(mPath)) {
    const pre = JSON.parse(readFileSync(mPath, 'utf8'));
    if (snapshotHash && snapshotHash !== pre.snapshot_hash) {
      throw new Error(`Stale snapshot_hash (${snapshotHash} !== ${pre.snapshot_hash} in ${mPath}). Re-run pre-encode review.`);
    }
    if (renderSpecHash && renderSpecHash !== pre.render_spec_hash) {
      throw new Error(`Stale render_spec_hash (${renderSpecHash} !== ${pre.render_spec_hash} in ${mPath}). Re-run pre-encode review.`);
    }
    snapshotHash = snapshotHash || pre.snapshot_hash;
    renderSpecHash = renderSpecHash || pre.render_spec_hash;
  }
  mkdirSync(outDir, {recursive: true});

  const stagedExportHash = sha256File(mp4);
  const probe = JSON.parse(runCmd('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', mp4]).stdout);
  const vStream = (probe.streams || []).find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const aStream = (probe.streams || []).find((s) => s.codec_type === 'audio');
  if (!vStream) throw new Error('Exported MP4 has no video stream.');

  // Full container/stream decode check across explicitly mapped streams
  runCmd('ffmpeg', ['-hide_banner', '-v', 'error', '-xerror', '-i', mp4, '-map', '0:v:0', ...(aStream ? ['-map', '0:a:0'] : []), '-f', 'null', '-']);

  let audioMetrics = null;
  if (aStream) {
    const eb = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'info', '-nostdin', '-i', mp4, '-map', '0:a:0',
      '-af', 'ebur128=peak=true', '-f', 'null', '-',
    ], {encoding: 'utf8'});
    const mI = eb.stderr.match(/I:\s*(-?[0-9.]+)\s*LUFS/);
    const mLra = eb.stderr.match(/LRA:\s*(-?[0-9.]+)\s*LU/);
    const mTp = eb.stderr.match(/Peak:\s*(-?[0-9.]+)\s*dBFS/);
    audioMetrics = {
      integrated_lufs: mI ? Number(mI[1]) : null,
      lra_lu: mLra ? Number(mLra[1]) : null,
      true_peak_dbtp: mTp ? Number(mTp[1]) : null,
      start_time: Number(aStream.start_time || 0),
    };
  }

  const duration = Number(probe.format?.duration || 0);
  const sampleTimes = [0.2, duration * 0.25, duration * 0.5, duration * 0.75, Math.max(0, duration - 0.3)]
    .map((t) => Number(Math.min(Math.max(0, t), Math.max(0, duration - 0.05)).toFixed(3)));
  const encodedStills = [];
  for (let i = 0; i < sampleTimes.length; i++) {
    const outPng = join(outDir, `encoded-${i + 1}.png`);
    runCmd('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-ss', String(sampleTimes[i]), '-i', mp4, '-frames:v', '1', outPng,
    ]);
    encodedStills.push({frame: Math.round(sampleTimes[i] * 30), time_s: sampleTimes[i].toFixed(2), path: outPng});
  }
  const sheets = buildLabeledContactSheets(encodedStills, outDir, vStream.width, vStream.height);

  let beatMapCheck = null;
  if (beatMapPath) {
    if (!existsSync(beatMapPath)) throw new Error(`Beat map not found: ${beatMapPath}`);
    const bm = JSON.parse(readFileSync(beatMapPath, 'utf8'));
    const segs = bm.segments || [];
    const maxSegEnd = segs.reduce((acc, s) => Math.max(acc, Number(s.end_s || 0)), 0);
    const expectedDur = Math.max(Number(bm.duration_s || 0), maxSegEnd);
    const durDeltaMs = Math.round(Math.abs(duration - expectedDur) * 1000);
    beatMapCheck = {
      beat_map_path: beatMapPath,
      expected_min_duration_s: expectedDur,
      max_segment_end_s: maxSegEnd,
      actual_duration_s: duration,
      duration_delta_ms: durDeltaMs,
      segments_count: segs.length,
      covers_narration: duration + 0.05 >= expectedDur,
    };
    if (!beatMapCheck.covers_narration) {
      throw new Error(`Encoded MP4 duration (${duration}s) is shorter than beat-map extent (${expectedDur}s).`);
    }
  }

  const report = {
    run: runDir || '.',
    snapshot_hash: snapshotHash,
    render_spec_hash: renderSpecHash,
    staged_export: mp4,
    staged_export_hash: stagedExportHash,
    duration_s: duration,
    long_form_sampled_coverage: duration > 180 ? `${sampleTimes.length} anchors sampled` : 'full_anchors',
    video_stream: {
      codec: vStream.codec_name,
      width: vStream.width,
      height: vStream.height,
      fps: vStream.avg_frame_rate,
      pix_fmt: vStream.pix_fmt,
      color_space: vStream.color_space || 'unknown',
    },
    audio_metrics: audioMetrics,
    full_decode_ok: true,
    encoded_stills: encodedStills,
    contact_sheets: sheets,
    beat_map_check: beatMapCheck,
  };
  const rPath = join(outDir, 'post-encode-report.json');
  writeFileSync(rPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

try {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === 'pre') await preMode(rest);
  else if (mode === 'post') postMode(rest);
  else usage();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
