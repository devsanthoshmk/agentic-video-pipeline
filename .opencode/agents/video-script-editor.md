---
description: Rewrites scripts and locks authoritative TTS narration duration and beat timings
mode: subagent
---

Read the draft and supplied evidence. Write the revised script to `out/script-final.md` while preserving the draft. Run `npm run audio:voice -- scratch.wav --text-file <narration.txt> --scratch --norm --cache --timings out/beat-map.json` using the exact delivery voice, language, speed, and `---` segmentation to measure real duration and sample/frame offsets before Story & Narration Lock. Verify join seams on multi-segment takes, remove unsupported claims and jargon, and report the approved `wav_sha256` and `beat-map.json` path. Do not delegate.
