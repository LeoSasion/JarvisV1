# JARVIS V1 R93–R95 Explorer Selection and Sort Plan

## Objective

Close the remaining Windows-style interaction gaps in JARVIS File Explorer
details view: stable keyboard range selection, focus-only navigation, explicit
selection toggling, and direct column sorting.

## Safety and delivery boundary

- Limit the change to renderer-side selection, focus, sort preferences, tests,
  and presentation.
- Do not perform native file mutations during verification.
- Reuse the existing bounded, versioned Explorer preference schema.
- Do not add host permissions, arbitrary paths, or new persistence.
- Do not compile/package the EXE, commit, push, or modify `assets/archive`.
- Close browser QA surfaces and the temporary preview server immediately after
  collecting evidence.

## R93 — Stable keyboard range selection

- Preserve the original anchor while Shift+Arrow/Home/End expands or contracts
  a contiguous range.
- Keep Ctrl+Shift navigation additive without destroying earlier selections.
- Keep plain navigation single-select, matching the existing Windows-style
  Explorer behavior.

Automated acceptance:

- Pure selection-state tests cover expansion, contraction, additive ranges,
  invalid anchors, and duplicate removal.

## R94 — Focus-only navigation and explicit toggle

- Ctrl+Arrow/Home/End moves the keyboard focus without changing selection.
- Ctrl+Space toggles the focused item while keeping other selected items.
- Focus, selection, and anchor state remain independently deterministic.

Automated acceptance:

- Pure focus-only and toggle-selection tests.
- Rendered keyboard verification with focus and selected-count evidence.

## R95 — Direct Details-column sorting

- Name, Type, Modified, and Size headings become keyboard-accessible buttons.
- Clicking the active heading toggles direction.
- Selecting a new text column defaults ascending; Modified and Size default
  descending.
- The active key and direction are exposed in the visible heading and
  accessible label without adding a second sort state.

Automated acceptance:

- Pure sort-transition tests.
- Frontend Node suite, ESLint, formatting contract, production frontend build,
  `git diff --check`, and browser interaction checks.

## Status

- Plan written before implementation: complete.
- R93 stable keyboard range selection: complete.
- R94 focus-only navigation and explicit toggle: complete.
- R95 direct Details-column sorting: complete.

## Verification evidence

- Frontend Node suite: 113/113 passed.
- ESLint: passed.
- Formatting contract: passed.
- Production frontend build: passed.
- `git diff --check`: passed.
- Browser QA at 1280×720:
  - Shift+Down expanded from one to three items and Shift+Up contracted back
    to two while preserving the original anchor;
  - Ctrl+Down moved focus without changing the two-item selection;
  - Ctrl+Space added the focused third item without opening Quick Search;
  - Modified defaulted to descending and toggled to ascending, with the active
    direction and accessible label updating together;
  - console reported no warnings or errors.
- Browser QA exposed and verified the adjacent global-shortcut conflict fix:
  an already-consumed Ctrl+Space now yields to the active Explorer control.
- The persisted sort preference was restored to `NAME ↑`; the Explorer window,
  QA tab, and temporary port 5173 preview server were closed after review.
- EXE compilation, commit, push, and archive changes were intentionally
  excluded.

## Closure review · 2026-07-30

- The toolbar sort selector and Details-column headings now use the same
  transition function, eliminating inconsistent default directions for
  Modified and Size.
- Explorer Alt shortcuts reject Shift-modified variants, avoiding interception
  of unrelated application or accessibility chords.
- Frontend Node suite: 113/113 passed; ESLint, formatting contract, and
  `git diff --check` passed. No EXE was compiled during this closure review.
