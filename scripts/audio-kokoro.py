import argparse
import os
from pathlib import Path
from tempfile import TemporaryDirectory

import soundfile as sf
from kokoro_onnx import Kokoro

parser = argparse.ArgumentParser(description='Generate offline Kokoro narration.')
parser.add_argument('filename')
parser.add_argument('--text-file', type=Path, required=True)
parser.add_argument('--voice', default='af_bella', help='Kokoro voice ID, or female (Bella) / male (Michael)')
parser.add_argument('--lang', default='en', choices=['en', 'en-us', 'en-gb'])
parser.add_argument('--speed', type=float, default=1.0)
args = parser.parse_args()
if Path(args.filename).name != args.filename or not args.filename.lower().endswith('.wav'):
    parser.error('Use a WAV filename without a directory.')
if not 0.7 <= args.speed <= 1.5:
    parser.error('Speed must be between 0.7 and 1.5.')

try:
    root = Path(os.environ.get('VIDEO_RUN_ROOT') or Path(__file__).resolve().parent.parent)
    folder = root / 'public/media/audio'
    dest = folder / args.filename
    if os.path.lexists(dest):
        raise FileExistsError(dest)
    text = args.text_file.read_text(encoding='utf-8').strip()
    if not text:
        raise ValueError('Narration script is empty.')
    model = Path(os.environ['VIDEO_KOKORO_DIR'])
    engine = Kokoro(str(model / 'kokoro-v1.0.onnx'), str(model / 'voices-v1.0.bin'))
    voice = {'female': 'af_bella', 'male': 'am_michael'}.get(args.voice, args.voice)
    lang = ('en-gb' if voice.startswith('b') else 'en-us') if args.lang == 'en' else args.lang
    samples, rate = engine.create(text, voice=voice, speed=args.speed, lang=lang)
    folder.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=folder) as temp:
        wav = Path(temp) / 'narration.wav'
        sf.write(wav, samples, rate, subtype='PCM_16')
        os.link(wav, dest)
    print(dest)
except Exception as error:
    parser.exit(1, f'Voice generation failed: {error}\n')
