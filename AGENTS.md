# Video workspace

> **Using a non-OpenCode harness (Claude Code, Codex, Cursor, Gemini CLI, Windsurf, etc.)?** Read [HARNESS_ADAPTER.md](HARNESS_ADAPTER.md) first and adapt the workspace instructions, agent profiles, and skills to your active runner before starting.

For requests to create, edit, preview or export video, follow this workflow. A request to create or edit a video counts as a request to export a playable MP4 unless the user asks for a plan or preview only.

**Isolation.** For every new video or clean remake, run `npm run video:new -- "Title"` once before delegating or writing files. Use its returned `videos/<run>/` folder for `brief.md`, `src/`, `public/`, and `out/`. A repeated title gets a fresh run. Do not copy or import prior runs' designs, code, or assets unless explicitly requested. For a revision of an existing export, target that run and write a new filename without overwriting prior exports. See [run commands](videos/README.md).

1. **Brief.** Identify output, audience, aspect (`16:9`, `9:16`, `1:1`), duration, required text, and source assets. Default motion graphics to `1280×720`, `30 fps`, H.264 MP4 (or requested social preset). For footage edits preserve cadence, geometry, colorspace, and streams unless a preset/flag explicitly requests normalization. Probe footage before planning edits.
2. **Route by Scope.**
   - **Footage edits & targeted patches (`trim`, `concat`, `speed`, `mix`, `captions`, `audio:patch`, `video:export`):** Execute directly with `scripts/media.mjs` / `scripts/audio-patch.mjs` / `scripts/video-render.mjs`, or use `video-planner` (for multi-stage EDLs) and one fresh `video-builder`. Skip `frontend-design` and scene builders when visual design is unchanged.
   - **Original creative videos & major revisions:** Follow the [production playbook](docs/video-production.md) using **depth-1 parallel specialist waves** (preserving every creative and QA specialist without middleman relay hops; keep optional `L1` leads only for massive >3 min productions).
3. **Authoritative Narration Lock.** Lock script + authoritative narration WAV (`--scratch` dry-run → `--cache` + `--timings` `beat-map.json`) before timing-dependent motion or scene construction.
4. **Verify (Two-Phase QA & Release Decision Table).** Main prepares deterministic review artifacts (`npm run video:review -- pre` / `post`), dispatches two fresh `video-quality-checker` sessions in parallel, and sends their structured reports to `video-reviewer` for independent adjudication (or discloses self-review as non-independent if dispatch is unavailable). Pre-encode reports bind to `{ run, snapshot_hash, render_spec_hash, gate, checker_session_id }`; post-encode reports bind to `{ run, snapshot_hash, render_spec_hash, staged_export_hash, gate, checker_session_id }`. Stale reports after edits are rejected. See the Release Decision Table in `docs/video-production.md`.
5. **Deliver.** Atomically publish `final.mp4` only after matching gates pass (or mark provisional with explicit user acceptance when a mandatory gate such as human listening or restricted-media inspection is `pending`). Report export path, duration, resolution, stream/loudness checks, and pending gates.

```text
Depth-1 Default Orchestration:
  [Wave 1] video-writer -> video-script-editor (with --scratch TTS -> Narration Lock)
           || video-art-director (art-direction.md)
           || video-stock-scout (verified-asset manifest + staged audio)
  [Wave 2] video-motion-designer (reusable theme.ts + motion primitives -> real-time Motion Lock)
  [Wave 3] N x video-builder (disjoint scenes) || video-builder (final mix from approved WAV hash)
  [Wave 4] Main integrates Root -> Single Immutable Bundle -> Pre-Encode QA (2 checkers -> reviewer)
           -> Single final.mp4 Render -> Post-Encode QA -> Release Decision Table
```

**Model & Session Hygiene.** Workers inherit the active session model by default; do not pin unavailable models or switch providers silently. Start **fresh scoped sessions** for new briefs, materially changed revisions, and independent QA gates (passing a compact manifest, never bloated transcripts); resume a worker session only for bounded fixes against the same artifact set. Keep CPU `libx264`, CPU Kokoro, and CPU Whisper as rollback baselines; GPU paths (`--gpu auto|on`, `--encoder nvenc`, Remotion `gpu`) are opt-in/capability-probed with logged execution providers.

**Visual design.** Before planning or coding new/restyled visuals, load `frontend-design` and follow [video design gate](docs/video-design.md). Motion designers and scene builders also load `remotion-best-practices`.

**Render & Hardware Safety.** Keep one loopback (`127.0.0.1`) Studio session and one render supervisor at a time (default `REMOTION_CONCURRENCY=2` with stepped-down OOM recovery `4 -> 2 -> 1`). Never run concurrent Remotion renders alongside heavy GPU inference.

**Audio.** Follow [audio workflow](docs/audio-workflow.md) for narration timing, GPU transcription/SRT (`audio:transcribe`), verified stock manifests (`audio:search`), and locked-picture stem patching (`audio:patch`).
