# Storyboard delivery — 5 September 2026

Implemented and deployed to https://cinemai.fly.dev using the existing Fly app and persistent volume.
Deployment image: `registry.fly.io/cinemai:deployment-01M1RK9AQQMRYF2S69DDET63QN`.

## Delivered

- Storyboard opens in the main workspace, with image cards, actions and durations.
- Each shot has a manual editor for title, action, duration, dialogue, cut continuity and references.
- Saving preserves up to 50 earlier text versions, leaves media/neighbours intact and rejects stale writes.
- Image generation remains separately available inside the editor with its existing cost controls.
- Agent tool `create_screenplay` proposes a complete breakdown for an empty structured project;
  approval applies its sequences and shots atomically. Existing projects use targeted updates.
- Structural review lists duration mismatches, missing/unapproved images/references, continuous
  cuts that change location, dialogue speakers absent from references, and old/unknown script versions.
- Human image revalidation records the current shot version without requiring new generation.
- Figma: https://www.figma.com/design/wuoR5ZeF6ReBvmd1kuclNN?node-id=2-2

## Verification

- Baseline: 69 tests. Final: 76 passing tests, including atomic screenplay approval/rollback,
  shot history, stale writes, neighbour/media isolation, version revalidation and API contracts.
- Browser QA on an isolated in-memory copy of Shadow, with providers disabled:
  desktop 1440×1000, mobile 390×844; storyboard, editor and save path verified.
- Live read-only browser QA on the same viewport sizes: storyboard, continuity panel and editor;
  no horizontal overflow or JavaScript errors. No live project edits or media generation.
- Live health and review endpoints return HTTP 200; Google mode active; 2 shots and 19 media retained.
- Two live warnings are expected: historic images have no recorded source script version.
- Figma final frame visually checked; no overflow or unfinished placeholder nodes.

## Limits

- This is structural validation, not computer vision or a guarantee of narrative/visual consistency.
- The new screenplay tool was exercised through a simulated Google response, not a paid live creation.
- Mock mode remains deterministic text and does not invent a screenplay.
- Existing timelines are not automatically retimed when shot duration changes.
- App changes are deployed; local Git changes remain available for review and are not committed.
