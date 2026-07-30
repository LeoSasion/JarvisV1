# JARVIS V1 R42-R44 Taskbar Hover Preview Plan

Status: `IMPLEMENTED - AUTOMATED GATES AND NATIVE DWM REGISTRATION PASSED`

Baseline: `main @ 3c6f72c`

Primary environment: current Windows 11 development machine

## Product outcome

Match the familiar Windows taskbar hover interaction by opening the existing
native DWM window preview only after deliberate pointer dwell. Preserve every
current click, middle-click, Shift-click, right-click, drag, recovery, and
virtual-desktop boundary.

## R42 - Hover intent and stale-request cancellation

- Wait 450 ms before opening a preview so pointer transit does not create
  flicker or repeated native windows.
- Preview only taskbar items that currently own at least one running window.
- Ignore touch and pen pointers and suppress hover while a pinned item is being
  dragged.
- Resolve the item again from the latest taskbar snapshot when the timer fires;
  never send stale window capabilities captured by the initial pointer event.
- Cancel pending hover work on pointer exit, click, middle-click, right-click,
  drag start, overflow actions, and component disposal.
- Keep native requests bounded to 24 deduplicated opaque window IDs.

## R43 - Native DWM flyout lifetime

- Reuse `TaskbarFlyoutWindow`; do not create a second preview renderer or
  synthetic bitmap pipeline.
- Keep DWM thumbnails no-activate and validate every action again through
  `WindowTaskbarService`.
- Keep a preview open only while the pointer is inside the flyout or a
  DPI-scaled corridor around the taskbar item that opened it.
- Moving to the clock, notification area, Start, or another non-preview target
  allows the flyout to close instead of treating the entire taskbar as its
  owner.
- Preserve the existing grace period between taskbar and flyout so crossing
  the small physical gap does not dismiss the preview.

## R44 - Mock parity, tests, and acceptance

- Browser mock mode uses the same dwell intent and a 700 ms leave grace period.
- Native mode does not open a DWM flyout for a mixed JARVIS-internal window
  group; those capabilities remain renderer-owned.
- Cover empty items, internal/native boundaries, ID deduplication and bounds,
  pointer types, active drag suppression, taskbar-anchor containment, and
  negative monitor coordinates.
- Run frontend lint, format, and logic tests without generating a production
  bundle.
- After explicit compilation permission, run the frontend production build,
  Release host build/tests, and a controlled multi-window native hover visual
  test. Close every QA window and restore the Windows taskbar afterward.

## Explicit exclusions

- Do not hide all non-previewed windows for Aero Peek.
- Do not synthesize `Win+T`, intercept the Windows key, or invoke undocumented
  Explorer services.
- Do not poll window thumbnails or taskbar pointer state from the renderer.
- Do not preview a pinned application that has not been launched.
- Do not alter the user-owned changes under `assets/archive`.

## Current validation

- Frontend lint and format contracts passed.
- All 61 frontend logic tests passed, including 4 new hover-preview cases.
- Frontend production build passed.
- Release host build passed with 0 warnings and 0 errors.
- All 136 C# tests passed, including the DPI-safe taskbar-anchor corridor and
  negative-monitor-coordinate cases.
- Browser QA confirmed the grouped preview layout, anchor position, window
  cards, and close path. The browser controller does not dispatch a React
  `PointerEnter` event for coordinate-only movement, so dwell timing remains
  logic-tested rather than falsely reported as a browser hover pass.
- Two controlled Windows 11 runs reached full taskbar replacement and logged a
  successful `DwmRegisterThumbnail` call for the disposable Paint window.
  The no-activate diagnostic flyout is not exposed to the external window
  enumerator, so final physical hover/dismiss feel remains a short interactive
  acceptance item.
- Both native runs used the JARVIS safety-exit path. The final lifecycle sample
  reported Explorer alive, the native taskbar visible, and 0 JARVIS processes.
