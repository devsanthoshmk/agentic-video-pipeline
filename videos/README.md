# Separate video runs

`npm run video:new -- "Study Intro"` reserves a fresh run (`videos/study-intro-001/`). Same titles get incremented run folders, never reusing prior runs unless explicitly revising an export.

- `brief.md`: prompt, design direction, and edit recipe.
- `src/`: this run's Remotion entry point and scenes.
- `public/`: staged inputs and generated assets.
- `out/`: exports, `beat-map.json`, review sheets/manifests, and credits.

```sh
export VIDEO_RUN=videos/study-intro-001
npm run video:preview                       # Loopback Remotion Studio (127.0.0.1)
npm run video:review -- pre Main            # Immutable bundle + contact sheets + 1:1 stills
npm run video:render -- Main final.mp4 cpu --bundle videos/study-intro-001/out/.bundle-<hash> --stage-only
npm run video:review -- post videos/study-intro-001/out/.staged-<pid>-final.mp4
```

`video:render` uses an external OOM-recovery supervisor (`REMOTION_CONCURRENCY` defaults to `2`, stepping down `4 -> 2 -> 1` on killed workers) and publishes atomically without overwriting existing files. GPU encoding (`gpu` / `--encoder nvenc`) stays opt-in until validated against CPU `libx264` on your target workload.
