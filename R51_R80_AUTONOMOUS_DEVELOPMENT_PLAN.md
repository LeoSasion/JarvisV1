# R51–R80 Autonomous Development Plan

## Objective

Complete thirty bounded JARVIS V1 improvements that prioritize frequent Windows
desktop work, keyboard efficiency, accessibility, predictable persistence, and
low runtime overhead. Every round must have a concrete user-visible outcome and
an automated verification path.

## Safety and delivery boundary

- Target the existing Windows 10/11 Home and Pro shell architecture.
- Keep Explorer, native sign-in, recovery, and native taskbar rollback paths intact.
- Do not compile or package the EXE during this run.
- Do not invoke real lock, sign-out, restart, shutdown, or other disruptive actions.
- Do not add arbitrary command execution, arbitrary filesystem roots, or new privileges.
- Do not commit, push, create a branch, or modify files under `assets/archive`.
- Prefer pure models plus focused tests; keep global listeners deduplicated and cleaned up.
- Persist only bounded, versioned, non-sensitive UI preferences.
- Finish browser visual checks by closing any opened tabs and stopping the dev server.

## Thirty rounds

| Round | Priority | Deliverable | Automated acceptance |
| --- | --- | --- | --- |
| R51 | P0 | Give every shell flyout a deterministic initial focus target. | Focus helper and rendered structure checks. |
| R52 | P0 | Contain Tab/Shift+Tab inside the active shell flyout. | Focus-loop model tests. |
| R53 | P0 | Restore focus to the invoking control and keep Escape dismissal single-owned. | Focus restore/escape regression checks. |
| R54 | P0 | Make `Ctrl+F` focus and select Start search from anywhere in Start. | Start keyboard command model tests. |
| R55 | P0 | Add keyboard switching between Pinned and All Apps (`Ctrl+1/2`, arrows). | Start view-navigation tests. |
| R56 | P1 | Let users clear the bounded Recently Opened application list. | Recent-store validation and clear tests. |
| R57 | P0 | Add Quick Search scopes: `app:`, `win:`, `file:`, and `set:`. | Parser and filtered-result tests. |
| R58 | P1 | Add discoverable scope chips and query guidance without opening another dialog. | Scope metadata and UI checks. |
| R59 | P1 | Keep a bounded, versioned local Quick Search query history and make it reusable. | Corrupt/duplicate/bounds/history tests. |
| R60 | P0 | Add adaptive-grid arrow-key navigation to desktop icons. | Directional navigation model tests. |
| R61 | P1 | Add Windows-style incremental type-to-select on the desktop. | Timeout, wrap, and normalization tests. |
| R62 | P1 | Add Home/End navigation and keep keyboard focus synchronized with selection. | Boundary and focus-target tests. |
| R63 | P0 | Add a validated `Ctrl+L` address bar to JARVIS File Explorer. | Address normalization and interaction checks. |
| R64 | P0 | Add arrow/Home/End keyboard selection inside Explorer file results. | Explorer navigation model tests. |
| R65 | P0 | Add Explorer navigation shortcuts: `Alt+Left/Right/Up`, `Ctrl+F`, and `F5`. | Shortcut routing tests. |
| R66 | P1 | Add stable Explorer sorting by name, type, modified time, and size. | Stable/directory-first sorting tests. |
| R67 | P1 | Persist Explorer view and sort preferences in a bounded versioned schema. | Storage corruption and migration tests. |
| R68 | P1 | Add `Ctrl+Shift+C` Copy Path with clear selection feedback. | Path formatting and clipboard routing checks. |
| R69 | P0 | Add roving Arrow/Home/End keyboard navigation across visible taskbar apps. | Taskbar focus-index tests. |
| R70 | P1 | Give taskbar overflow/context flyouts deterministic focus and Escape behavior. | Flyout focus and dismissal regressions. |
| R71 | P1 | Expose active/running/pinned/window-count state to assistive technology. | Accessible-label model tests. |
| R72 | P1 | Add System Feed severity filters (All, Attention, Status). | Feed filter tests. |
| R73 | P1 | Add bounded text filtering across feed title/detail. | Normalization and match tests. |
| R74 | P1 | Add visible filtered counts and a truthful no-match state. | Summary model tests. |
| R75 | P0 | Debounce volume commits while preserving immediate keyboard/pointer finalization. | Commit scheduler tests and listener cleanup checks. |
| R76 | P1 | Add year jumps to the calendar with `Shift+PageUp/PageDown`. | Leap-year and date-clamping tests. |
| R77 | P0 | Autofocus the safe default in session confirmations and restore focus on cancel. | Confirmation focus regression checks; no action commit. |
| R78 | P1 | Add a persisted motion preference (`System`, `Reduced`, `Full`). | Preference schema and DOM-token tests. |
| R79 | P1 | Add a persisted emission preference (`Standard`, `Subtle`, `Minimal`). | Bounded preference and CSS-token tests. |
| R80 | P1 | Add a safe interface-preference reset and finish a cross-feature audit. | Reset tests, full frontend suite, lint, format, and static host format verification. |

## Execution batches

1. R51–R53: shared shell focus contract.
2. R54–R56: Start keyboard and recent-app hygiene.
3. R57–R59: scoped Quick Search and query history.
4. R60–R62: desktop keyboard parity.
5. R63–R65: Explorer address and navigation shortcuts.
6. R66–R68: Explorer sort, persistence, and Copy Path.
7. R69–R71: taskbar keyboard and accessible runtime state.
8. R72–R74: actionable System Feed filtering.
9. R75–R77: volume, calendar, and guarded-session refinements.
10. R78–R80: motion/emission preferences, reset, and final audit.

## Validation gates

After each three-round batch:

- Run the relevant Node test files.
- Run `npm run lint` and `npm run format:check` when UI wiring changes.
- Inspect the diff for listener leaks, unbounded storage, stale closures, and unsafe calls.

At completion:

- Run the full frontend Node test suite.
- Run frontend lint and format checks.
- Run `dotnet format --verify-no-changes --no-restore` only; do not build.
- Perform a bounded browser visual/interaction review at desktop and compact widths
  if the dev server can run without compilation.
- Close browser tabs opened for the review and stop the dev server.

## Status

- Plan written before implementation: complete.
- Implementation: complete.
- Completed rounds: 30 / 30 (R51–R80).
- Frontend unit suite: 98 / 98 passed.
- Frontend lint and formatting gates: passed.
- Host static formatting gate: `dotnet format host\Jarvis.Host.sln
  --verify-no-changes --no-restore` passed without compiling.
- Browser interaction review: passed at 1280×720 and 1024×720. Start, scoped
  Quick Search and history, System Feed filtering, interface preferences and
  reset, Explorer address/sort/selection, taskbar state, focus restoration, and
  compact-layout bounds were exercised.
- Browser diagnostics: no warning or error entries; only Vite connection and
  React development informational messages.
- Cleanup: interface preferences and Explorer sort were restored, all test
  dialogs and browser tabs were closed, the viewport override was reset, and
  the development server was stopped.
