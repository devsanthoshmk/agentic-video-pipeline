# Separate video runs

`npm run video:new -- "Study Intro"` reserves a fresh run, such as `videos/study-intro-001/`. The same title again gets `study-intro-002/`, never an existing run. The main agent allocates it once and gives that path to every worker.

- `brief.md`: prompt, design direction and edit recipe.
- `src/`: this run's Remotion entry point and scenes, if needed.
- `public/`: this run's staged inputs and generated assets.
- `out/`: this run's exports, preview frames, working files and credits.

From the workspace root (substitute the actual run path):

```sh
export VIDEO_RUN=videos/study-intro-001
npm run video:preview
npm run video:render -- Main final.mp4
```

Reuse the Studio URL for review rather than launching separate browsers per frame. Run the final export once; this command preserves the composition's resolution and frame rate and refuses to overwrite. To try the RTX 3050 on a comparable 720p composition, use `npm run video:render -- Main final-gpu.mp4 gpu`. This selects NVENC at 8 Mbps, not GPU acceleration for JSX layout or drawing. Expect a different file size; this preset is not a quality guarantee for different scenes or resolutions. If NVENC fails or the result doesn't pass review, rerun with `cpu` (the default).

For FFmpeg-only edits, write directly to the run's `out/` using `ffmpeg -n`. The narration and media trim helpers also respect `VIDEO_RUN`. Use the input paths supplied for this job; do not search old runs for a substitute. The root demo and shared tools remain separate from production runs.
