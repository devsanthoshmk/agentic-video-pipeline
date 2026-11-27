# Audio workflow

## Narration & Authoritative Timing

Use local Kokoro 82M (`af_bella` female default, `am_michael` male). Write UTF-8 narration (use `---` between beats for segmented sample-exact beat alignment) and run:

```sh
# Dry-run scratch timing check (writes to out/scratch/, cached by input SHA-256)
VIDEO_RUN=videos/<run> npm run audio:voice -- scratch.wav --text-file videos/<run>/out/narration.txt --voice male --speed 1.08 --scratch --norm --cache --timings videos/<run>/out/beat-map.json

# Batch pronunciation / pacing takes in a single model load
VIDEO_RUN=videos/<run> npm run audio:voice -- --variants videos/<run>/out/variants.json --norm --gpu auto

# Promote approved scratch WAV without re-synthesis
VIDEO_RUN=videos/<run> npm run audio:voice -- --promote-scratch videos/<run>/out/scratch/scratch.wav voiceover.wav
```

GPU acceleration (`--gpu auto|on` or `VIDEO_GPU=1`) uses an isolated GPU environment (`VIDEO_KOKORO_GPU_VENV` / `.venv-gpu`) and probes real `CUDAExecutionProvider` execution before synthesizing, falling back cleanly to the CPU baseline if CUDA fails. Legacy Supertonic (`VIDEO_TTS_ENGINE=supertonic`) supports `--scratch` and `--timings` and cleanly rejects Kokoro-only flags.

## Transcription, Pronunciation Flagging & SRT Captions

```sh
npm run audio:transcribe -- videos/<run>/public/media/audio/voiceover.wav --gpu auto --srt videos/<run>/out/captions.srt
```

Decodes any FFmpeg-supported audio/video track (`--track N`) to 16 kHz mono PCM and runs `faster-whisper-large-v3-turbo` (`cuda` `int8_float16` when `--gpu auto|on`, `cpu` `int8` fallback). ASR mismatches and `< 0.70` word probabilities are **flags only**—critical proper nouns still require listening or user audition.

## Locked-Picture Audio Patching (`audio:patch`)

Patches a single slot on clean stems (`mix-manifest.json` + `voiceover.wav` + optional `music-bed.wav`) without re-rendering video (`-c:v copy`):

```sh
VIDEO_RUN=videos/<run> npm run audio:patch -- --video videos/<run>/out/final.mp4 --out final-v2.mp4 --mix-manifest videos/<run>/out/final.mp4.mix-manifest.json --slot 1.95:6.70 --text-file line2.txt --speed 1.08 --srt final.srt --out-srt final-v2.srt --cue 2 --cue-text "..."
```

- Rejects slot overflow (`replacement > slot`) instead of shifting downstream cues on locked picture.
- Uses deterministic time-keyed gain automation (no global `loudnorm` / stateful ducker) and verifies sample-identical PCM outside the patched window + identical compressed video packet hashes/PTS/DTS.

## Stock Music & Verified-Asset Manifest

```sh
npm run audio:search -- music "calm minimalist electronic"
npm run audio:search -- sound_effect "soft page turn"
npm run audio:search -- download "<official-url>" track.mp3 --source-page "<url>" --creator "<name>" --license "<url>" --title "<title>"
```

Search with generic mood/effect terms only. Never stage preview streams (`cdn.freesound.org/previews/`, `-hq.mp3`) or login-gated personal-use Jamendo files. Verify canonical source-page rights, record SHA-256 + provenance in the manifest, and authorize cross-run/offline reuse explicitly via `verify-cache ... --authorize-reuse`.
