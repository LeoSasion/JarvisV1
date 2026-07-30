# R81–R89 Search, Navigation, and Visual Polish Plan

## Objective

Complete nine bounded improvements for the most frequently used JARVIS desktop
flows: finding an application, reaching an overflowed taskbar item, narrowing a
folder, and triaging system events. The changes must remain useful with a mouse
or keyboard, preserve the existing Windows fallback boundaries, and be
verifiable without compiling the native host.

## Safety and delivery boundary

- Work on the existing `main` worktree without discarding or rewriting earlier
  uncommitted changes.
- Do not compile or package the EXE and do not run tests that require a .NET
  build.
- Do not invoke real lock, sign-out, restart, shutdown, recycle, rename, copy,
  move, or other native mutations during visual validation.
- Do not add privileges, arbitrary command execution, or unbounded storage.
- Do not commit, push, create a branch, or modify files under `assets/archive`.
- Keep every persisted value versioned, bounded, and local to interface state.
- Close browser tabs and stop the development server immediately after QA.

## Nine rounds

| Round | Priority | Deliverable | Automated acceptance |
| --- | --- | --- | --- |
| R81 | P0 | Add `Ctrl+1`–`Ctrl+5` Quick Search scope switching with visible shortcut hints. | Pure shortcut-routing tests plus browser focus/state verification. |
| R82 | P1 | Let users clear the bounded local Quick Search history without affecting application recents. | Store reset tests and an empty-history browser state. |
| R83 | P0 | Add bounded local filtering to the taskbar overflow flyout. | Filter normalization/matching tests and a no-match state. |
| R84 | P0 | Add Arrow/Home/End keyboard navigation within overflow and window flyouts. | Flyout target-index tests and browser focus verification. |
| R85 | P1 | Add truthful running/pinned/visible counts to overflow, with compact responsive styling. | Summary-model tests and desktop/compact screenshots. |
| R86 | P0 | Add a one-click Explorer search reset that restores the full folder list and file focus. | Search-reset command tests and browser item-count verification. |
| R87 | P0 | Make Explorer Escape progressive: cancel edit/dialog, clear search, clear selection, then close. | Escape-priority model tests without filesystem mutation. |
| R88 | P1 | Highlight Explorer name/type matches and distinguish an empty folder from no search matches. | Match-segmentation tests and rendered empty-state verification. |
| R89 | P1 | Add an Unread System Feed filter, keyboard-accessible filter shortcuts, and consistent visual states. | Feed filter/shortcut tests plus browser count and no-match verification. |

## Execution batches

1. R81–R82: Quick Search keyboard and privacy hygiene.
2. R83–R85: taskbar overflow findability and keyboard parity.
3. R86–R88: Explorer search recovery and match feedback.
4. R89: System Feed triage polish.

## Validation gates

After each batch:

- Run the focused Node tests.
- Run frontend lint and formatting checks after component or CSS changes.
- Review changed effects, listeners, timers, and storage for bounds and cleanup.

At completion:

- Run the full frontend Node suite, lint, formatting, and `git diff --check`.
- Use the in-app Browser at 1280×720 and 1024×720.
- Exercise Quick Search, taskbar overflow, Explorer search, and System Feed
  filters with DOM, focus, count, console, and screenshot evidence.
- Restore temporary preferences and search state, close all opened test panels
  and tabs, reset the viewport, and stop the development server.

## Status

- Plan written before implementation: complete.
- Implementation: complete.
- Completed rounds: 9 / 9.

## Completion evidence

- Quick Search: verified `Ctrl+1`–`Ctrl+5` scope switching, visible shortcut
  hints, bounded query history, and the clear-history action.
- Taskbar overflow: verified local text filtering, Arrow/Home/End focus
  navigation, truthful visible/running/pinned counts, and the no-match state.
- Explorer: verified search reset, progressive Escape behavior, highlighted
  matches, and distinct empty-folder/no-match states without filesystem
  mutation.
- System Feed: verified the Unread shortcut/filter, visible-unread summary,
  mark-all-read transition, and the filtered no-match state.
- Automated frontend checks: `105 / 105` Node tests passed; ESLint and the
  formatting contract passed; `git diff --check` reported no whitespace errors.
- Visual QA: exercised the product in the in-app Browser at 1280×720 and at the
  1024×720 compact desktop breakpoint. The compact taskbar overflow measured
  566×358 and stayed entirely within the viewport with no page overflow.
- Visual QA found one Explorer focus-restoration defect after clearing search.
  The implementation was corrected and reverified with focus returning to the
  first visible file entry.
- Final browser console contained no errors or warnings. All test dialogs were
  closed, the browser task was finalized, the Vite server was stopped, and port
  4173 was verified released.
- Native host compilation and live Windows-shell validation were intentionally
  excluded from this round.
