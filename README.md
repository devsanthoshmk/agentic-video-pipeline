# OpenCode Video Pipeline

**Agentic code-to-video and footage editing pipeline powered by Remotion, FFmpeg, Kokoro TTS, and Openverse.**  
Works out of the box with **OpenCode (V2)** and includes a universal [`HARNESS_ADAPTER.md`](HARNESS_ADAPTER.md) so AI coding agents in **Claude Code, Codex CLI, Cursor, Windsurf, Gemini CLI**, and other runners can adapt and run the entire workflow seamlessly.

[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Remotion](https://img.shields.io/badge/Remotion-4.0-0B84F3?logo=react&logoColor=white)](https://www.remotion.dev/)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-Local%20Pipeline-007808?logo=ffmpeg&logoColor=white)](https://ffmpeg.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Why This Pipeline?

Most AI video workflows either rely on opaque cloud generators or dump single-prompt React code into a shared folder. **OpenCode Video Pipeline** gives your AI coding agent a structured, reproducible local production studio:

- **Programmatic Motion Graphics (Remotion + React/TypeScript):** Build frame-accurate animations, kinetic typography, data visualizations, and multi-scene compositions locally.
- **Deterministic Footage Editing (FFmpeg + FFprobe):** Probe, trim, crop, splice, and transcode existing video clips with non-destructive, atomic exports (`-n`, no accidental overwrites).
- **Isolated Video Runs (`videos/<run>/`):** Every new video or remake gets its own sandboxed `brief.md`, `src/`, `public/`, and `out/` directory—never overwriting prior work.
- **Multi-Agent Production Crew:** 11 specialized OpenCode agent roles (`video-planner`, `video-writer`, `video-script-editor`, `video-visual-lead`, `video-art-director`, `video-motion-designer`, `video-builder`, `video-sound-lead`, `video-stock-scout`, `video-reviewer`, `video-quality-checker`) with strict creative and technical quality gates.
- **Offline English Voiceover (Kokoro 82M) & Stock Audio (Openverse):** Generate local narration WAVs and search CC0 / CC BY music and sound effects with automatic credit tracking.
- **Universal Harness Adapter:** Ships with [`HARNESS_ADAPTER.md`](HARNESS_ADAPTER.md) so any AI agent can map the instructions, subagents, and skills to its own runtime.

---

## Quick Start

### Prerequisites
- **Node.js 22+** and **npm**
- **FFmpeg** (with `libx264` and `aac`) and **FFprobe** on `PATH`
- *(Optional, for local narration)* Python environment with `kokoro-onnx` and `soundfile` (see [Audio Workflow](docs/audio-workflow.md))

### Install & Verify
```sh
git clone https://github.com/devsanthoshmk/opencode-video-pipeline.git
cd opencode-video-pipeline
npm install
npm run smoke
```

`npm run smoke` runs TypeScript typechecking, FFmpeg media probe/trim tests, and a full 150-frame Remotion render check.

```sh
npm run studio       # Launch interactive Remotion Studio preview
npm run render:demo  # Render the starter composition to out/demo.mp4
```

---

## Using with OpenCode (Out of the Box)

1. Open this repository in **OpenCode** or **OpenChamber**.
2. Start a **Build** session (project instructions in `AGENTS.md`, config in `opencode.jsonc`, 11 subagents in `.opencode/agents/`, and skills in `.opencode/skills/` + `.agents/skills/` load automatically).
3. Prompt with what you want to create or edit:

- **Create Motion Graphics:**  
  > *"Create a 12-second 1080×1920 animated intro for my study channel. Use dark green and cream, start with 'Study with me', and export an MP4."*
- **Edit Existing Footage:**  
  > *"Trim `public/media/lesson.mp4` from 00:12.5 to 00:24, keep the original audio, and export `lesson-clip.mp4`."*
- **Add Voiceover & Stock Music:**  
  > *"Write a 20-second script, generate a Kokoro narration track, find CC0 lo-fi background music on Openverse, and mix it with the video."*

---

## Using with Other AI Coding Harnesses

Using **Claude Code**, **OpenAI Codex CLI**, **Cursor**, **Windsurf**, **Gemini CLI**, or another agent runner?  
Point your agent to [`HARNESS_ADAPTER.md`](HARNESS_ADAPTER.md) (or ask: *"Read HARNESS_ADAPTER.md and adapt this repo to my current harness"*). It documents:
- How to map `AGENTS.md` → `CLAUDE.md` / `GEMINI.md` / `.cursor/rules/` / `.windsurfrules`
- How to map `.opencode/agents/*.md` and read-only permissions to your harness's subagents
- How to map `.agents/skills/` and `.opencode/skills/`
- How to run the production pipeline sequentially when subagent dispatch isn't available

---

## Architecture & Multi-Agent Workflow

```text
L0 Main (Integrates shared files, runs final render)
  ├── L1 Story Lead (video-planner)
  │     ├── L2 video-writer        → out/script-draft.md
  │     └── L2 video-script-editor → out/script-final.md
  ├── L1 Visual Lead (video-visual-lead)
  │     ├── L2 video-art-director    → out/art-direction.md
  │     ├── L2 video-motion-designer → signature prototype
  │     └── L2 video-builder         → scene components / FFmpeg edits
  ├── L1 Sound Lead (video-sound-lead)
  │     ├── L2 video-stock-scout     → Openverse CC0/CC BY leads + credits
  │     └── L2 video-builder         → Kokoro TTS voiceover + audio mix
  └── L1 Reviewer (video-reviewer)
        ├── L2 video-quality-checker → Picture & motion QA
        └── L2 video-quality-checker → Audio & provenance QA
```

---

## Project Structure

```text
├── AGENTS.md                 # Core workflow & orchestration rules (OpenCode native)
├── HARNESS_ADAPTER.md        # Universal adapter for Claude Code, Codex, Cursor, Gemini CLI, etc.
├── opencode.jsonc            # OpenCode default model & subagent depth config
├── .opencode/
│   ├── agents/               # 11 specialized production & QA subagent definitions
│   └── skills/               # Project-local frontend-design skill
├── .agents/skills/           # Remotion best-practices skill pack
├── docs/
│   ├── video-workflow.md     # Remotion & FFmpeg command reference
│   ├── video-production.md   # Multi-agent production playbook
│   ├── video-design.md       # Visual design gate & frame review rubric
│   ├── audio-workflow.md     # Kokoro TTS, Openverse stock search & mixing guide
│   └── sources.md            # Remotion skills & OpenCode V2 reference
├── scripts/
│   ├── new-video.mjs         # Allocates isolated videos/<run>/ folders
│   ├── video-render.mjs      # Run-scoped Studio preview & CPU/GPU render
│   ├── media.mjs             # Safe FFmpeg probe & non-overwriting trim
│   ├── audio-voice.mjs       # Kokoro 82M / Supertonic TTS wrapper
│   ├── audio-search.mjs      # Openverse CC0/CC BY audio search
│   └── test-*.mjs            # Smoke tests for media & Remotion rendering
├── src/
│   ├── index.ts              # Remotion entry point
│   ├── Root.tsx              # Composition registry
│   └── Demo.tsx              # Starter 1280×720 30fps smoke composition
└── videos/                   # Isolated per-video run directories (see videos/README.md)
```

---

## Scripts Reference

| Command | Description |
| :--- | :--- |
| `npm run video:new -- "Title"` | Create a new isolated run folder under `videos/<slug>-001/` |
| `VIDEO_RUN=videos/<run> npm run video:preview` | Launch Remotion Studio scoped to a specific run |
| `VIDEO_RUN=videos/<run> npm run video:render -- Main final.mp4` | Render a run's composition to `videos/<run>/out/final.mp4` |
| `npm run media:probe -- <file>` | Inspect video/audio streams and metadata with FFprobe |
| `npm run media:trim -- <file> <start> <dur> <out.mp4>` | Non-destructively trim footage to `out/` |
| `npm run audio:voice -- voice.wav --text-file out/narration.txt` | Generate local English narration via Kokoro 82M |
| `npm run audio:search -- music "calm lo-fi"` | Search Openverse for CC0 / CC BY music or sound effects |
| `npm run smoke` | Run TypeScript check, FFmpeg tests, and Remotion render test |

---

## License

MIT — see [LICENSE](LICENSE).
