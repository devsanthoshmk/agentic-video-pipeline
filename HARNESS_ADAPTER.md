# Universal Harness Adapter (`HARNESS_ADAPTER.md`)

This repository is an **agentic code-to-video pipeline** built for **OpenCode (V2)** out of the box.
If you are an AI coding agent (or user) running inside **another agent harness / runner** (such as **Claude Code**, **OpenAI Codex CLI**, **Cursor**, **Windsurf**, **Gemini CLI**, **Cline / Roo Code**, **GitHub Copilot**, or a custom single-agent runner), read this file first and follow the adaptation protocol below so the entire pipeline works seamlessly in your environment.

---

## 1. How the Pipeline Works

The pipeline separates **orchestration**, **creative direction**, **code/media execution**, and **verification** into deterministic local tools and specialized agent roles:

### Core Engines & Scripts (`scripts/`, `src/`, `videos/`)
- **Run Isolation (`scripts/new-video.mjs`, `scripts/video-run.mjs`)**:  
  Every new video or clean remake starts with `npm run video:new -- "Title"`, which allocates `videos/<slug>-001/` with isolated `brief.md`, `src/`, `public/`, and `out/` directories. Setting `VIDEO_RUN=videos/<run>` scopes `video:preview`, `video:render`, `video:review`, `video:export`, `media:*`, `audio:voice`, `audio:search`, and `audio:patch` to that run.
- **Motion Graphics & Single-Bundle Review (`src/`, `scripts/review-bundle.mjs`, `scripts/video-render.mjs`)**:  
  React + TypeScript compositions rendered via `@remotion/bundler` + `@remotion/renderer` (`npm run video:preview` for loopback `127.0.0.1` Studio, `npm run video:review -- pre` for single-bundle contact sheets + 1:1 native crops + 360px playback previews + transition slices, `npm run video:render` inside an OOM-recovery supervisor, and `npm run video:review -- post` for post-encode verification).
- **Footage Editing & Mastering (`scripts/media.mjs`, `scripts/video-render.mjs export`, `ffmpeg`, `ffprobe`)**:  
  Probes local media (`media:probe`) and performs non-overwriting `media:trim`, `media:concat`, `media:speed`, `media:mix`, `media:captions`, and conditional platform mastering (`youtube-1080p`, `linkedin-1080p`, `shorts-1080x1920`, `square-1080x1080`).
- **Offline Narration & Locked-Picture Patching (`scripts/audio-voice.mjs`, `scripts/audio-kokoro.py`, `scripts/audio-patch.mjs`)**:  
  Generates local English WAV voiceovers via Kokoro 82M (`VIDEO_KOKORO_DIR`, default `~/.cache/kokoro-82m`, optional isolated GPU venv via `VIDEO_KOKORO_GPU_VENV` / `--gpu auto|on`), supports `--scratch`, `--norm`, `--cache`, `--timings` (`beat-map.json`), `--variants`, and stem-based `-c:v copy` locked-picture audio patching (`audio:patch`).
- **Transcription & Stock Audio (`scripts/transcribe.mjs`, `scripts/audio-search.mjs`)**:  
  Local `faster-whisper` (`VIDEO_WHISPER_DIR`, optional CUDA via `--gpu auto|on`, CPU `int8` baseline) for pronunciation flags & `.srt` generation, plus Openverse CC0/CC BY search & verified-asset manifest staging (`audio:search`).
- **Verification (`npm run smoke`, `ffprobe`, `ffmpeg -xerror`)**:  
  `npm run typecheck && npm run test:media && node scripts/test-render.mjs` verifies TypeScript, FFmpeg media safety, and a full 150-frame Remotion render.

### Multi-Agent Workflow (Depth-1 Default)
```text
L0 Main (Orchestrator / Integrator / Single-Bundle & Render Supervisor)
  ├── [Wave 1] video-writer -> video-script-editor (--scratch TTS + Authoritative Narration Lock)
  ├── [Wave 1] video-art-director -> out/art-direction.md
  ├── [Wave 1] video-stock-scout -> verified-asset manifest + staged audio (writable)
  ├── [Wave 2] video-motion-designer -> theme.ts + reusable primitives -> real-time Motion Lock
  ├── [Wave 3] N x video-builder (disjoint scenes) || video-builder (final mix + mix-manifest.json)
  └── [Wave 4] Pre-Encode & Post-Encode QA:
                 2 x video-quality-checker (parallel, edit+shell denied) -> video-reviewer (adjudication)
```
*(Optional depth-2 leads `video-visual-lead` and `video-sound-lead` remain available for >3 min productions.)*

### Skills & Quality Gates
- **Visual Design**: `.opencode/skills/frontend-design/SKILL.md` (art direction and visual hierarchy)
- **Remotion Implementation**: `.agents/skills/remotion-best-practices/SKILL.md` (frame-driven animations, sequencing, audio, typography, layouts)
- **Workflow Docs**: `docs/video-workflow.md`, `docs/video-production.md`, `docs/video-design.md`, `docs/audio-workflow.md`

---

## 2. Out-of-the-Box Harness: OpenCode (V2)

When opened in **OpenCode** or **OpenChamber**, no adaptation is needed:
- `AGENTS.md` is loaded automatically as project instructions.
- `opencode.jsonc` configures the default model and `experimental.subagent_depth: 6`.
- `.opencode/agents/*.md` registers all 11 subagent profiles.
- `.opencode/skills/frontend-design/` and `.agents/skills/remotion-best-practices/` are discovered natively by OpenCode's `skill` tool.

---

## 3. Agent Self-Adaptation Protocol (For Other Harnesses)

If you are an agent running in a **non-OpenCode harness**, adapt the workspace configuration to match your harness's native conventions while keeping `scripts/`, `src/`, `docs/`, and `videos/` intact.

### Step 1: Detect Your Harness
Check which instruction files, agent directories, skill loaders, and subagent tools your runtime supports:
- Can you spawn subagents? (e.g., `Task` / `subagent` tool, `.claude/agents/`, or none)
- Which project instruction file does your harness auto-load? (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/`, `.windsurfrules`, `.github/copilot-instructions.md`)
- Does your harness have a native skill loader? (`.claude/skills/`, `.agents/skills/`, or manual file reading)

### Step 2: Apply the Harness Mapping

| Capability | OpenCode (Native) | Claude Code | OpenAI Codex CLI | Cursor / Windsurf | Gemini CLI / Other Runners |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Root Instructions** | `AGENTS.md` | Copy/symlink `AGENTS.md` → `CLAUDE.md` | `AGENTS.md` (native) | Copy into `.cursor/rules/video-pipeline.mdc` or `.windsurfrules` | Copy/symlink `AGENTS.md` → `GEMINI.md` or system prompt |
| **Subagent Profiles** | `.opencode/agents/*.md` | Copy/convert to `.claude/agents/*.md` (map `permissions` to `tools`/`disallowedTools`) | Pass role prompts inline when spawning subagents | Use `@file` or custom modes referencing `.opencode/agents/*.md` | Execute roles sequentially in main session (see Step 4) |
| **Skills** | `.opencode/skills/` + `.agents/skills/` | Run `npx skills add remotion-dev/skills --agent claude-code` or symlink to `.claude/skills/` | `.agents/skills/` (native) or read `SKILL.md` directly | Read `.opencode/skills/frontend-design/SKILL.md` & `.agents/skills/remotion-best-practices/SKILL.md` directly | Read `SKILL.md` files directly before planning/coding |
| **Model Config** | `opencode.jsonc` | Ignore `opencode.jsonc`; use your harness's model/profile | Ignore `opencode.jsonc`; use Codex model settings | Ignore `opencode.jsonc`; use IDE model selector | Ignore `opencode.jsonc`; use active session model |
| **Read-Only Roles** | `permissions: edit deny` (+ `shell deny` on QA) | Set read-only tools in `.claude/agents/` | Enforce via prompt ("Review/plan only; no edits or shell writes") | Enforce via prompt | Enforce via prompt |

### Step 3: Adapt Subagent Frontmatter (If Converting `.opencode/agents/*.md`)
1. Keep the `description` and markdown body intact.
2. Replace `mode: subagent` with your harness's equivalent.
3. Map permissions accurately:
   - **Edit-denied (`video-planner`, `video-visual-lead`, `video-sound-lead`):** restrict file modification tools.
   - **Edit + Shell denied (`video-reviewer`, `video-quality-checker`):** read-only inspection only (Main pre-generates all review sheets/probes).
   - **Writable (`video-writer`, `video-script-editor`, `video-art-director`, `video-motion-designer`, `video-stock-scout`, `video-builder`):** allowed to write only their owned deliverables.
4. **Never pin unavailable models.** Workers inherit the active session model unless explicitly configured.

### Step 4: Fallback for Single-Agent / No-Subagent Harnesses
If your harness cannot spawn child sessions (or limits nesting):
1. **Depth-1 dispatch** (when `subagent` depth = 1): Main executes the depth-1 waves directly, dispatching `video-quality-checker` #1 and #2 in parallel and sending their reports to `video-reviewer`.
2. **Single-agent sequential fallback** (when no subagents are available): Execute each role sequentially in the main session preserving file ownership boundaries (`script-draft.md` → `script-final.md` + `beat-map.json` → `art-direction.md` → `stock-search.md` → `theme.ts` + reusable motion → scenes + mix → `video:review -- pre` → `video:render --stage-only` → `video:review -- post`). **Disclose in your final summary that review was non-independent.**

### Step 5: Verify Adaptation
Before starting video work on a newly adapted harness, run:
```sh
npm run smoke
```
