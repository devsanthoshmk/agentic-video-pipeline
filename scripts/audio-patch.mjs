import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {videoRun} from './video-run.mjs';

function usage() {
  console.error(
    'Usage: node scripts/audio-patch.mjs --video <in.mp4> --out <patched.mp4> (--mix-manifest <m.json> | --vo <vo.wav>) ' +
    '(--slot <start_s:end_s> | --sample-slot <s0:s1>) (--take <rep.wav> | --text-file <txt>) ' +
    '[--bed <bed.wav>] [--vo-offset 0.5] [--speed 1.05] [--voice male] [--audio-track 0] ' +
    '[--srt <in.srt> --out-srt <out.srt> --cue <1-based> --cue-text <text>] [--out-vo <new-vo.wav>] [--allow-embedded-srt] [--gpu off|auto|on]'
  );
  process.exit(2);
}

function parseArgs(argv) {
  const o = {voOffset: 0.5, speed: 1.05, voice: 'male', audioTrack: 0, gpu: 'off', allowEmbeddedSrt: false};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--video') o.video = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--mix-manifest') o.mixManifest = argv[++i];
    else if (a === '--vo') o.vo = argv[++i];
    else if (a === '--bed') o.bed = argv[++i];
    else if (a === '--vo-offset') o.voOffset = Number(argv[++i]);
    else if (a === '--slot') o.slot = argv[++i];
    else if (a === '--sample-slot') o.sampleSlot = argv[++i];
    else if (a === '--take') o.take = argv[++i];
    else if (a === '--text-file') o.textFile = argv[++i];
    else if (a === '--speed') o.speed = Number(argv[++i]);
    else if (a === '--voice') o.voice = argv[++i];
    else if (a === '--audio-track') o.audioTrack = Number(argv[++i]);
    else if (a === '--srt') o.srt = argv[++i];
    else if (a === '--out-srt') o.outSrt = argv[++i];
    else if (a === '--cue') o.cue = Number(argv[++i]);
    else if (a === '--cue-text') o.cueText = argv[++i];
    else if (a === '--out-vo') o.outVo = argv[++i];
    else if (a === '--gpu') o.gpu = argv[++i];
    else if (a === '--allow-embedded-srt') o.allowEmbeddedSrt = true;
    else usage();
  }
  if (!o.video || !o.out || (!o.mixManifest && !o.vo) || (!o.slot && !o.sampleSlot) || (!o.take && !o.textFile)) usage();
  if (o.speed > 1.08) throw new Error(`Refusing patch speed ${o.speed} > 1.08 on locked picture; escalate to picture retiming.`);
  return o;
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`${cmd} failed: ${res.stderr.trim() || res.status}`);
  return res;
}

function sha256Buf(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function packetSignature(mp4Path) {
  const res = run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_packets', '-show_data_hash', 'sha256',
    '-show_entries', 'packet=pts,dts,duration,size,flags,data_hash',
    '-of', 'json', mp4Path,
  ]);
  const packets = JSON.parse(res.stdout).packets || [];
  return sha256Buf(Buffer.from(JSON.stringify(packets)));
}

function readWavPcm48kMono(wavPath) {
  const raw = run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-i', wavPath,
    '-ac', '1', '-ar', '48000', '-f', 's16le', '-',
  ]);
  const res = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-i', wavPath,
    '-ac', '1', '-ar', '48000', '-f', 's16le', 'pipe:1',
  ], {maxBuffer: 256 * 1024 * 1024});
  if (res.status !== 0) throw new Error(`Failed reading PCM from ${wavPath}: ${res.stderr}`);
  return new Int16Array(res.stdout.buffer, res.stdout.byteOffset, res.stdout.byteLength / 2);
}

function readWavRawPcm(wavPath) {
  // Exact 48 kHz stereo PCM bytes from rendered mix WAV
  const res = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-i', wavPath,
    '-ac', '2', '-ar', '48000', '-f', 's16le', 'pipe:1',
  ], {maxBuffer: 512 * 1024 * 1024});
  if (res.status !== 0) throw new Error(`Failed reading mix PCM from ${wavPath}`);
  return res.stdout;
}

function writePcm48kMonoWav(samples, destWav) {
  const buf = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const res = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 's16le', '-ar', '48000', '-ac', '1', '-i', 'pipe:0',
    '-c:a', 'pcm_s16le', destWav,
  ], {input: buf, encoding: 'utf8'});
  if (res.status !== 0) throw new Error(`Failed writing WAV ${destWav}: ${res.stderr}`);
}

function rmsWindow(samples, start, end) {
  let sum = 0, count = 0;
  for (let i = Math.max(0, start); i < Math.min(samples.length, end); i++) {
    const v = samples[i] / 32768.0;
    sum += v * v;
    count++;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

function renderDeterministicMix(voWav, bedWav, totalDur, manifest, outWav) {
  const delayMs = Math.max(0, Math.round(manifest.vo_offset_s * 1000));
  if (bedWav) {
    const tStart = manifest.vo_offset_s;
    const tEnd = tStart + manifest.vo_duration_s;
    const attack = manifest.attack_s ?? 0.12;
    const release = manifest.release_s ?? 0.35;
    const bg = manifest.bed_gain ?? 0.13;
    const idle = manifest.bed_idle_gain ?? 0.22;
    const fadeOut = manifest.fade_out_s ?? 1.5;
    const a0 = Math.max(0, tStart - attack);
    const r1 = tEnd + release;
    const volExpr =
      `if(lt(t,${a0.toFixed(3)}),${idle},` +
      `if(lt(t,${tStart.toFixed(3)}),${idle}+(${bg}-${idle})*(t-${a0.toFixed(3)})/${attack.toFixed(3)},` +
      `if(lt(t,${tEnd.toFixed(3)}),${bg},` +
      `if(lt(t,${r1.toFixed(3)}),${bg}+(${idle}-${bg})*(t-${tEnd.toFixed(3)})/${release.toFixed(3)},${idle}))))`;
    const fc =
      `[0:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${delayMs}|${delayMs},apad[vo];` +
      `[1:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${totalDur.toFixed(6)},asetpts=PTS-STARTPTS,` +
      `volume='${volExpr}':eval=frame,afade=t=out:st=${Math.max(0, totalDur - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}[bed];` +
      `[vo][bed]amix=inputs=2:duration=longest:normalize=0,atrim=0:${totalDur.toFixed(6)},asetpts=PTS-STARTPTS[mix]`;
    run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', voWav, '-i', bedWav, '-filter_complex', fc, '-map', '[mix]',
      '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', outWav,
    ]);
  } else {
    run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', voWav, '-af', `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${delayMs}|${delayMs},apad,atrim=0:${totalDur.toFixed(6)}`,
      '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', outWav,
    ]);
  }
}

function updateSrtCue(srtIn, srtOut, cueNum, newText) {
  if (existsSync(srtOut)) throw new Error(`SRT output already exists: ${srtOut}`);
  const blocks = readFileSync(srtIn, 'utf8').trim().split(/\r?\n\r?\n+/);
  let replaced = false;
  const updated = blocks.map((b) => {
    const lines = b.split(/\r?\n/);
    if (Number(lines[0]?.trim()) === cueNum && lines.length >= 2) {
      replaced = true;
      return `${lines[0]}\n${lines[1]}\n${newText.trim()}`;
    }
    return b;
  });
  if (!replaced) throw new Error(`Cue #${cueNum} not found in ${srtIn}`);
  writeFileSync(srtOut, updated.join('\n\n') + '\n', 'utf8');
}

const opts = parseArgs(process.argv.slice(2));
const videoFile = realpathSync(resolve(opts.video));
const outPath = resolve(opts.out);
if (existsSync(outPath)) throw new Error(`Output already exists: ${outPath}`);

const manifest = opts.mixManifest
  ? JSON.parse(readFileSync(resolve(opts.mixManifest), 'utf8'))
  : {vo_stem: resolve(opts.vo), bed_stem: opts.bed ? resolve(opts.bed) : null, vo_offset_s: opts.voOffset, attack_s: 0.12, release_s: 0.35, bed_gain: 0.13, bed_idle_gain: 0.22, fade_out_s: 1.5};

const voStem = realpathSync(resolve(opts.vo || manifest.vo_stem));
const bedStem = opts.bed ? realpathSync(resolve(opts.bed)) : (manifest.bed_stem ? realpathSync(resolve(manifest.bed_stem)) : null);
if (!existsSync(voStem)) throw new Error(`Missing clean VO stem (${voStem}). Escalate rather than patching baked MP4 audio.`);

const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', videoFile]).stdout);
const totalDur = Number(probe.format?.duration || 0);
const audioStreams = (probe.streams || []).filter((s) => s.codec_type === 'audio');
const subStreams = (probe.streams || []).filter((s) => s.codec_type === 'subtitle');
if (opts.audioTrack >= audioStreams.length) throw new Error(`Audio track ${opts.audioTrack} out of range.`);
if (subStreams.length > 0 && !opts.allowEmbeddedSrt) {
  throw new Error('Source MP4 has embedded subtitle stream(s); pass --allow-embedded-srt or escalate so embedded captions do not go stale.');
}

const voPcm = readWavPcm48kMono(voStem);
const sr = 48000;
manifest.vo_offset_s = opts.voOffset ?? manifest.vo_offset_s ?? 0.5;
manifest.vo_duration_s = voPcm.length / sr;

let s0, s1;
if (opts.sampleSlot) {
  [s0, s1] = opts.sampleSlot.split(':').map(Number);
} else {
  const [t0, t1] = opts.slot.split(':').map(Number);
  s0 = Math.round(t0 * sr);
  s1 = Math.round(t1 * sr);
}
if (!Number.isInteger(s0) || !Number.isInteger(s1) || s0 < 0 || s1 <= s0 || s1 > voPcm.length) {
  throw new Error(`Invalid sample slot ${s0}:${s1} for VO length ${voPcm.length}`);
}

const tempDir = mkdtempSync(join(resolve(outPath, '..'), '.patch-'));
try {
  let takeWav = opts.take ? realpathSync(resolve(opts.take)) : null;
  if (!takeWav) {
    const voiceScript = fileURLToPath(new URL('./audio-voice.mjs', import.meta.url));
    takeWav = join(tempDir, 'take.wav');
    // Generate directly via audio-voice.mjs --scratch or temp run
    const gen = spawnSync(process.execPath, [
      voiceScript, 'patch-take.wav', '--text-file', resolve(opts.textFile),
      '--voice', opts.voice, '--speed', String(opts.speed), '--norm', '--gpu', opts.gpu, '--scratch',
    ], {encoding: 'utf8'});
    if (gen.status !== 0) throw new Error(`Take synthesis failed: ${gen.stderr}`);
    const parsed = JSON.parse(gen.stdout);
    takeWav = parsed.path;
  }

  const takePcm = readWavPcm48kMono(takeWav);
  const slotSamples = s1 - s0;
  const fadeSamples = Math.round(0.012 * sr); // 12ms Hann crossfade
  if (takePcm.length > slotSamples) {
    throw new Error(
      `Slot overflow: replacement is ${(takePcm.length / sr).toFixed(3)}s (${takePcm.length} samples), slot is ${(slotSamples / sr).toFixed(3)}s (${slotSamples} samples). Escalate to picture retiming — refusing to shift downstream cues.`
    );
  }

  // Match RMS to surrounding active VO speech (not silent gaps)
  const refRms = Math.max(
    rmsWindow(voPcm, Math.max(0, s0 - sr * 2), s0),
    rmsWindow(voPcm, s1, Math.min(voPcm.length, s1 + sr * 2)),
    0.04
  );
  const takeRms = Math.max(rmsWindow(takePcm, 0, takePcm.length), 1e-4);
  const gain = Math.min(2.5, refRms / takeRms);

  const patchedVo = new Int16Array(voPcm);
  patchedVo.fill(0, s0, s1);
  for (let i = 0; i < takePcm.length; i++) {
    let w = 1.0;
    if (i < fadeSamples) w = 0.5 * (1 - Math.cos((Math.PI * i) / fadeSamples));
    else if (i > takePcm.length - fadeSamples) {
      const rem = takePcm.length - 1 - i;
      w = 0.5 * (1 - Math.cos((Math.PI * rem) / fadeSamples));
    }
    const val = Math.round(takePcm[i] * gain * w);
    patchedVo[s0 + i] = Math.max(-32768, Math.min(32767, val));
  }

  const patchedVoWav = join(tempDir, 'patched-vo.wav');
  writePcm48kMonoWav(patchedVo, patchedVoWav);

  const baseMixWav = join(tempDir, 'base-mix.wav');
  const newMixWav = join(tempDir, 'new-mix.wav');
  renderDeterministicMix(voStem, bedStem, totalDur, manifest, baseMixWav);
  renderDeterministicMix(patchedVoWav, bedStem, totalDur, manifest, newMixWav);

  // Verify sample-identical lossless PCM outside the exact patched gain-envelope window
  const baseMixBytes = readWavRawPcm(baseMixWav);
  const newMixBytes = readWavRawPcm(newMixWav);
  const bytesPerSampleStereo = 4;
  const winStartByte = Math.max(0, Math.floor((manifest.vo_offset_s + s0 / sr - (manifest.attack_s ?? 0.12)) * sr) * bytesPerSampleStereo);
  const winEndByte = Math.min(baseMixBytes.length, Math.ceil((manifest.vo_offset_s + s1 / sr + (manifest.release_s ?? 0.35)) * sr) * bytesPerSampleStereo);
  const headMatch = baseMixBytes.subarray(0, winStartByte).equals(newMixBytes.subarray(0, winStartByte));
  const tailMatch = baseMixBytes.subarray(winEndByte).equals(newMixBytes.subarray(winEndByte));
  if (!headMatch || !tailMatch) {
    throw new Error(`Out-of-window PCM drift detected (headMatch=${headMatch}, tailMatch=${tailMatch}).`);
  }

  // Dynamic ffprobe-driven stream mapping preserving unaffected tracks, metadata, chapters
  const ffMap = ['-map', '0:v:0'];
  const ffCodec = ['-c:v', 'copy'];
  for (let ai = 0; ai < audioStreams.length; ai++) {
    if (ai === opts.audioTrack) {
      ffMap.push('-map', '1:a:0', `-c:a:${ai}`, 'aac', `-b:a:${ai}`, '256k');
    } else {
      ffMap.push('-map', `0:a:${ai}`, `-c:a:${ai}`, 'copy');
    }
  }
  if (subStreams.length > 0) {
    ffMap.push('-map', '0:s?', '-c:s', 'copy');
  }
  const stagedMp4 = join(tempDir, 'patched.mp4');
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
    '-i', videoFile, '-i', newMixWav,
    ...ffMap, '-map_metadata', '0', '-map_chapters', '0',
    ...ffCodec, '-movflags', '+faststart', stagedMp4,
  ]);

  // Verify compressed video packet payload + pts/dts/duration parity AND decoded framemd5 parity
  const srcPktSig = packetSignature(videoFile);
  const dstPktSig = packetSignature(stagedMp4);
  if (srcPktSig !== dstPktSig) {
    throw new Error(`Compressed video packet mismatch (${srcPktSig} vs ${dstPktSig})`);
  }
  const srcFrameMd5 = sha256Buf(Buffer.from(run('ffmpeg', ['-hide_banner', '-v', 'error', '-i', videoFile, '-map', '0:v:0', '-f', 'framemd5', '-']).stdout));
  const dstFrameMd5 = sha256Buf(Buffer.from(run('ffmpeg', ['-hide_banner', '-v', 'error', '-i', stagedMp4, '-map', '0:v:0', '-f', 'framemd5', '-']).stdout));
  if (srcFrameMd5 !== dstFrameMd5) {
    throw new Error(`Decoded video framemd5 mismatch (${srcFrameMd5} vs ${dstFrameMd5})`);
  }

  // Full decode check
  run('ffmpeg', ['-hide_banner', '-v', 'error', '-xerror', '-i', stagedMp4, '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-']);

  linkSync(stagedMp4, outPath);
  if (opts.outVo) {
    writePcm48kMonoWav(patchedVo, resolve(opts.outVo));
  }
  if (opts.srt && opts.outSrt && opts.cue && opts.cueText) {
    updateSrtCue(realpathSync(resolve(opts.srt)), resolve(opts.outSrt), opts.cue, opts.cueText);
  }

  console.log(JSON.stringify({
    patched_mp4: outPath,
    slot_samples: [s0, s1],
    replacement_samples: takePcm.length,
    out_of_window_pcm_identical: true,
    compressed_video_packets_identical: true,
    video_packet_sig: dstPktSig,
    srt_updated: Boolean(opts.outSrt),
  }, null, 2));
} finally {
  rmSync(tempDir, {recursive: true, force: true});
}
