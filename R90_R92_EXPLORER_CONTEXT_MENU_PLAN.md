# JARVIS V1 R90–R92 Explorer Context Menu Plan

## Objective

Complete the missing Windows-style context-menu path in JARVIS File Explorer.
The feature must make the most common file commands reachable from the pointer
or keyboard without expanding the native capability boundary.

## Safety and delivery boundary

- Reuse the existing allowlisted Explorer bridge operations only.
- Do not add arbitrary commands, executable paths, permanent deletion, or new
  filesystem roots.
- Keep recycle actions behind the existing confirmation dialog.
- Keep copy, cut, paste, rename, properties, and open behavior identical to the
  existing command bar.
- Do not compile or package the EXE, push, or modify `assets/archive`.
- Close menus on navigation, resize, Escape, outside click, and window close.
- Keep positioning viewport-bounded and keyboard focus deterministic.

## R90 — File-item context menu

- Right-clicking an unselected item selects only that item.
- Right-clicking a selected item preserves the current multi-selection.
- Expose only commands valid for the current selection:
  open, open in Windows, copy, cut, copy path, rename, properties, and recycle.
- Single-item-only commands remain hidden or disabled for multi-selection.

Automated acceptance:

- Pure selection-resolution and action-availability tests.
- Recycle still routes through the existing recoverable confirmation path.

## R91 — Folder-background context menu

- Right-clicking empty Explorer space clears selection and opens a background
  menu.
- Expose New Folder, Paste, Refresh, and Open in Windows.
- Paste reflects the bounded Windows clipboard and active-transfer state.
- The menu never opens from a file item's event bubble.

Automated acceptance:

- Pure background-action availability tests.
- Viewport-clamping tests for primary and negative monitor coordinates.

## R92 — Keyboard and accessibility parity

- `Shift+F10` and the Context Menu key open the menu for the focused item or the
  current folder background.
- Arrow/Home/End move focus, Enter/Space activates, and Escape closes.
- Focus returns to the invoking item or Explorer file surface.
- Menu roles, disabled state, shortcut hints, and live operation feedback remain
  accessible.

Automated acceptance:

- Pure keyboard-target and trigger-routing tests.
- Full frontend Node suite, ESLint, formatting contract, production frontend
  build, and `git diff --check`.

## Status

- Plan written before implementation: complete.
- R90 file-item menu: complete.
- R91 folder-background menu: complete.
- R92 keyboard and accessibility parity: complete.

## Verification evidence

- Frontend Node suite: 108/108 passed.
- ESLint: passed.
- Formatting contract: passed.
- Production frontend build: passed.
- `git diff --check`: passed.
- Browser QA at 1280×720:
  - file-item menu remained fully inside the workspace and viewport;
  - Arrow Down skipped correctly, Escape closed and restored item focus;
  - Shift+F10 opened the focused item's menu;
  - browser console reported no warnings or errors.
- The temporary QA tab and port 5174 preview server were closed after review.
- EXE compilation, commit, push, and archive changes were intentionally excluded.

## Closure review · 2026-07-30

- Context-menu clamping now uses the actual Explorer layer bounds rather than
  the full browser viewport, so menus cannot drift into the top status area or
  replacement taskbar when the Explorer layer is inset.
- The follow-up source review retained the existing allowlisted bridge boundary
  and did not add native commands or filesystem permissions.
