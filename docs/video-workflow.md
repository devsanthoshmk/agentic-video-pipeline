# Video workflow reference

## Create or compose

Add a component under `src/` and register it under a distinct composition ID in `src/Root.tsx`. Keep `Demo` intact for the smoke test. Use integer frame boundaries (`Math.round(seconds * fps)`), frame-driven animations, and local `staticFile('media/...')` paths. Stage authorized assets in `public/media/`; avoid relying on remote assets. Keep text inside safe margins and verify that captions don't overlap or clip. Render stills at meaningful frames before committing to a long export.

```sh
npm run typecheck
npm run studio
npm run still -- Demo out/demo-frame.png --frame=48 --overwrite=false
npm run render -- Demo out/demo.mp4 --overwrite=false --concurrency=2
```

## Edit existing footage

```sh
npm run media:probe -- 'public/media/raw clip.mp4'
npm run media:trim -- 'public/media/raw clip.mp4' 2.5 7.5 highlight.mp4
```

`trim` takes a start and a **duration** in seconds and publishes to `out/`. Use a reviewed FFmpeg command for other edits. Quote paths, use local inputs, select wanted video/audio streams deliberately, use `-n` and a new destination, and keep the exact edit recipe. For edits where keyframe alignment matters, re-encode instead of blindly using stream copy. If you need captions, accept a transcript or SRT from the user; no transcription engine is installed by default.

## Verify each export

```sh
ffprobe -v error -show_streams -show_format -of json out/highlight.mp4
ffmpeg -v error -xerror -i out/highlight.mp4 -map 0:v:0 -map '0:a?' -f null -
```

Compare duration, resolution, FPS, aspect and audio streams against the brief. Check cut boundaries, text, layout and levels using local playback or stills, or state that visual/audio review remains. A successful render or decode does not prove the creative brief was met. For sensitive footage, let the user review locally unless they explicitly allow sending frames to the model.
