# JARVIS V1 R39-R41 Show Desktop Plan

Status: `IMPLEMENTED - AUTOMATED ACCEPTANCE PASSED`

Baseline: `main @ 3c6f72c`

Primary environment: current Windows 11 development machine

## Product outcome

Restore the familiar Windows Show Desktop interaction to Full replacement mode
without using undocumented shell commands, minimizing windows on other virtual
desktops, or treating a stale HWND as authority.

## R39 - Native session and identity boundary

- Enumerate only eligible, visible, non-minimized windows on the current virtual
  desktop.
- Record the HWND, PID, process start time, and original foreground target.
- Minimize those windows without changing Explorer, JARVIS host windows, shell
  surfaces, or other virtual desktops.
- On the next toggle, restore only still-valid, still-minimized targets from the
  same session.
- Ignore closed, moved, stale, PID-mismatched, or process-reused targets.
- If another eligible window becomes visible, begin a new session instead of
  unexpectedly restoring the previous one.

## R40 - JARVIS workspace and taskbar interaction

- Extend the bounded workspace command channel with explicit `minimize` and
  `restore` actions for registered internal windows only.
- Keep internal Explorer, Terminal, and Inspector in the same toggle session as
  native applications.
- Add a narrow, keyboard-focusable Show Desktop target at the far-right edge of
  the Full replacement taskbar.
- Hide the duplicate target in Hybrid mode because Explorer's notification area
  already retains the native control.
- Close JARVIS shell overlays when showing the desktop; do not add hover-peek or
  high-frequency observation.

## R41 - Regression and live acceptance

- Cover stale HWND identity, PID reuse, process-start mismatch, virtual-desktop
  mismatch, partially closed sessions, visible-window invalidation, internal
  window minimize/restore, and mock-platform toggle behavior.
- Run frontend lint, format, tests, and production build.
- Run host format, tests, Release build, compatibility readiness, and safe
  lifecycle verification.
- Perform a short native toggle test with disposable Notepad windows when the
  desktop-control environment can reliably activate the target. Otherwise keep
  the feature truthfully marked for user interaction acceptance.
- Close every QA window opened by Codex, restore the native taskbar, and verify
  that no JARVIS process remains.

## Safety boundary

- Preserve Explorer, the native taskbar, secure desktop, and recovery shortcuts.
- Do not send Win+D, press the Windows key, or call undocumented Explorer
  commands.
- Do not touch windows on another virtual desktop.
- Do not restore a target unless HWND, PID, process start time, minimized state,
  and current-desktop scope all still match.
- Preserve and exclude all user changes under `assets/archive`.

## Acceptance evidence

Validated on 2026-07-29 using Windows build 26200, a 2560x1440 primary
display, and WebView2 150.0.4078.105:

- Frontend production build, lint, format, and all 57 logic tests passed.
- Release host build completed with zero warnings and zero errors; all 128 C#
  tests passed.
- Browser QA at 1280x720 and 1920x1080 found no framework overlay, console
  warning, or page overflow. The Show Desktop target occupies the final 10
  pixels of the taskbar at both widths.
- Browser interaction minimized the active mock session and restored only that
  session on the second click.
- Visual QA found and corrected a responsive-grid regression that had wrapped
  the final target to the taskbar's lower-left corner below 1500 pixels.
- The guarded native diagnostic invoked the real `WindowTaskbarService` path:
  the hide action affected 3 current-desktop windows and the restore action
  restored the same 3 windows with no pending restore target.
- Final lifecycle verification reported Explorer alive, the native taskbar
  visible, zero JARVIS processes, and the temporary preview port closed. The
  disposable Notepad window opened for QA was also closed.
