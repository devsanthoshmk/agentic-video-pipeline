# Video workspace

> **Using a non-OpenCode harness (Claude Code, Codex, Cursor, Gemini CLI, Windsurf, etc.)?** Read [HARNESS_ADAPTER.md](HARNESS_ADAPTER.md) first and adapt the workspace instructions, agent profiles, and skills to your active runner before starting.

For requests to create, edit, preview or export video, follow this workflow. In this workspace, a request to create or edit a video counts as a request to export a playable file for the Remotion skill, unless the user asks for a plan or preview only.

**Isolation.** For every new video or clean remake, run `npm run video:new -- "Title"` once before delegating or writing files. Use its returned `videos/<run>/` folder for the brief, source, staged media and exports. A repeated title or prompt still gets a fresh run. Do not copy or import prior runs' designs, code, or assets unless requested. For an explicit revision of an existing export, identify the target run and write a new filename there. See [run commands](videos/README.md).

1. **Brief.** Identify intended output, audience, aspect, duration, required text, and source assets. Ask only when a missing asset or consequential decision blocks work. For new motion graphics default to 1280×720, 30 fps, H.264 MP4. For footage edits preserve aspect, cadence and audio unless asked otherwise. Probe footage before planning edits.
2. **Route.** Trim, crop, resize, splice and transcode existing footage with FFmpeg. Use Remotion for composed scenes, animated text, graphics, captions or overlays; load `remotion-best-practices` and read the linked rules for the APIs you use. See [workflow reference](docs/video-workflow.md) for commands and verification.
3. **Plan and implement.** Do one straightforward operation directly. For original creative videos and substantive remakes, follow the [production playbook](docs/video-production.md): delegate script drafting and rewriting separately, art direction and motion separately, and stock sourcing and mix separately. This applies even to short portfolio videos. For other multi-stage edits, use `video-planner` and separate `video-builder` assignments. The main agent integrates and renders.
4. **Verify.** For multi-stage work delegate to `video-reviewer` with the brief, source metadata, artifact path and expected checks. Verify simple edits directly. Return failures to the original worker with evidence and retest; after three unsuccessful correction rounds report the blocker.
5. **Deliver.** Report the actual run export path, duration, resolution and checks performed. Say what remains unverified. Leave source media untouched and keep editable composition code or the edit recipe.

```text
L0 Main → L1 Story lead → L2 Writer, then Script editor
        → L1 Visual lead → L2 Art direction, then Motion design and scene build
        → L1 Sound lead → L2 Stock sourcing, then Voice and mix
        → L1 Reviewer → L2 Independent picture and sound checks
```

**Model breakdown.** Gemini 3.8 Flash is the project default. Keep routine edits on Flash; select a higher reasoning variant or Gemini Pro if available for complex scripts, timing and review. Workers have no model pin: they inherit the session model. Do not switch providers or assume another model is available. If dispatch is unavailable, execute the roles in order in the main session and state that review was not independent.

**Handoffs.** Give each worker the brief, input/output paths, owned files, dependencies, expected checks, and what it must return. Leads may delegate their assigned lane; workers never restart this orchestration. Do not send local footage, frames or audio to external services or model tools without permission; metadata-only verification can stay local.

**Visual design.** Before planning or coding new or restyled video visuals (Remotion JSX/CSS, titles, overlays, or HTML/CSS), load `frontend-design` and follow the [video design gate](docs/video-design.md). Give its rubric to the planner, builder, and reviewer on delegated jobs. Skip for footage-only edits that leave the design unchanged.

**Render speed.** Use the [run preview and export commands](videos/README.md). Keep one Studio preview for frame checks and one final render at a time. Parallelize independent asset prep and narration, not competing render jobs. Keep CPU as the final-quality baseline; use the GPU option only for a comparable, validated 720p workload.

**Audio.** For narration, stock music or sound effects, audio-only exports, or mixing, read [audio workflow](docs/audio-workflow.md). On multi-stage jobs, delegate audio sourcing or narration as a separate `video-builder` workstream when independent of the visuals.
