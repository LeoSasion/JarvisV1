# R12 — HUD Window Switcher

## Goal

Replace the ordinary Alt+Tab presentation while JARVIS full-taskbar mode is
healthy, without weakening the Windows recovery path.

## Scope

- Add a bounded, native window-switch selection state machine.
- Add a dedicated low-level keyboard-hook thread for Alt+Tab and
  Alt+Shift+Tab.
- Render the switcher through an independent React/WebView2 surface using the
  approved flat night-shell visual language.
- Activate only a window ID captured and revalidated by the existing native
  taskbar service.
- Keep Native and Hybrid taskbar modes on the Windows switcher.
- Fall through to Windows when the hook, renderer, full replacement, or window
  snapshot is unavailable.

## Input contract

- Alt+Tab starts or advances forward.
- Alt+Shift+Tab starts or advances backward.
- Releasing Alt activates the selected window.
- Escape cancels without changing the foreground window.
- Ctrl+Alt+Tab, injected input, secure desktop, Win+Tab, and unrelated Alt
  shortcuts are never intercepted.
- The hook callback performs no window enumeration, WebView work, disk access,
  or synchronous UI dispatch.

## Safety contract

- Interception is enabled only when the effective taskbar mode is `full`, the
  switcher renderer is ready, and `JARVIS_KEEP_NATIVE_TASKBAR` is not active.
- A failed first selection returns the original key event to Windows.
- Hook disposal or host termination automatically restores the native keyboard
  path.
- `Ctrl+Shift+Q` remains independent and available throughout the session.
- At most 24 eligible top-level windows enter one switcher snapshot.
- The native taskbar watchdog and Explorer recovery behavior remain unchanged.

## Visual contract

- Near-black navy chassis, angular cut corners, and layered ice/cyan/cobalt
  emission.
- No glass cards, broad bloom, RGB accents, or repeated circular framing.
- The selected window is unmistakable without relying on color alone.
- Long titles clamp without changing card coordinates.
- The browser surface supports a deterministic mock state for automated visual
  and interaction review.

## Acceptance

- Selection wraps correctly in both directions and commits only on Alt release.
- Empty or unavailable snapshots leave native Alt+Tab untouched.
- The JARVIS desktop host does not appear in the switcher.
- Frontend lint, format, unit tests, and production build pass.
- Host restore, build, and tests pass with zero warnings and errors.
- Browser QA verifies page identity, non-empty rendering, console health,
  selected-state changes, and screenshot quality.
- Native QA ends with the original taskbar visible, Explorer running, no
  JARVIS process, and all test windows closed.

## Explicit boundary

R12 does not replace Win+Tab virtual desktops, the secure desktop, elevated
cross-integrity UI, or third-party application content.

## Result

Completed on 2026-07-28.

- Frontend lint, format, 36 tests, and production build passed.
- Host restore, Release build, and 39 tests passed with zero warnings and
  errors.
- Browser QA at 1040x360 and 760x320 confirmed bounded rendering, forward and
  reverse selection, no viewport overflow, and no console or framework errors.
- Native Full-mode QA confirmed hook registration, renderer readiness,
  replacement activation, and switcher enablement on Windows build 26200.
- Native screenshot review found and fixed a high-DPI positioning-order defect;
  the 1120px HUD now centers at x=960 on the 1920px primary display.
- Forced-host recovery returned `READY`: Explorer remained alive, the native
  taskbar was visible, and no JARVIS or watchdog process remained.

Automated Windows input is injected by definition and is intentionally rejected
by this security contract, so the final physical-key Alt+Tab gesture remains a
short manual acceptance check.
