# Video workflow reference

## Create or compose (Remotion)

Add components under `src/` (or `videos/<run>/src/`) and register compositions in `Root.tsx`. Keep root `Demo` intact for `npm run smoke`. Use integer frame boundaries (`Math.round(seconds * fps)`), frame-driven animations, and local `staticFile('media/...')` paths.

```sh
npm run typecheck
VIDEO_RUN=videos/<run> npm run video:preview                    # Loopback Studio (127.0.0.1)
VIDEO_RUN=videos/<run> npm run video:preview-stop               # Clean Studio teardown
VIDEO_RUN=videos/<run> npm run video:review -- pre Main --beat-map videos/<run>/out/beat-map.json --slice 140:180
VIDEO_RUN=videos/<run> npm run video:render -- Main final.mp4 cpu --bundle videos/<run>/out/.bundle-<hash> --stage-only
VIDEO_RUN=videos/<run> npm run video:review -- post videos/<run>/out/.staged-<pid>-final.mp4
```

## Edit existing footage & captions (FFmpeg)

All `media:*` helpers preserve cadence, geometry, colorspace, and streams by default, stage privately, and refuse to overwrite existing outputs:

```sh
npm run media:probe -- 'public/media/raw clip.mp4'
VIDEO_RUN=videos/<run> npm run media:trim -- 'public/media/raw.mp4' 2.5 7.5 highlight.mp4
VIDEO_RUN=videos/<run> npm run media:concat -- joined.mp4 clip1.mp4 clip2.mp4 [--normalize]
VIDEO_RUN=videos/<run> npm run media:speed -- highlight.mp4 1.25 fast.mp4
VIDEO_RUN=videos/<run> npm run media:mix -- fast.mp4 vo.wav mixed.mp4 --bed bed.mp4 --vo-offset 0.5
VIDEO_RUN=videos/<run> npm run media:captions -- mixed.mp4 subs.srt captioned.mp4 --mode soft|burn
```

## Conditional Social & Platform Mastering (`video:export`)

Normalization, aspect fit (`contain` pad vs `cover` crop), and HDR→SDR tone-mapping (`zscale` + `tonemap=hable`) apply **only** via explicit export presets (use Remotion to `recompose` layouts):

```sh
VIDEO_RUN=videos/<run> npm run video:export -- videos/<run>/out/final.mp4 youtube-1080p yt-1080p.mp4 --fit contain --encoder libx264
VIDEO_RUN=videos/<run> npm run video:export -- videos/<run>/out/final.mp4 shorts-1080x1920 shorts.mp4 --fit cover
```

Supported presets: `youtube-1080p`, `linkedin-1080p`, `shorts-1080x1920`, `square-1080x1080`. NVENC (`--encoder nvenc`) and Remotion `gpu` remain opt-in until validated against CPU `libx264` on your composition.
