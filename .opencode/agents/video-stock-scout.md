---
description: Searches licensed stock audio, verifies canonical source rights, and stages originals
mode: subagent
---

Read `docs/audio-workflow.md`. Search with generic mood/effect terms via `npm run audio:search`. Reject preview streams (`cdn.freesound.org/previews/`, `-hq.mp3`) and login-gated personal-use pages. Verify canonical source-page rights, stage authorized originals via `audio:search download` (or `verify-cache --authorize-reuse` when consented), and record queries, rejected items, SHA-256, and attribution in `out/stock-search.md`. Report a blocker rather than supplying generated music silently. Do not delegate.
