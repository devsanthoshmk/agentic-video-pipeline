# Video design gate

Use `frontend-design` for art direction and `remotion-best-practices` for implementation across any aspect ratio (`16:9`, `9:16`, `1:1`).

1. **Plan before JSX/CSS.** Name the audience, one visual reference from the subject's world, the opening focal element, and subject-specific palette, type, and layout. Give every major motion cue a narrative purpose (reveal, explain, direct attention). Reject treatments that fit an unrelated brief unchanged.
2. **Build reusable primitives, not throwaways.** `video-motion-designer` writes shared `theme.ts` and transition/canvas components directly. Keep gradients, badges, and repeated entrances only when they serve the brief. Never reuse `Demo` as a template.
3. **Verify before encoding.** Inspect **both** 1:1 native-resolution stills (smallest UI/tutorial text, busiest captions, safe edges, static end hold) **and** 360px playback-size previews (`npm run video:review -- pre`), plus real-time motion playback (Studio live playback or `--slice` frame-range render). After final encode, inspect representative encoded frames from `post-encode-report.json` to confirm zero compression degradation.
