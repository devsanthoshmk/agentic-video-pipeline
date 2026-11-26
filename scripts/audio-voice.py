import argparse
import math
import os
from pathlib import Path
from tempfile import TemporaryDirectory


def main():
    parser = argparse.ArgumentParser(description='Generate local Supertonic narration.')
    parser.add_argument('filename', help='New WAV filename, written to public/media/audio/')
    parser.add_argument('--text-file', required=True, type=Path, help='UTF-8 narration script')
    parser.add_argument('--voice', choices=[f'{group}{i}' for group in 'FM' for i in range(1, 6)], default='F1')
    parser.add_argument('--lang', default='en', help='Supertonic language code; use na for language-agnostic')
    parser.add_argument('--speed', type=float, default=1.05)
    args = parser.parse_args()
    if Path(args.filename).name != args.filename or not args.filename.lower().endswith('.wav'):
        parser.error('Use a WAV filename without a directory.')
    if not math.isfinite(args.speed) or not 0.7 <= args.speed <= 2:
        parser.error('Speed must be between 0.7 and 2.0.')

    try:
        root = Path(__file__).resolve().parent.parent
        run = os.environ.get('VIDEO_RUN_ROOT')
        folder = (Path(run) if run else root) / 'public/media/audio'
        dest = folder / args.filename
        if os.path.lexists(dest):
            raise FileExistsError(f'{dest} already exists')
        text = args.text_file.read_text(encoding='utf-8').strip()
        if not text:
            raise ValueError('Narration script is empty.')
        default_dir = Path.home() / '.cache/supertonic3'
        model = Path(os.environ.get('VIDEO_TTS_MODEL_DIR') or default_dir)
        from supertonic import TTS
        tts = TTS(model_dir=model, auto_download=False, intra_op_num_threads=4)
        audio, _ = tts.synthesize(text=text, voice_style=tts.get_voice_style(voice_name=args.voice), lang=args.lang, speed=args.speed)
        folder.mkdir(parents=True, exist_ok=True)
        with TemporaryDirectory(dir=folder) as temp:
            wav = Path(temp) / 'voice.wav'
            tts.save_audio(audio, str(wav))
            os.link(wav, dest)
        print(dest)
    except Exception as error:
        parser.exit(1, f'Voice generation failed: {error}\n')


if __name__ == '__main__':
    main()
