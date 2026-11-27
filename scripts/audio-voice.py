import argparse
import hashlib
import json
import math
import os
import wave
from pathlib import Path
from tempfile import TemporaryDirectory


def main():
    parser = argparse.ArgumentParser(description='Generate local Supertonic narration.')
    parser.add_argument('filename', nargs='?', help='New WAV filename')
    parser.add_argument('--text-file', type=Path, help='UTF-8 narration script')
    parser.add_argument('--voice', choices=[f'{group}{i}' for group in 'FM' for i in range(1, 6)], default='F1')
    parser.add_argument('--lang', default='en', help='Supertonic language code; use na for language-agnostic')
    parser.add_argument('--speed', type=float, default=1.05)
    parser.add_argument('--scratch', action='store_true', help='Write to out/scratch/ instead of public/media/audio/')
    parser.add_argument('--timings', type=Path, help='Write JSON timing metadata')
    parser.add_argument('--fps', type=float, default=30.0)
    parser.add_argument('--norm', action='store_true')
    parser.add_argument('--cache', action='store_true')
    parser.add_argument('--gpu', default='off')
    parser.add_argument('--variants', type=Path)
    parser.add_argument('--promote-scratch', nargs=2)
    args = parser.parse_args()

    if args.variants or args.promote_scratch:
        parser.error('--variants and --promote-scratch are only supported with Kokoro (unset VIDEO_TTS_ENGINE=supertonic).')
    if args.gpu not in ('off', 'auto'):
        parser.error('Supertonic does not support --gpu on; use CPU or Kokoro.')
    if not args.filename or not args.text_file:
        parser.error('filename and --text-file are required.')
    if Path(args.filename).name != args.filename or not args.filename.lower().endswith('.wav'):
        parser.error('Use a WAV filename without a directory.')
    if not math.isfinite(args.speed) or not 0.7 <= args.speed <= 2:
        parser.error('Speed must be between 0.7 and 2.0.')

    try:
        root = Path(os.environ.get('VIDEO_RUN_ROOT') or Path(__file__).resolve().parent.parent)
        folder = root / ('out/scratch' if args.scratch else 'public/media/audio')
        dest = folder / args.filename
        if os.path.lexists(dest):
            raise FileExistsError(f'{dest} already exists')
        text = args.text_file.read_text(encoding='utf-8').strip()
        if not text:
            raise ValueError('Narration script is empty.')
        model = Path(os.environ.get('VIDEO_TTS_MODEL_DIR') or (Path.home() / '.cache/supertonic3'))
        from supertonic import TTS
        tts = TTS(model_dir=model, auto_download=False, intra_op_num_threads=4)
        audio, _ = tts.synthesize(text=text, voice_style=tts.get_voice_style(voice_name=args.voice), lang=args.lang, speed=args.speed)
        folder.mkdir(parents=True, exist_ok=True)
        with TemporaryDirectory(dir=folder) as temp:
            wav = Path(temp) / 'voice.wav'
            tts.save_audio(audio, str(wav))
            os.link(wav, dest)

        with wave.open(str(dest), 'rb') as wf:
            sr = wf.getframerate()
            frames = wf.getnframes()
        dur = frames / sr
        sha = hashlib.sha256(dest.read_bytes()).hexdigest()
        if args.timings:
            args.timings.parent.mkdir(parents=True, exist_ok=True)
            args.timings.write_text(json.dumps({
                'wav_path': str(dest),
                'wav_sha256': sha,
                'provider': 'CPUExecutionProvider',
                'sample_rate': sr,
                'sample_count': frames,
                'duration_s': round(dur, 6),
                'fps': args.fps,
                'total_frames': int(round(dur * args.fps)),
            }, indent=2), encoding='utf-8')
        print(dest)
    except Exception as error:
        parser.exit(1, f'Voice generation failed: {error}\n')


if __name__ == '__main__':
    main()
