# Creative video production

Preserve every creative and independent QA specialist while eliminating unnecessary relay hops, blind TTS retry loops, throwaway prototypes, and duplicate full encodes.

## 1. Authoritative Dependency Graph (New Videos & Major Revisions)

1. **Parallel Concept & Story Start:**
   - **Story (`video-writer` → `video-script-editor`):** `video-writer` drafts `out/script-draft.md` grounded in supplied facts. `video-script-editor` rewrites to `out/script-final.md` and runs `npm run audio:voice -- scratch.wav --text-file ... --scratch --norm --cache --timings out/beat-map.json` using the exact delivery voice, language, speed, and `---` segmentation. Join seams on multi-segment takes must be verified before **Authoritative Narration Lock** (publishing approved `wav_sha256`, `sample_rate`, `sample_count`, and FPS-derived `beat-map.json`).
   - **Art Direction (`video-art-director`, parallel):** Loads `frontend-design`, compares two subject-specific treatments, selects one in `out/art-direction.md` with named type roles, palette, evidence plan, and rejected generic style.
   - **Stock Audio (`video-stock-scout`, parallel; never blocks Story/VO):** Runs `npm run audio:search` with generic mood/effect terms, verifies canonical source-page rights, downloads authorized originals (`audio:search download` or `verify-cache --authorize-reuse`), and logs provenance in `out/stock-search.md`.
2. **Reusable Motion Primitives (`video-motion-designer`, unlocked by Narration Lock + Art Direction):**
   - Loads `frontend-design` and `remotion-best-practices`. Writes shared `src/theme.ts` and reusable canvas/transition primitives directly (no throwaway `SignaturePrototype.tsx` unless explicitly requested).
   - **Motion Lock:** Verified at **real-time playback speed** via `npm run video:review -- pre ... --slice start:end` or Studio live playback—static stills alone do not unlock scene builds.
3. **Parallel Scene Builds & Final Mix (unlocked by Motion Lock + Authoritative Beat-Map):**
   - `N × video-builder`: Each owns disjoint scene file(s) only (`src/scenes/...`); never edits `Root.tsx` or shared files.
   - `video-builder` (Audio Mix, unlocked once approved VO + Stock Asset + picture duration exist): Promotes exact approved VO hash (`--promote-scratch` or cached WAV—never re-synthesizes), builds deterministic mix via `media:mix` / FFmpeg + `mix-manifest.json`, logs `out/<export>-credits.md` from exact staged file hashes, and runs `audio:transcribe` to flag low-confidence proper nouns and generate `.srt`.
4. **Integration & Single Immutable Bundle (`L0 Main`):**
   - Main integrates `src/Root.tsx` and main composition, runs `npm run typecheck`, then runs `npm run video:review -- pre <Comp> --beat-map out/beat-map.json [--slice s0:s1]` to build **one** immutable bundle (`snapshot_hash` + `render_spec_hash`), labeled contact sheets (labels in margin banners outside pixels), 1:1 native stills, `360px` playback-width previews, and any transition slice.
5. **Two-Phase QA & Release Decision Table:**
   - **Pre-Encode QA:** Main dispatches two fresh `video-quality-checker` sessions in parallel (Picture/Motion & Audio/Provenance) with read-only artifacts (`edit` and `shell` denied), then sends both structured reports to `video-reviewer` for adjudication. (Optional depth-2 nested dispatch under `video-reviewer` is allowed for >3 min productions; single-agent fallback must be disclosed as **non-independent**.)
   - **Single Staged Final Render:** Once Pre-Encode QA passes, Main runs `VIDEO_RUN=videos/<run> npm run video:render -- <Comp> final.mp4 [cpu|gpu] --bundle <bundleDir> --stage-only` (never rebundling mutable source).
   - **Post-Encode QA:** Main runs `npm run video:review -- post <staged.mp4> --beat-map out/beat-map.json --snapshot-hash <H> --render-spec-hash <H>` (`ffprobe`, full `ffmpeg -v error -xerror` decode, `ebur128` LUFS/`dBTP` on decoded muxed audio, encoded sample stills, A/V sync anchor check), and checkers/reviewer verify parity against matching hashes.

| Release Gate State | Status | Action |
| :--- | :--- | :--- |
| All Pre-Encode + Post-Encode gates = `pass` on matching `snapshot_hash` + `render_spec_hash` + `staged_export_hash` | **Verified Release** | Atomically publish staged file to `final.mp4` |
| Any mandatory gate = `fail` | **Blocked** | Keep unpublished; return evidence to owner, fix, invalidate stale reports, re-verify affected hashes |
| Any mandatory gate = `pending` (e.g., headless listening or media privacy) | **Provisional / Unverified Handoff** | Publish only with explicit user acceptance of provisional status and local verification steps; never claim verified |
