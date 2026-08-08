# Design QA — JARVIS V1

## Evidence

- Accepted visual source: [`design-reference/jarvis-night-shell-v1-approved.png`](design-reference/jarvis-night-shell-v1-approved.png)
- Latest implementation capture: retained as local QA evidence and not distributed with the repository
- Focused top comparison: local QA crops `reference-top.png` and `implementation-top.png`
- Focused right-core comparison: local QA crops `reference-right.png` and `implementation-right.png`
- Focused taskbar comparison: local QA crops `reference-bottom.png` and `implementation-bottom.png`
- Browser method: Codex in-app Browser
- Native comparison viewport: `1672 × 941`, DPR `1`
- Comparison state: default desktop, microphone active, no dialog, no selection, no toast

## Visual comparison

| Area | Result | Notes |
| --- | --- | --- |
| Global geometry | Pass | Top status bar, left two-column desktop shortcuts, open center stage, right telemetry rail, and full-width taskbar preserve the approved hierarchy and proportions. |
| Central asset | Pass | The archived blue orbital core is the dominant focal point and retains the source crop, glow hierarchy, and black negative space. |
| Right rail | Pass | Five vertical sections match the selected layout: JARVIS Core, resources, activity, notifications, and system health. |
| Color and contrast | Pass | Near-black surfaces, low-luminance blue borders, cyan/ice highlights, red agent stop state, and green health state follow the source palette. |
| Typography | Pass | Bahnschrift, Segoe UI, and Cascadia Mono reproduce the condensed labels, system copy, and telemetry values without clipped text. |
| Icon language | Pass | The top brand, top ready status, right core, and bottom launcher now use four distinct elements extracted from their exact locations in the approved source. The off-center compact orb has zero rendered references. |
| Image quality | Pass | The four source crops are background-subtracted to transparent RGBA while preserving layered white, cyan, and cobalt glow; no dark rectangular crop edges remain. |
| Copy | Pass | Above-the-fold labels, dates, metrics, process rows, notifications, and taskbar labels match the approved source. No intentional copy deviations. |
| Overflow | Pass | The native viewport and `1366 × 768` both render with document width/height equal to the viewport and no scrollbars. |

## Comparison history

1. Initial comparison found one P2 mismatch: the fifth rail panel omitted the visible `SYSTEM HEALTH` header. It also used a square stop glyph instead of the approved red circular `7` token.
2. Both were corrected, the production build was rerun, and a new native-state browser capture was compared with the source in the same visual review.
3. A later P2 asset-fidelity finding was raised by the user: `jarvis-compact-orb-64-v1.png` was visually off-center and was being reused where the source shows four different HUD elements.
4. Four independent crops were extracted from the approved source; the top grid, right core column, taskbar position, and launcher overflow behavior were aligned to the original element coordinates. Opaque crop backgrounds were converted to transparent RGBA to remove dark boxes without flattening the glow layers.
5. The revised full view and three focused region pairs were compared together. Final review found no remaining P0, P1, or P2 issues.

## Functional verification

- Central core opens the JARVIS command dialog.
- Command entry submits and returns the visible `JARVIS accepted` status.
- Microphone toggles between active and muted ARIA states.
- Desktop shortcut selection and double-click feedback work.
- Power control returns protected-prototype feedback.
- `1366 × 768` desktop layout has no overflow.
- `800 × 600` deliberately switches to the desktop-only fallback.
- All four required source assets report complete intrinsic dimensions; rendered compact-orb reference count is `0`.
- Browser console: zero warnings and zero errors.
- `npm run build`: passed, 232 modules transformed.

## Remaining P3 polish

- The generated source has a few denser ornamental chassis notches than the coded frame.
- A few source-specific icon silhouettes are represented by the nearest Fluent outline equivalents.
- The center raster has a small crop/offset variance caused by fitting the archived master responsively.

final result: passed
