import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {videoRun} from './video-run.mjs';

const runDir = videoRun();
const outDir = runDir ? join(runDir, 'out') : fileURLToPath(new URL('../out/', import.meta.url));
const usage =
  'Usage:\n' +
  '  node scripts/media.mjs probe <local-file>\n' +
  '  node scripts/media.mjs trim <local-file> <start-seconds> <duration-seconds> <filename.mp4>\n' +
  '  node scripts/media.mjs concat <filename.mp4> <clip1> <clip2> [...] [--normalize]\n' +
  '  node scripts/media.mjs speed <local-file> <factor> <filename.mp4>\n' +
  '  node scripts/media.mjs mix <video-or-audio> <vo.wav> <filename.mp4> [--bed <music.wav>] [--vo-offset 0.5] [--bed-gain 0.13] [--bed-idle-gain 0.22] [--manifest <out.json>]\n' +
  '  node scripts/media.mjs captions <local-file> <subtitles.srt> <filename.mp4> [--mode soft|burn]';

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error?.code === 'ENOENT') throw new Error(`${command} not found on PATH`);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr.trim() || result.signal || result.status}`);
  }
  return result;
}

function localFile(path) {
  const file = realpathSync(resolve(path));
  if (!statSync(file).isFile()) throw new Error('Input must be a regular local file');
  return file;
}

function ensureOutFilename(filename) {
  if (!/^[^/\\:\x00-\x1f\x7f]+\.mp4$/i.test(filename) || !filename.toLowerCase().endsWith('.mp4')) {
    throw new Error('Output must be a plain .mp4 filename, not a path');
  }
}

function atomicPublish(stagedPath, filename) {
  mkdirSync(outDir, {recursive: true});
  if (!lstatSync(resolve(outDir)).isDirectory()) throw new Error('out/ must be a real directory');
  const destination = join(outDir, filename);
  try {
    linkSync(stagedPath, destination);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Output already exists: ${filename}`);
    throw error;
  }
  return destination;
}

function parseFrac(frac) {
  if (!frac || !frac.includes('/')) return Number(frac) || 0;
  const [n, d] = frac.split('/').map(Number);
  return d ? n / d : 0;
}

function summarizeProbe(info) {
  const streams = info.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audios = streams.filter((s) => s.codec_type === 'audio');
  const subs = streams.filter((s) => s.codec_type === 'subtitle');
  const rFps = v ? parseFrac(v.r_frame_rate) : 0;
  const avgFps = v ? parseFrac(v.avg_frame_rate) : 0;
  const vfr = Boolean(v && rFps > 0 && avgFps > 0 && Math.abs(rFps - avgFps) > 0.2);
  const rotationSide = v?.side_data_list?.find((sd) => sd.rotation !== undefined)?.rotation;
  const rotation = Number(v?.tags?.rotate ?? rotationSide ?? 0);
  const trc = v?.color_transfer || 'unknown';
  const primaries = v?.color_primaries || 'unknown';
  const hdr = ['smpte2084', 'arib-std-b67'].includes(trc) || primaries === 'bt2020';
  return {
    duration_s: Number(info.format?.duration || 0),
    vfr,
    r_fps: rFps ? Number(rFps.toFixed(3)) : null,
    avg_fps: avgFps ? Number(avgFps.toFixed(3)) : null,
    rotation,
    hdr,
    color: v ? {space: v.color_space || 'unknown', transfer: trc, primaries, range: v.color_range || 'unknown'} : null,
    video_streams: v ? 1 : 0,
    audio_streams: audios.length,
    subtitle_streams: subs.length,
  };
}

function probe(file) {
  const res = run('ffprobe', [
    '-v', 'error', '-protocol_whitelist', 'file', '-show_format', '-show_streams', '-of', 'json', '-i', file,
  ]);
  const info = JSON.parse(res.stdout);
  info.summary = summarizeProbe(info);
  return info;
}

function seconds(text, label) {
  const parts = /^(\d+)(?:\.(\d{1,6}))?$|^\.(\d{1,6})$/.exec(text);
  if (!parts || parts[0] !== text) {
    throw new Error(`${label} must be non-negative decimal seconds (up to 6 decimal places)`);
  }
  const micros = BigInt(parts[1] ?? 0) * 1_000_000n + BigInt((parts[2] ?? parts[3] ?? '').padEnd(6, '0'));
  if (micros > 9_223_372_036_854_775_807n) throw new Error(`${label} is too large`);
  return micros;
}

function hasVideo(info) {
  return info.streams?.some((stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
}

function hasAudio(info) {
  return info.streams?.some((stream) => stream.codec_type === 'audio');
}

function trim(file, start, duration, filename) {
  ensureOutFilename(filename);
  const offset = seconds(start, 'Start');
  const length = seconds(duration, 'Duration');
  if (length === 0n) throw new Error('Duration must be greater than zero');

  const info = probe(file);
  if (!hasVideo(info)) throw new Error('Input has no video stream');
  const available = seconds(info.format?.duration ?? '', 'Input duration');
  if (offset >= available || offset + length > available) {
    throw new Error(`Requested interval exceeds input duration (${info.format.duration} seconds)`);
  }

  mkdirSync(outDir, {recursive: true});
  if (!lstatSync(resolve(outDir)).isDirectory()) throw new Error('out/ must be a real directory');
  const tempDir = mkdtempSync(join(outDir, '.trim-'));
  const staged = join(tempDir, 'clip.mp4');
  try {
    run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-protocol_whitelist', 'file',
      '-ss', `${offset}us`, '-i', file, '-t', `${length}us`, '-map', '0:V:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', staged,
    ]);
    if (!hasVideo(probe(staged))) throw new Error('Trim produced no video frames');
    const destination = atomicPublish(staged, filename);
    console.log(destination);
  } finally {
    rmSync(tempDir, {recursive: true, force: true});
  }
}

function concat(args) {
  const normalize = args.includes('--normalize');
  const positional = args.filter((a) => a !== '--normalize');
  const [filename, ...inputPaths] = positional;
  if (!filename || inputPaths.length < 2) throw new Error(usage);
  ensureOutFilename(filename);

  const files = inputPaths.map(localFile);
  const infos = files.map(probe);
  const sigs = infos.map((info) => {
    const v = info.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
    const a = info.streams.find((s) => s.codec_type === 'audio');
    if (!v) throw new Error('All concat inputs must contain a video stream.');
    return {
      vCodec: v.codec_name,
      width: v.width,
      height: v.height,
      pixFmt: v.pix_fmt,
      fps: v.avg_frame_rate,
      hasAudio: Boolean(a),
      aCodec: a?.codec_name || null,
      aRate: a?.sample_rate || null,
      aChannels: a?.channels || null,
    };
  });

  const base = sigs[0];
  const mismatch = sigs.slice(1).findIndex(
    (s) =>
      s.vCodec !== base.vCodec ||
      s.width !== base.width ||
      s.height !== base.height ||
      s.fps !== base.fps ||
      s.hasAudio !== base.hasAudio ||
      s.aRate !== base.aRate ||
      s.aChannels !== base.aChannels
  );

  if (mismatch !== -1 && !normalize) {
    throw new Error(
      `Concat stream mismatch between clip 1 and clip ${mismatch + 2} (${JSON.stringify(base)} vs ${JSON.stringify(sigs[mismatch + 1])}). Re-run with --normalize to conform streams.`
    );
  }

  mkdirSync(outDir, {recursive: true});
  const tempDir = mkdtempSync(join(outDir, '.concat-'));
  const staged = join(tempDir, 'concat.mp4');
  try {
    if (mismatch === -1 && !normalize) {
      const listPath = join(tempDir, 'list.txt');
      writeFileSync(listPath, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
      run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
        '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', staged,
      ]);
    } else {
      const targetW = base.width;
      const targetH = base.height;
      const targetFps = Math.max(1, Math.round(parseFrac(base.fps) || 30));
      const anyAudio = sigs.some((s) => s.hasAudio);
      const ffArgs = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n'];
      for (const f of files) ffArgs.push('-i', f);
      const parts = [];
      for (let i = 0; i < files.length; i++) {
        parts.push(
          `[${i}:v:0]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${targetFps},format=yuv420p[v${i}]`
        );
        if (anyAudio) {
          if (sigs[i].hasAudio) {
            parts.push(`[${i}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
          } else {
            const dur = Math.max(0.05, Number(infos[i].format?.duration || 1));
            parts.push(`anullsrc=r=48000:cl=stereo:d=${dur}[a${i}]`);
          }
        }
      }
      const joinInputs = files.map((_, i) => (anyAudio ? `[v${i}][a${i}]` : `[v${i}]`)).join('');
      parts.push(`${joinInputs}concat=n=${files.length}:v=1:a=${anyAudio ? 1 : 0}[vout]${anyAudio ? '[aout]' : ''}`);
      ffArgs.push('-filter_complex', parts.join(';'), '-map', '[vout]');
      if (anyAudio) ffArgs.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '192k');
      ffArgs.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', staged);
      run('ffmpeg', ffArgs);
    }
    const destination = atomicPublish(staged, filename);
    console.log(destination);
  } finally {
    rmSync(tempDir, {recursive: true, force: true});
  }
}

function buildAtempoChain(factor) {
  const filters = [];
  let rem = factor;
  while (rem > 2.0) {
    filters.push('atempo=2.0');
    rem /= 2.0;
  }
  while (rem < 0.5) {
    filters.push('atempo=0.5');
    rem /= 0.5;
  }
  filters.push(`atempo=${rem.toFixed(6)}`);
  return filters.join(',');
}

function speed(file, factorStr, filename) {
  ensureOutFilename(filename);
  const factor = Number(factorStr);
  if (!Number.isFinite(factor) || factor < 0.5 || factor > 4.0) {
    throw new Error('Speed factor must be between 0.5 and 4.0');
  }
  const info = probe(file);
  if (!hasVideo(info)) throw new Error('Input has no video stream');

  mkdirSync(outDir, {recursive: true});
  const tempDir = mkdtempSync(join(outDir, '.speed-'));
  const staged = join(tempDir, 'speed.mp4');
  try {
    const ffArgs = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', file];
    const hasA = hasAudio(info);
    const vFilter = `[0:v:0]setpts=PTS/${factor.toFixed(6)}[vout]`;
    if (hasA) {
      const aFilter = `[0:a:0]${buildAtempoChain(factor)}[aout]`;
      ffArgs.push('-filter_complex', `${vFilter};${aFilter}`, '-map', '[vout]', '-map', '[aout]', '-c:a', 'aac', '-b:a', '256k');
    } else {
      ffArgs.push('-filter_complex', vFilter, '-map', '[vout]');
    }
    ffArgs.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', staged);
    run('ffmpeg', ffArgs);
    const destination = atomicPublish(staged, filename);
    console.log(destination);
  } finally {
    rmSync(tempDir, {recursive: true, force: true});
  }
}

function mix(args) {
  const [videoArg, voArg, filename, ...rest] = args;
  if (!videoArg || !voArg || !filename) throw new Error(usage);
  ensureOutFilename(filename);
  const videoFile = localFile(videoArg);
  const voFile = localFile(voArg);
  let bedFile = null, voOffset = 0.5, bedGain = 0.13, bedIdleGain = 0.22, manifestOut = null;
  const attack = 0.12, release = 0.35;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--bed') bedFile = localFile(rest[++i]);
    else if (rest[i] === '--vo-offset') voOffset = Number(rest[++i]);
    else if (rest[i] === '--bed-gain') bedGain = Number(rest[++i]);
    else if (rest[i] === '--bed-idle-gain') bedIdleGain = Number(rest[++i]);
    else if (rest[i] === '--manifest') manifestOut = resolve(rest[++i]);
    else throw new Error(usage);
  }

  const vInfo = probe(videoFile);
  if (!hasVideo(vInfo)) throw new Error('Video input must contain a video stream.');
  const voInfo = probe(voFile);
  if (!hasAudio(voInfo)) throw new Error('VO input must contain an audio stream.');
  const totalDur = Number(vInfo.format?.duration || 0);
  const voDur = Number(voInfo.format?.duration || 0);
  const delayMs = Math.max(0, Math.round(voOffset * 1000));

  mkdirSync(outDir, {recursive: true});
  const tempDir = mkdtempSync(join(outDir, '.mix-'));
  const mixWav = join(tempDir, 'mix.wav');
  const staged = join(tempDir, 'mixed.mp4');
  try {
    if (bedFile) {
      const tStart = voOffset;
      const tEnd = voOffset + voDur;
      const a0 = Math.max(0, tStart - attack);
      const r1 = tEnd + release;
      // Deterministic time-keyed gain envelope (no stateful ducker drift).
      const volExpr =
        `if(lt(t,${a0.toFixed(3)}),${bedIdleGain},` +
        `if(lt(t,${tStart.toFixed(3)}),${bedIdleGain}+(${bedGain}-${bedIdleGain})*(t-${a0.toFixed(3)})/${attack.toFixed(3)},` +
        `if(lt(t,${tEnd.toFixed(3)}),${bedGain},` +
        `if(lt(t,${r1.toFixed(3)}),${bedGain}+(${bedIdleGain}-${bedGain})*(t-${tEnd.toFixed(3)})/${release.toFixed(3)},${bedIdleGain}))))`;
      const fc =
        `[0:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${delayMs}|${delayMs},apad[vo];` +
        `[1:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${totalDur.toFixed(6)},asetpts=PTS-STARTPTS,` +
        `volume='${volExpr}':eval=frame,afade=t=out:st=${Math.max(0, totalDur - 1.5).toFixed(3)}:d=1.5[bed];` +
        `[vo][bed]amix=inputs=2:duration=longest:normalize=0,atrim=0:${totalDur.toFixed(6)},asetpts=PTS-STARTPTS[mix]`;
      run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-i', voFile, '-i', bedFile, '-filter_complex', fc, '-map', '[mix]',
        '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', mixWav,
      ]);
    } else {
      run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-i', voFile, '-af', `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${delayMs}|${delayMs},apad,atrim=0:${totalDur.toFixed(6)}`,
        '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', mixWav,
      ]);
    }

    run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
      '-i', videoFile, '-i', mixWav,
      '-map', '0:v:0', '-map', '1:a:0', '-map', '0:s?', '-map_metadata', '0', '-map_chapters', '0',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-c:s', 'copy', '-movflags', '+faststart', staged,
    ]);
    const destination = atomicPublish(staged, filename);
    const hash = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
    const manifest = {
      video_source: videoFile,
      vo_stem: voFile,
      vo_sha256: hash(voFile),
      bed_stem: bedFile,
      bed_sha256: bedFile ? hash(bedFile) : null,
      vo_offset_s: voOffset,
      vo_duration_s: voDur,
      total_duration_s: totalDur,
      bed_gain: bedGain,
      bed_idle_gain: bedIdleGain,
      attack_s: attack,
      release_s: release,
      fade_out_s: 1.5,
      output_mp4: destination,
    };
    const mPath = manifestOut || join(outDir, `${filename}.mix-manifest.json`);
    writeFileSync(mPath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(JSON.stringify({output: destination, mix_manifest: mPath}, null, 2));
  } finally {
    rmSync(tempDir, {recursive: true, force: true});
  }
}

function captions(args) {
  const [inArg, srtArg, filename, ...rest] = args;
  if (!inArg || !srtArg || !filename) throw new Error(usage);
  ensureOutFilename(filename);
  const file = localFile(inArg);
  const srt = localFile(srtArg);
  let mode = 'soft';
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--mode') mode = rest[++i];
    else throw new Error(usage);
  }
  if (!['soft', 'burn'].includes(mode)) throw new Error('--mode must be soft or burn');

  mkdirSync(outDir, {recursive: true});
  const tempDir = mkdtempSync(join(outDir, '.captions-'));
  const staged = join(tempDir, 'captioned.mp4');
  try {
    if (mode === 'soft') {
      run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
        '-i', file, '-i', srt,
        '-map', '0:v:0', '-map', '0:a?', '-map', '1:0',
        '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text',
        '-metadata:s:s:0', 'language=eng', '-movflags', '+faststart', staged,
      ]);
    } else {
      const escaped = srt.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
      run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
        '-i', file,
        '-vf', `subtitles='${escaped}':force_style='FontName=Open Sans,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,MarginV=36'`,
        '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'copy',
        '-movflags', '+faststart', staged,
      ]);
    }
    const destination = atomicPublish(staged, filename);
    console.log(destination);
  } finally {
    rmSync(tempDir, {recursive: true, force: true});
  }
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'probe' && args.length === 1) {
    console.log(JSON.stringify(probe(localFile(args[0])), null, 2));
  } else if (command === 'trim' && args.length === 4) {
    trim(localFile(args[0]), ...args.slice(1));
  } else if (command === 'concat') {
    concat(args);
  } else if (command === 'speed' && args.length === 3) {
    speed(localFile(args[0]), args[1], args[2]);
  } else if (command === 'mix') {
    mix(args);
  } else if (command === 'captions') {
    captions(args);
  } else {
    throw new Error(usage);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
