import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from tempfile import TemporaryDirectory

try:
    import numpy as np
    import soundfile as sf
except ImportError as exc:
    sys.stderr.write(
        f'Kokoro Python runtime missing dependency ({exc}). '
        'Install kokoro-onnx + soundfile in VIDEO_KOKORO_DIR/.venv or set VIDEO_KOKORO_PYTHON.\n'
    )
    sys.exit(1)


def file_sha256(path: Path, chunk_size: int = 1024 * 1024) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        while chunk := f.read(chunk_size):
            h.update(chunk)
    return h.hexdigest()


def run_ffmpeg(args: list[str]) -> subprocess.CompletedProcess:
    proc = subprocess.run(
        ['ffmpeg', '-hide_banner', '-nostdin', *args],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f'ffmpeg failed: {proc.stderr.strip()}')
    return proc


def normalize_wav(src: Path, dest: Path) -> dict:
    # Two-pass EBU R128 linear loudnorm to -16 LUFS / -1.5 dBTP, 48 kHz mono 16-bit PCM.
    p1 = run_ffmpeg([
        '-loglevel', 'info', '-i', str(src),
        '-af', 'aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=7:print_format=json',
        '-f', 'null', '-',
    ])
    m = re.search(r'\{\s*"input_i"[\s\S]*?\}', p1.stderr)
    if not m:
        raise RuntimeError('Failed to parse loudnorm pass-1 stats.')
    stats = json.loads(m.group(0))
    af = (
        'aresample=48000,'
        f"loudnorm=I=-16:TP=-1.5:LRA=7:measured_I={stats['input_i']}:"
        f"measured_TP={stats['input_tp']}:measured_LRA={stats['input_lra']}:"
        f"measured_thresh={stats['input_thresh']}:offset={stats['target_offset']}:"
        'linear=true:print_format=json'
    )
    p2 = run_ffmpeg([
        '-loglevel', 'info', '-y', '-i', str(src),
        '-af', af, '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', str(dest),
    ])
    m2 = re.search(r'\{\s*"input_i"[\s\S]*?\}', p2.stderr)
    return json.loads(m2.group(0)) if m2 else stats


def silence_detect(wav: Path, noise_db: float = -45.0, min_dur: float = 0.08) -> list[dict]:
    proc = run_ffmpeg([
        '-loglevel', 'info', '-i', str(wav),
        '-af', f'silencedetect=noise={noise_db}dB:d={min_dur}',
        '-f', 'null', '-',
    ])
    events = []
    cur_start = None
    for line in proc.stderr.splitlines():
        ms = re.search(r'silence_start:\s*([0-9.]+)', line)
        if ms:
            cur_start = float(ms.group(1))
        me = re.search(r'silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)', line)
        if me:
            events.append({
                'start': cur_start if cur_start is not None else float(me.group(1)) - float(me.group(2)),
                'end': float(me.group(1)),
                'duration': float(me.group(2)),
            })
            cur_start = None
    return events


def trim_and_fade(samples: np.ndarray, rate: int, thresh: float = 0.0015, pad_ms: float = 15.0) -> np.ndarray:
    if len(samples) == 0:
        return samples
    idx = np.where(np.abs(samples) > thresh)[0]
    if len(idx) == 0:
        return samples
    pad = int(rate * (pad_ms / 1000.0))
    lo = max(0, int(idx[0]) - pad)
    hi = min(len(samples), int(idx[-1]) + pad + 1)
    out = samples[lo:hi].astype(np.float32, copy=True)
    fade = min(int(rate * 0.01), len(out) // 4)
    if fade > 0:
        ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
        out[:fade] *= ramp
        out[-fade:] *= ramp[::-1]
    return out


def init_kokoro(model_dir: Path, gpu_mode: str):
    import onnxruntime as ort
    from kokoro_onnx import Kokoro

    available = ort.get_available_providers()
    active_provider = 'CPUExecutionProvider'
    fallback_reason = None

    if gpu_mode in ('on', 'auto'):
        if 'CUDAExecutionProvider' in available:
            os.environ['ONNX_PROVIDER'] = 'CUDAExecutionProvider'
            try:
                engine = Kokoro(str(model_dir / 'kokoro-v1.0.onnx'), str(model_dir / 'voices-v1.0.bin'))
                providers = engine.sess.get_providers()
                if 'CUDAExecutionProvider' in providers:
                    # Probe actual execution to catch missing cuDNN/cuBLAS or runtime errors.
                    _s, _r = engine.create('Test.', voice='af_bella', speed=1.0, lang='en-us')
                    if len(_s) > 0:
                        return engine, 'CUDAExecutionProvider', None
                    fallback_reason = 'CUDA probe returned empty audio'
                else:
                    fallback_reason = f'Session bound to {providers}, CUDAExecutionProvider inactive'
            except Exception as exc:
                fallback_reason = f'CUDA probe failed: {exc}'
        else:
            fallback_reason = f'CUDAExecutionProvider unavailable in {available}'

        if gpu_mode == 'on':
            raise RuntimeError(fallback_reason or 'Requested GPU execution failed')

    os.environ['ONNX_PROVIDER'] = 'CPUExecutionProvider'
    engine = Kokoro(str(model_dir / 'kokoro-v1.0.onnx'), str(model_dir / 'voices-v1.0.bin'))
    return engine, active_provider, fallback_reason


def synthesize_text(engine, text: str, voice: str, speed: float, lang: str, segment_gap_s: float):
    raw_segments = [s.strip() for s in re.split(r'\n\s*---\s*\n', text) if s.strip()]
    if len(raw_segments) <= 1:
        samples, rate = engine.create(text, voice=voice, speed=speed, lang=lang)
        samples = trim_and_fade(samples, rate)
        return samples, rate, [{
            'index': 0,
            'text': text,
            'start_sample': 0,
            'end_sample': int(len(samples)),
            'duration_s': round(len(samples) / rate, 6),
        }]

    gap_samples = None
    chunks = []
    segs_meta = []
    cursor = 0
    rate = None
    for i, seg_text in enumerate(raw_segments):
        s, r = engine.create(seg_text, voice=voice, speed=speed, lang=lang)
        if rate is None:
            rate = r
            gap_samples = int(round(segment_gap_s * rate))
        s = trim_and_fade(s, rate)
        if i > 0 and gap_samples > 0:
            chunks.append(np.zeros(gap_samples, dtype=np.float32))
            cursor += gap_samples
        start_sample = cursor
        chunks.append(s)
        cursor += len(s)
        segs_meta.append({
            'index': i,
            'text': seg_text,
            'start_sample': int(start_sample),
            'end_sample': int(cursor),
            'duration_s': round(len(s) / rate, 6),
        })
    joined = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
    return joined, rate, segs_meta


def main():
    parser = argparse.ArgumentParser(description='Generate offline Kokoro narration with timings & optional GPU.')
    parser.add_argument('filename', nargs='?', help='Output WAV filename')
    parser.add_argument('--text-file', type=Path)
    parser.add_argument('--voice', default='af_bella', help='Kokoro voice ID, or female (Bella) / male (Michael)')
    parser.add_argument('--lang', default='en', choices=['en', 'en-us', 'en-gb'])
    parser.add_argument('--speed', type=float, default=1.0)
    parser.add_argument('--scratch', action='store_true', help='Write to out/scratch/ instead of public/media/audio/')
    parser.add_argument('--norm', action='store_true', help='Normalize to 48 kHz mono PCM at -16 LUFS / -1.5 dBTP')
    parser.add_argument('--timings', type=Path, help='Write JSON beat/sample timing map')
    parser.add_argument('--fps', type=float, default=30.0, help='Composition FPS for frame mapping')
    parser.add_argument('--segment-gap', type=float, default=0.25, help='Gap in seconds between --- segments')
    parser.add_argument('--variants', type=Path, help='JSON array of variants to generate in one model load')
    parser.add_argument('--variants-out', type=Path, help='Output directory for --variants (default out/variants/)')
    parser.add_argument('--gpu', choices=['off', 'auto', 'on'], default='off')
    parser.add_argument('--cache', action='store_true', help='Cache and reuse approved synthesis by input hash')
    parser.add_argument('--promote-scratch', nargs=2, metavar=('SCRATCH_WAV', 'DEST_NAME'), help='Promote scratch WAV to public/media/audio/')
    args = parser.parse_args()

    root = Path(os.environ.get('VIDEO_RUN_ROOT') or Path(__file__).resolve().parent.parent)

    if args.promote_scratch:
        src = Path(args.promote_scratch[0])
        if not src.is_absolute():
            src = (root / src).resolve() if (root / src).exists() else src.resolve()
        dest_name = args.promote_scratch[1]
        if Path(dest_name).name != dest_name or not dest_name.lower().endswith('.wav'):
            parser.error('Destination must be a plain .wav filename.')
        folder = root / 'public/media/audio'
        folder.mkdir(parents=True, exist_ok=True)
        dest = folder / dest_name
        if os.path.lexists(dest):
            raise FileExistsError(dest)
        shutil.copy2(src, dest)
        print(json.dumps({'promoted': str(dest), 'sha256': file_sha256(dest)}, indent=2))
        return

    if not 0.7 <= args.speed <= 1.5:
        parser.error('Speed must be between 0.7 and 1.5.')

    model_dir = Path(os.environ['VIDEO_KOKORO_DIR'])
    onnx_path = model_dir / 'kokoro-v1.0.onnx'
    voices_path = model_dir / 'voices-v1.0.bin'
    if not onnx_path.is_file() or not voices_path.is_file():
        parser.exit(1, f'Kokoro model files not found in {model_dir}\n')

    t0 = time.time()
    engine, active_provider, fallback_reason = init_kokoro(model_dir, args.gpu)
    t_load = time.time() - t0

    if args.variants:
        items = json.loads(args.variants.read_text(encoding='utf-8'))
        out_dir = args.variants_out or (root / 'out/variants')
        out_dir.mkdir(parents=True, exist_ok=True)
        report = []
        for idx, item in enumerate(items):
            vid = item.get('id') or f'variant-{idx+1}'
            vtext = item['text'].strip()
            vvoice = {'female': 'af_bella', 'male': 'am_michael'}.get(item.get('voice', args.voice), item.get('voice', args.voice))
            vlang = ('en-gb' if vvoice.startswith('b') else 'en-us') if item.get('lang', args.lang) == 'en' else item.get('lang', args.lang)
            vspeed = float(item.get('speed', args.speed))
            dest = out_dir / f'{vid}.wav'
            if os.path.lexists(dest):
                raise FileExistsError(dest)
            ts = time.time()
            samples, rate, segs = synthesize_text(engine, vtext, vvoice, vspeed, vlang, args.segment_gap)
            with TemporaryDirectory(dir=out_dir) as tmp:
                raw = Path(tmp) / 'raw.wav'
                sf.write(raw, samples, rate, subtype='PCM_16')
                if args.norm:
                    norm_stats = normalize_wav(raw, dest)
                else:
                    shutil.move(str(raw), str(dest))
                    norm_stats = None
            info = sf.info(dest)
            report.append({
                'id': vid,
                'path': str(dest),
                'voice': vvoice,
                'speed': vspeed,
                'duration_s': round(info.frames / info.samplerate, 4),
                'sample_rate': info.samplerate,
                'frames': info.frames,
                'synth_time_s': round(time.time() - ts, 3),
                'loudness': norm_stats,
            })
        summary = {
            'provider': active_provider,
            'fallback_reason': fallback_reason,
            'load_time_s': round(t_load, 3),
            'variants': report,
        }
        print(json.dumps(summary, indent=2))
        return

    if not args.filename or not args.text_file:
        parser.error('filename and --text-file are required unless using --variants or --promote-scratch.')
    if Path(args.filename).name != args.filename or not args.filename.lower().endswith('.wav'):
        parser.error('Use a WAV filename without a directory.')

    text = args.text_file.read_text(encoding='utf-8').strip()
    if not text:
        raise ValueError('Narration script is empty.')

    voice = {'female': 'af_bella', 'male': 'am_michael'}.get(args.voice, args.voice)
    lang = ('en-gb' if voice.startswith('b') else 'en-us') if args.lang == 'en' else args.lang

    folder = root / ('out/scratch' if args.scratch else 'public/media/audio')
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / args.filename
    if os.path.lexists(dest):
        raise FileExistsError(dest)

    cache_root = Path(os.environ.get('VIDEO_TTS_CACHE_DIR') or (Path.home() / '.cache/agentic-video-pipeline/tts-cache'))
    input_hash = hashlib.sha256(json.dumps({
        'engine': 'kokoro-82m',
        'model_sha256': file_sha256(onnx_path),
        'voices_sha256': file_sha256(voices_path),
        'voice': voice,
        'lang': lang,
        'speed': args.speed,
        'norm': args.norm,
        'segment_gap': args.segment_gap,
        'text': text,
    }, sort_keys=True).encode('utf-8')).hexdigest()

    cache_wav = cache_root / f'{input_hash}.wav'
    cache_meta = cache_root / f'{input_hash}.json'
    cache_hit = False
    t_synth = 0.0
    norm_stats = None
    segs_meta = None

    if args.cache and cache_wav.is_file() and cache_meta.is_file():
        shutil.copy2(cache_wav, dest)
        cached = json.loads(cache_meta.read_text(encoding='utf-8'))
        segs_meta = cached.get('segments')
        norm_stats = cached.get('loudness')
        cache_hit = True
    else:
        ts = time.time()
        samples, rate, segs_meta = synthesize_text(engine, text, voice, args.speed, lang, args.segment_gap)
        t_synth = time.time() - ts
        with TemporaryDirectory(dir=folder) as temp:
            raw = Path(temp) / 'raw.wav'
            sf.write(raw, samples, rate, subtype='PCM_16')
            if args.norm:
                norm_wav = Path(temp) / 'norm.wav'
                norm_stats = normalize_wav(raw, norm_wav)
                # Update segment offsets proportionally if sample rate changed (24k -> 48k)
                scale = 48000 / rate
                for seg in segs_meta:
                    seg['start_sample'] = int(round(seg['start_sample'] * scale))
                    seg['end_sample'] = int(round(seg['end_sample'] * scale))
                os.link(norm_wav, dest)
            else:
                os.link(raw, dest)
        if args.cache:
            cache_root.mkdir(parents=True, exist_ok=True)
            shutil.copy2(dest, cache_wav)
            cache_meta.write_text(json.dumps({'segments': segs_meta, 'loudness': norm_stats}, indent=2), encoding='utf-8')

    info = sf.info(dest)
    wav_hash = file_sha256(dest)
    duration_s = info.frames / info.samplerate

    if args.timings:
        args.timings.parent.mkdir(parents=True, exist_ok=True)
        silences = silence_detect(dest)
        for seg in segs_meta:
            seg['start_s'] = round(seg['start_sample'] / info.samplerate, 6)
            seg['end_s'] = round(seg['end_sample'] / info.samplerate, 6)
            seg['start_frame'] = int(round((seg['start_sample'] / info.samplerate) * args.fps))
            seg['end_frame'] = int(round((seg['end_sample'] / info.samplerate) * args.fps))
        timing_payload = {
            'wav_path': str(dest),
            'wav_sha256': wav_hash,
            'input_hash': input_hash,
            'provider': active_provider,
            'fallback_reason': fallback_reason,
            'cache_hit': cache_hit,
            'sample_rate': info.samplerate,
            'sample_count': info.frames,
            'duration_s': round(duration_s, 6),
            'fps': args.fps,
            'total_frames': int(round(duration_s * args.fps)),
            'segments': segs_meta,
            'silences': silences,
            'loudness': norm_stats,
        }
        args.timings.write_text(json.dumps(timing_payload, indent=2), encoding='utf-8')

    print(json.dumps({
        'path': str(dest),
        'wav_sha256': wav_hash,
        'input_hash': input_hash,
        'provider': active_provider,
        'fallback_reason': fallback_reason,
        'cache_hit': cache_hit,
        'load_time_s': round(t_load, 3),
        'synth_time_s': round(t_synth, 3),
        'sample_rate': info.samplerate,
        'sample_count': info.frames,
        'duration_s': round(duration_s, 4),
        'timings_path': str(args.timings) if args.timings else None,
    }, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        sys.stderr.write(f'Voice generation failed: {error}\n')
        sys.exit(1)
