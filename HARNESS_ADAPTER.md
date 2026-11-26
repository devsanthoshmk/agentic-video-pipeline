# Universal Harness Adapter (`HARNESS_ADAPTER.md`)

This repository is an **agentic code-to-video pipeline** built for **OpenCode (V2)** out of the box.  
If you are an AI coding agent (or user) running inside **another agent harness / runner** (such as **Claude Code**, **OpenAI Codex CLI**, **Cursor**, **Windsurf**, **Gemini CLI**, **Cline / Roo Code**, **GitHub Copilot**, or a custom single-agent runner), read this file first and follow the adaptation protocol below so the entire pipeline works seamlessly in your environment.

---

## 1. How the Pipeline Works

The pipeline separates **orchestration**, **creative direction**, **code/media execution**, and **verification** into deterministic local tools and specialized agent roles:

### Core Engines & Scripts (`scripts/`, `src/`, `videos/`)
- **Run Isolation (`scripts/new-video.mjs`, `scripts/video-run.mjs`)**:  
  Every new video or clean remake starts with `npm run video:new -- "Title"`, which allocates `videos/<slug>-001/` with isolated `brief.md`, `src/`, `public/`, and `out/` directories. Setting `VIDEO_RUN=videos/<run>` scopes `video:preview`, `video:render`, `media:trim`, and `audio:voice` to that run.
- **Motion Graphics (`src/`, `remotion`)**:  
  React + TypeScript compositions rendered frame-by-frame to H.264 MP4 via Remotion (`npm run video:preview`, `npm run video:render -- Main final.mp4 [cpu|gpu]`).
- **Footage Editing (`scripts/media.mjs`, `ffmpeg`, `ffprobe`)**:  
  Probes local media (`npm run media:probe -- <file>`) and performs safe, non-overwriting trims (`npm run media:trim -- <file> <start> <duration> <out.mp4>`).
- **Offline Narration (`scripts/audio-voice.mjs`, `scripts/audio-kokoro.py`)**:  
  Generates local English WAV voiceovers via Kokoro 82M (`VIDEO_KOKORO_DIR`, default `~/.cache/kokoro-82m`).
- **Stock Audio (`scripts/audio-search.mjs`)**:  
  Searches Openverse for CC0 / CC BY music and sound effects without uploading local media or briefs.
- **Verification (`npm run smoke`, `ffprobe`, `ffmpeg -xerror`)**:  
  `npm run typecheck && npm run test:media && node scripts/test-render.mjs` verifies TypeScript, FFmpeg trim safety, and a full 150-frame Remotion render.

### Multi-Agent Hierarchy
```text
L0 Main (Orchestrator / Integrator)
  ├── L1 Story Lead (video-planner)
  │     ├── L2 Writer (video-writer)        -> out/script-draft.md
  │     └── L2 Script Editor (video-script-editor) -> out/script-final.md
  ├── L1 Visual Lead (video-visual-lead)
  │     ├── L2 Art Director (video-art-director)   -> out/art-direction.md
  │     ├── L2 Motion Designer (video-motion-designer) -> signature prototype
  │     └── L2 Builder (video-builder)      -> assigned scenes / FFmpeg edits
  ├── L1 Sound Lead (video-sound-lead)
  │     ├── L2 Stock Scout (video-stock-scout)     -> Openverse leads + credits
  │     └── L2 Builder (video-builder)      -> voiceover + audio mix
  └── L1 Reviewer (video-reviewer)
        ├── L2 Picture & Motion QA (video-quality-checker)
        └── L2 Audio & Provenance QA (video-quality-checker)
```

### Skills & Quality Gates
- **Visual Design**: `.opencode/skills/frontend-design/SKILL.md` (art direction and visual hierarchy)
- **Remotion Implementation**: `.agents/skills/remotion-best-practices/SKILL.md` (frame-driven animations, sequencing, audio, typography, layouts)
- **Workflow Docs**: `docs/video-workflow.md`, `docs/video-production.md`, `docs/video-design.md`, `docs/audio-workflow.md`

---

## 2. Out-of-the-Box Harness: OpenCode (V2)

When opened in **OpenCode** or **OpenChamber**, no adaptation is needed:
- `AGENTS.md` is loaded automatically as project instructions.
- `opencode.jsonc` configures the default model and `experimental.subagent_depth: 6`.
- `.opencode/agents/*.md` registers all 11 subagent profiles (`video-planner`, `video-writer`, `video-script-editor`, `video-visual-lead`, `video-art-director`, `video-motion-designer`, `video-builder`, `video-sound-lead`, `video-stock-scout`, `video-reviewer`, `video-quality-checker`).
- `.opencode/skills/frontend-design/` and `.agents/skills/remotion-best-practices/` are discovered natively by OpenCode's `skill` tool.

---

## 3. Agent Self-Adaptation Protocol (For Other Harnesses)

If you are an agent running in a **non-OpenCode harness**, **do not** ignore `AGENTS.md` or `.opencode/agents/`. Instead, adapt the workspace configuration to match your harness's native conventions while keeping `scripts/`, `src/`, `docs/`, and `videos/` intact.

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
| **Read-Only Roles** | `permissions: edit deny` in frontmatter | Set read-only tools in `.claude/agents/` | Enforce via prompt ("Do not edit files") | Enforce via prompt ("Review/plan only") | Enforce via prompt ("Review/plan only") |

### Step 3: Adapt Subagent Frontmatter (If Converting `.opencode/agents/*.md`)
Each file in `.opencode/agents/*.md` has YAML frontmatter:
```yaml
---
description: ...
mode: subagent
permissions:
  - action: edit
    resource: "*"
    effect: deny
---
```
When translating to another harness (such as `.claude/agents/*.md`):
1. Keep the `description` and markdown body intact.
2. Replace `mode: subagent` with your harness's equivalent (or omit if all files in `.claude/agents/` are subagents).
3. Translate `permissions: edit deny` (used on `video-planner`, `video-visual-lead`, `video-sound-lead`, `video-reviewer`, `video-quality-checker`, `video-stock-scout`) into your harness's read-only tool allowlist (e.g., `tools: Read, Grep, Glob, Bash` without `Edit`/`Write`, or explicit instruction not to modify source files).
4. **Never pin unavailable models.** Workers inherit the active session model unless the user explicitly configures otherwise.

### Step 4: Fallback for Single-Agent / No-Subagent Harnesses
If your harness cannot spawn child sessions (or nested subagent depth is limited to 1):
1. **Do not skip stages.** Execute the L1/L2 roles **sequentially in the main session** in the exact order defined in `docs/video-production.md`:
   - Role 1 (`video-writer`): Write `out/script-draft.md`
   - Role 2 (`video-script-editor`): Critique and write `out/script-final.md`
   - Role 3 (`video-art-director`): Explore 2 treatments and select direction in `out/art-direction.md`
   - Role 4 (`video-motion-designer`): Prototype signature sequence
   - Role 5 (`video-stock-scout` + `video-builder`): Source audio, generate voiceover, build scenes
   - Role 6 (`video-reviewer` / `video-quality-checker`): Run `npm run smoke`, `ffprobe`, `ffmpeg -xerror`, and frame/audio checks
2. **Preserve file ownership boundaries** between steps so artifacts remain clean and auditable.
3. **Disclose in your final summary** that review was performed sequentially in the main session rather than by independent child sessions.

### Step 5: Verify Adaptation
Before starting video work on a newly adapted harness, run:
```sh
npm run smoke
```
This confirms Node.js, TypeScript, FFmpeg/FFprobe, and Remotion rendering all work in your environment.
