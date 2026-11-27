import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

function usage() {
  console.error(
    'Usage: node scripts/transcribe.mjs <audio-or-video-file> [--track 0] [--gpu auto|on|off] [--srt out.srt] [--json out.json] [--model path-or-name] [--lang en]'
  );
  process.exit(2);
}

function parseArgs(argv) {
  const opts = {track: 0, gpu: process.env.VIDEO_WHISPER_GPU || 'off', lang: 'en'};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--track') opts.track = Number(argv[++i]);
    else if (a === '--gpu') opts.gpu = argv[++i];
    else if (a === '--srt') opts.srt = argv[++i];
    else if (a === '--json') opts.json = argv[++i];
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--lang') opts.lang = argv[++i];
    else if (a.startsWith('-')) usage();
    else pos.push(a);
  }
  if (pos.length !== 1 || !Number.isInteger(opts.track) || opts.track < 0 || !['auto', 'on', 'off'].includes(opts.gpu)) {
    usage();
  }
  opts.input = pos[0];
  return opts;
}

function resolveWhisperModel(explicit) {
  if (explicit) return explicit;
  if (process.env.VIDEO_WHISPER_DIR) return process.env.VIDEO_WHISPER_DIR;
  const cacheDir = join(homedir(), '.cache/faster-whisper-large-v3-turbo');
  return existsSync(cacheDir) ? cacheDir : 'large-v3-turbo';
}

function findPythonNvidiaLibs(pythonBin) {
  const probe = spawnSync(pythonBin, [
    '-c',
    'import glob, os, site; dirs=site.getsitepackages()+[site.getusersitepackages()]; print(":".join(p for d in dirs for p in glob.glob(os.path.join(d,"nvidia/*/lib"))))',
  ], {encoding: 'utf8'});
  if (probe.status !== 0) return [];
  return probe.stdout.trim().split(':').filter(Boolean);
}

function decodeAudioTo16kWav(inputPath, trackIndex, outWav) {
  const file = realpathSync(resolve(inputPath));
  if (!statSync(file).isFile()) throw new Error(`Not a regular file: ${inputPath}`);

  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index,codec_name,channels,sample_rate',
    '-of', 'json', '-i', file,
  ], {encoding: 'utf8'});
  if (probe.error) throw probe.error;
  if (probe.status !== 0) throw new Error(`ffprobe failed: ${probe.stderr.trim()}`);
  const streams = JSON.parse(probe.stdout).streams || [];
  if (trackIndex >= streams.length) {
    throw new Error(`Audio track ${trackIndex} not found (${streams.length} audio stream(s) in ${inputPath}).`);
  }

  const ff = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', file, '-map', `0:a:${trackIndex}`, '-vn', '-sn', '-dn',
    '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outWav,
  ], {encoding: 'utf8'});
  if (ff.error) throw ff.error;
  if (ff.status !== 0) {
    throw new Error(`FFmpeg could not decode audio track ${trackIndex}: ${ff.stderr.trim()}`);
  }
}

function formatSrtTime(sec) {
  const msTotal = Math.max(0, Math.round(sec * 1000));
  const ms = msTotal % 1000;
  const sTotal = Math.floor(msTotal / 1000);
  const s = sTotal % 60;
  const mTotal = Math.floor(sTotal / 60);
  const m = mTotal % 60;
  const h = Math.floor(mTotal / 60);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function buildSrtCues(words, maxChars = 42, maxGapS = 0.45) {
  if (!words.length) return [];
  const cues = [];
  let bucket = [];
  let curLen = 0;

  const flush = () => {
    if (!bucket.length) return;
    const text = bucket.map((w) => w.word).join('').trim();
    if (text) {
      cues.push({
        index: cues.length + 1,
        start: bucket[0].start,
        end: Math.max(bucket[bucket.length - 1].end, bucket[0].start + 0.2),
        text,
      });
    }
    bucket = [];
    curLen = 0;
  };

  for (const w of words) {
    const token = w.word;
    const gap = bucket.length ? w.start - bucket[bucket.length - 1].end : 0;
    const endsSentence = bucket.length && /[.!?]$/.test(bucket[bucket.length - 1].word.trim());
    if (bucket.length && (gap > maxGapS || endsSentence || curLen + token.length > maxChars * 2)) {
      flush();
    }
    bucket.push(w);
    curLen += token.length;
  }
  flush();

  return cues.map((c) => {
    const wordsSplit = c.text.split(/\s+/);
    let body = c.text;
    if (c.text.length > maxChars && wordsSplit.length > 1) {
      let bestIdx = 1;
      let bestDiff = Infinity;
      for (let i = 1; i < wordsSplit.length; i++) {
        const l1 = wordsSplit.slice(0, i).join(' ').length;
        const l2 = wordsSplit.slice(i).join(' ').length;
        const diff = Math.abs(l1 - l2);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }
      body = `${wordsSplit.slice(0, bestIdx).join(' ')}\n${wordsSplit.slice(bestIdx).join(' ')}`;
    }
    return {...c, body};
  });
}

function renderSrt(cues) {
  return cues.map((c) => `${c.index}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${c.body}\n`).join('\n');
}

const pyCode = `
import json, sys, time, wave
try:
    import numpy as np
    import ctranslate2
    from faster_whisper import WhisperModel
except ImportError as exc:
    sys.stderr.write(f"Whisper runtime missing dependency ({exc}). Install faster-whisper and ctranslate2 or set VIDEO_WHISPER_PYTHON.\\n")
    sys.exit(1)

wav_path, model_path, gpu_mode, lang = sys.argv[1:5]
with wave.open(wav_path, 'rb') as wf:
    pcm = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0

device = 'cpu'
compute_type = 'int8'
fallback_reason = None
model = None

if gpu_mode in ('auto', 'on'):
    try:
        if ctranslate2.get_cuda_device_count() > 0:
            t0 = time.time()
            model = WhisperModel(model_path, device='cuda', compute_type='int8_float16')
            t_load = time.time() - t0
            t1 = time.time()
            segs_gen, info = model.transcribe(pcm, language=lang or None, word_timestamps=True)
            segs = list(segs_gen)
            t_transcribe = time.time() - t1
            device = 'cuda'
            compute_type = 'int8_float16'
        else:
            fallback_reason = 'ctranslate2 reported 0 CUDA devices'
    except Exception as exc:
        fallback_reason = f'CUDA transcription failed: {exc}'
        model = None
    if device != 'cuda' and gpu_mode == 'on':
        sys.stderr.write(fallback_reason + '\\n')
        sys.exit(1)

if model is None:
    t0 = time.time()
    model = WhisperModel(model_path, device='cpu', compute_type='int8')
    t_load = time.time() - t0
    t1 = time.time()
    segs_gen, info = model.transcribe(pcm, language=lang or None, word_timestamps=True)
    segs = list(segs_gen)
    t_transcribe = time.time() - t1

words = []
text_parts = []
for s in segs:
    text_parts.append(s.text.strip())
    for w in (s.words or []):
        words.append({
            'word': w.word,
            'start': round(float(w.start), 3),
            'end': round(float(w.end), 3),
            'probability': round(float(w.probability), 4),
        })

flagged = [w for w in words if w['probability'] < 0.70]
print(json.dumps({
    'model': model_path,
    'device': device,
    'compute_type': compute_type,
    'fallback_reason': fallback_reason,
    'load_time_s': round(t_load, 3),
    'transcribe_time_s': round(t_transcribe, 3),
    'transcript': ' '.join(t for t in text_parts if t),
    'word_count': len(words),
    'flagged_words': flagged,
    'words': words,
}))
`;

const opts = parseArgs(process.argv.slice(2));
const modelPath = resolveWhisperModel(opts.model);
const pythonBin = process.env.VIDEO_WHISPER_PYTHON || 'python3';
const tempDir = mkdtempSync(join(tmpdir(), 'whisper-pcm-'));

try {
  const wav16 = join(tempDir, 'audio16k.wav');
  decodeAudioTo16kWav(opts.input, opts.track, wav16);

  const env = {...process.env};
  if (opts.gpu !== 'off') {
    const nvLibs = findPythonNvidiaLibs(pythonBin);
    if (nvLibs.length > 0) {
      env.LD_LIBRARY_PATH = env.LD_LIBRARY_PATH ? `${nvLibs.join(':')}:${env.LD_LIBRARY_PATH}` : nvLibs.join(':');
    }
  }

  const pyRes = spawnSync(pythonBin, ['-c', pyCode, wav16, modelPath, opts.gpu, opts.lang], {
    encoding: 'utf8',
    env,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (pyRes.error) throw pyRes.error;
  if (pyRes.status !== 0) {
    throw new Error(`Whisper failed: ${pyRes.stderr.trim() || pyRes.status}`);
  }

  const result = JSON.parse(pyRes.stdout);
  if (opts.srt) {
    const srtDest = resolve(opts.srt);
    if (existsSync(srtDest)) throw new Error(`SRT output already exists: ${opts.srt}`);
    const cues = buildSrtCues(result.words);
    writeFileSync(srtDest, renderSrt(cues), 'utf8');
    result.srt_path = srtDest;
    result.srt_cues = cues.length;
  }
  if (opts.json) {
    const jsonDest = resolve(opts.json);
    writeFileSync(jsonDest, JSON.stringify(result, null, 2), 'utf8');
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  rmSync(tempDir, {recursive: true, force: true});
}
