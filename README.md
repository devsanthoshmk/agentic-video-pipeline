# Agentic Video Pipeline

**Agentic code-to-video and footage editing pipeline powered by Remotion, FFmpeg, Kokoro TTS, Whisper, and Openverse.**  
Works out of the box with **OpenCode (V2)** and includes a universal [`HARNESS_ADAPTER.md`](HARNESS_ADAPTER.md) so AI coding agents in **Claude Code, Codex CLI, Cursor, Windsurf, Gemini CLI**, and other runners can adapt and run the entire workflow seamlessly.

[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Remotion](https://img.shields.io/badge/Remotion-4.0-0B84F3?logo=react&logoColor=white)](https://www.remotion.dev/)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-Local%20Pipeline-007808?logo=ffmpeg&logoColor=white)](https://ffmpeg.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Why This Pipeline?

Most AI video workflows either rely on opaque cloud generators or dump single-prompt React code into a shared folder. **Agentic Video Pipeline** gives your AI coding agent a fast, reproducible local production studio:

- **Programmatic Motion Graphics (Remotion + React/TypeScript):** Build frame-accurate animations, kinetic typography, data visualizations, and multi-scene compositions locally (`16:9`, `9:16`, `1:1`).
- **Zero-Encode Live Preview & Single-Bundle Two-Phase QA:** Iterate live in loopback Remotion Studio (`video:preview`), run pre-encode QA from a single immutable bundle (`video:review -- pre` with 1:1 native stills, `360px` playback checks, labeled contact sheets, and transition slices), render `final.mp4` once under an OOM-recovery supervisor, and verify post-encode decode/loudness/hashes before atomic publication (`publish`).
- **Deterministic Footage Editing & Platform Mastering (FFmpeg + FFprobe):** Non-overwriting `media:probe`, `media:trim`, `media:concat`, `media:speed`, `media:mix`, `media:captions`, and conditional platform presets (`youtube-1080p`, `linkedin-1080p`, `shorts-1080x1920`, `square-1080x1080` with `zscale` + `tonemap=hable` HDR→SDR support).
- **Offline Kokoro Narration, GPU Whisper SRT & Locked-Picture Audio Patching:** Generate English narration with `beat-map.json` timing (`--scratch`, `--timings`, `--variants`, `--cache`, opt-in `--gpu auto|on`), transcribe/flag pronunciation & generate `.srt` via `faster-whisper` (`audio:transcribe`), and patch single sentences onto clean stems with `-c:v copy` packet invariance (`audio:patch`).
- **Isolated Video Runs (`videos/<run>/`):** Every new video or remake gets its own sandboxed `brief.md`, `src/`, `public/`, and `out/` directory—never overwriting prior work.
- **Depth-1 Multi-Specialist Production Crew:** 11 specialized OpenCode agent roles (`video-writer`, `video-script-editor`, `video-art-director`, `video-motion-designer`, `video-builder`, `video-stock-scout`, `video-quality-checker`, `video-reviewer`, `video-planner`, plus optional depth-2 leads `video-visual-lead` and `video-sound-lead`) with enforceable read-only QA boundaries and hash-bound report invalidation.
- **Universal Harness Adapter:** Ships with [`HARNESS_ADAPTER.md`](HARNESS_ADAPTER.md) so any AI agent can map the instructions, subagents, and skills to its own runtime.

---

## Quick Start

### Prerequisites
- **Node.js 22+** and **npm**
- **FFmpeg** (with `libx264` and `aac`; `zscale`/`tonemap`/`drawtext` filters; optional `h264_nvenc`) and **FFprobe** on `PATH`
- *(Optional, for local narration)* Python environment with `kokoro-onnx` and `soundfile` (plus optional isolated `.venv-gpu` with `onnxruntime-gpu`; see [Audio Workflow](docs/audio-workflow.md))
- *(Optional, for local transcription & SRT)* Python environment with `faster-whisper` and `ctranslate2`

### Install & Verify
```sh
git clone https://github.com/devsanthoshmk/agentic-video-pipeline.git
cd agentic-video-pipeline
npm install
npm run smoke
```

`npm run smoke` runs TypeScript typechecking, FFmpeg media probe/trim tests, and a full 150-frame Remotion render check.

```sh
npm run studio       # Launch interactive Remotion Studio preview
npm run render:demo  # Render the starter composition to out/demo.mp4
```

---

## Sample Video

See a complete 48-second, 1080p (`1920×1080`, 30 fps) portfolio introduction produced end-to-end with this pipeline (multi-agent script + art direction + Remotion motion graphics + Kokoro 82M narration + Openverse CC BY music + FFmpeg mastering):

- **Video:** [`examples/sample-portfolio-intro.mp4`](examples/sample-portfolio-intro.mp4) (`8.1 MB`, H.264 High L4.1, `bt709`, `-15.6 LUFS`)
- **Captions (SRT):** [`examples/sample-portfolio-intro.srt`](examples/sample-portfolio-intro.srt)
- **Audio Credit:** Music by zero-project | www.zero-project.gr (CC BY 4.0)

---

## Using with OpenCode (Out of the Box)

1. Open this repository in **OpenCode** or **OpenChamber**.
2. Start a **Build** session (project instructions in `AGENTS.md`, config in `opencode.jsonc`, 11 subagents in `.opencode/agents/`, and skills in `.opencode/skills/` + `.agents/skills/` load automatically).
3. Prompt with what you want to create or edit:

- **Create Motion Graphics:**  
  > *"Create a 12-second 1080×1920 animated intro for my study channel. Use dark green and cream, start with 'Study with me', and export an MP4."*
- **Edit Existing Footage:**  
  > *"Trim `public/media/lesson.mp4` from 00:12.5 to 00:24, keep the original audio, and export `lesson-clip.mp4`."*
- **Patch Audio Without Re-Rendering Video:**  
  > *"Replace sentence 2 in `videos/<run>/out/final.mp4` using its clean stems, update cue 2 in `final.srt`, and export `final-v2.mp4`."*

---

## Using with Other AI Coding Harnesses

Using **Claude Code**, **OpenAI Codex CLI**, **Cursor**, **Windsurf**, **Gemini CLI**, or another agent runner?  
Point your agent to [`HARNESS_ADAPTER.md`](HARNESS_ADAPTER.md) (or ask: *"Read HARNESS_ADAPTER.md and adapt this repo to my current harness"*). It documents:
- How to map `AGENTS.md` → `CLAUDE.md` / `GEMINI.md` / `.cursor/rules/` / `.windsurfrules`
- How to map `.opencode/agents/*.md` and read-only (`edit` / `shell` deny) permissions to your harness's subagents
- How to map `.agents/skills/` and `.opencode/skills/`
- How to run depth-1 or sequential workflows when nested dispatch isn't available

---

## Architecture & Multi-Agent Workflow (Depth-1 Default)

```text
L0 Main (Integrates shared files, builds single immutable bundle, supervises render)
  ├── [Wave 1] video-writer ──► video-script-editor (with --scratch TTS ──► Narration Lock + beat-map.json)
  ├── [Wave 1] video-art-director ──► out/art-direction.md
  ├── [Wave 1] video-stock-scout  ──► verified-asset manifest + staged audio (writable)
  ├── [Wave 2] video-motion-designer ──► shared theme.ts + reusable primitives (real-time Motion Lock)
  ├── [Wave 3] N × video-builder (disjoint scenes) ‖ video-builder (mix from approved WAV hash + mix-manifest.json)
  └── [Wave 4] Pre-Encode & Post-Encode QA:
                 2 × video-quality-checker (parallel, edit + shell denied) ──► video-reviewer (adjudication)
                 ──► Single Staged Render ──► Post-Encode QA ──► Atomic publish
```

*(Optional depth-2 leads `video-visual-lead` and `video-sound-lead` remain available for large >3 min productions; footage-only edits and locked-picture patches route directly without visual/story fan-out.)*

---

## Project Structure

```text
├── AGENTS.md                 # Core workflow & depth-1 orchestration rules (OpenCode native)
├── HARNESS_ADAPTER.md        # Universal adapter for Claude Code, Codex, Cursor, Gemini CLI, etc.
├── opencode.jsonc            # OpenCode default model & subagent depth config
├── .opencode/
│   ├── agents/               # 11 specialized production & QA subagent definitions
│   └── skills/               # Project-local frontend-design skill
├── .agents/skills/           # Remotion best-practices skill pack
├── docs/
│   ├── video-workflow.md     # Remotion, FFmpeg, and platform export command reference
│   ├── video-production.md   # Dependency graph, two-phase QA & Release Decision Table
│   ├── video-design.md       # Visual design gate & legibility review rubric
│   ├── audio-workflow.md     # Kokoro TTS, Whisper SRT, audio-patch & Openverse stock guide
│   └── sources.md            # Remotion skills & OpenCode V2 reference
├── scripts/
│   ├── new-video.mjs         # Allocates isolated videos/<run>/ folders
│   ├── review-bundle.mjs     # Single-bundle pre-encode sheets/stills/slices & post-encode QA
│   ├── video-render.mjs      # Loopback Studio, OOM-safe staged render, hash-checked publish & export presets
│   ├── media.mjs             # Non-overwriting FFmpeg probe, trim, concat, speed, mix & captions
│   ├── audio-voice.mjs       # Kokoro 82M / Supertonic TTS wrapper (CPU baseline + opt-in GPU venv)
│   ├── audio-kokoro.py       # Kokoro runner (--scratch, --norm, --timings, --variants, --cache)
│   ├── audio-patch.mjs       # Locked-picture stem audio patcher (-c:v copy + packet/PCM checks)
│   ├── transcribe.mjs        # Local faster-whisper transcription, ASR flags & SRT generator
│   ├── audio-search.mjs      # Multi-source Openverse search & SHA-256 verified-asset manifest
│   ├── capture-screenshots.mjs # Parameterized headless webpage capture helper
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
| `VIDEO_RUN=videos/<run> npm run video:preview` | Launch loopback (`127.0.0.1`) Remotion Studio scoped to a run |
| `VIDEO_RUN=videos/<run> npm run video:review -- pre Main` | Bundle once and emit contact sheets, 1:1 stills, `360px` checks & optional `--slice` |
| `VIDEO_RUN=videos/<run> npm run video:render -- Main final.mp4 cpu --stage-only` | Render verified bundle inside OOM-recovery supervisor (`4 → 2 → 1`) |
| `VIDEO_RUN=videos/<run> npm run video:review -- post <staged.mp4>` | Verify decoded streams, `ebur128` loudness, encoded frames & beat-map coverage |
| `VIDEO_RUN=videos/<run> npm run video:export -- <in.mp4> <preset> <out.mp4>` | Conditional mastering (`youtube-1080p`, `linkedin-1080p`, `shorts-1080x1920`, `square-1080x1080`) |
| `npm run media:probe / trim / concat / speed / mix / captions` | Non-overwriting FFmpeg footage and caption toolkit |
| `npm run audio:voice -- voice.wav --text-file out/narration.txt` | Local Kokoro narration (`--scratch`, `--norm`, `--timings`, `--variants`, `--cache`, `--gpu`) |
| `npm run audio:transcribe -- <media> --srt out.srt` | Local `faster-whisper` transcription & SRT generator (`--gpu auto|on|off`) |
| `npm run audio:patch -- --video <mp4> --mix-manifest <json> ...` | Locked-picture stem audio splice (`-c:v copy` + PCM & packet invariance checks) |
| `npm run audio:search -- music "calm lo-fi"` | Search Openverse (`wikimedia_audio` + `freesound` + `jamendo`) & stage verified assets |
| `npm run capture -- --url <url> --out <file.png>` | Headless Chromium screenshot helper |
| `npm run smoke` | Run TypeScript check, FFmpeg media tests, and Remotion render test |

---

## License

MIT — see [LICENSE](LICENSE).
