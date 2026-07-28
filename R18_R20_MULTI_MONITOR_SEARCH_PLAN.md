# JARVIS V1 R18-R20 Multi-monitor Quick Search Plan

Status: `VALIDATED ON AVAILABLE HARDWARE · TWO-MONITOR LIVE PENDING`

Baseline: `main @ e863564`

Primary environment: current Windows 11 development machine

## Product problem

The standalone `Ctrl+Alt+J` Quick Search window currently centers only on the
primary monitor. When the active application is on another display, the HUD
appears away from the user's current focus and breaks the expectation of a
desktop-level launcher.

## R18 - Deterministic placement model

- Extract window sizing and centering from `QuickSearchWindow`.
- Use native pixel work-area rectangles, including negative virtual-screen
  coordinates.
- Scale logical size constraints into physical pixels for each Per-Monitor-V2
  display so the HUD keeps a consistent apparent size at 100%-500% scaling.
- Keep the window inside the selected work area.
- Reject invalid or extremely small work areas instead of producing an
  off-screen window.
- Add pure model tests for primary, offset secondary, compact, high-DPI, invalid
  rectangles, and unsupported scaling.

## R19 - Foreground-monitor targeting

- Capture the foreground HWND before showing the search window.
- Select the nearest monitor for that foreground window.
- Use the monitor work area rather than the full monitor rectangle so the HUD
  does not cover a visible native taskbar.
- Fall back to the primary monitor work area when foreground-monitor discovery
  is unavailable.
- Preserve foreground restoration and task-switcher exclusion.

## R20 - Diagnostics and safe fallback

- Record the chosen monitor, scale, work area, final bounds, and whether the
  primary fallback was used.
- Publish a bounded JARVIS System Feed warning only when foreground targeting
  fails and primary fallback is required.
- Fail closed without presenting the HUD if neither a target nor primary work
  area can produce valid bounds.
- Keep shortcut registration non-fatal and retain desktop `Ctrl+Space`.

## Validation boundary

- Native compilation and live shell testing require explicit user authorization.
- A development batch may land on `main` after a clean native build, complete
  automated tests, and live acceptance on the available display topology.
- Real two-monitor acceptance remains a compatibility gate before release
  sign-off when the current development host exposes only one display.
- Preserve and exclude all user changes under `assets/archive`.

## Source review result

- R18 now owns deterministic, DPI-aware, work-area-bounded placement with
  negative virtual coordinates and focused model coverage.
- R19 targets the foreground window's nearest monitor and preserves primary
  fallback plus foreground restoration.
- R20 records placement diagnostics, reports only bounded fallback warnings,
  and fails closed when no supported work area is available.
- Static reference, diff, and repository-scope checks are complete.
- Native build and automated native tests pass.
- Live foreground-monitor placement and safe taskbar restoration pass on the
  available display.
- Physical two-monitor targeting is not claimed because the current development
  host enumerates only one monitor.

## Validation evidence - 2026-07-28

- `dotnet build host/Jarvis.Host.sln -c Debug`: passed with 0 warnings and
  0 errors.
- `dotnet test host/Jarvis.Host.sln -c Debug --no-build`: passed 55/55 tests.
- Current host: Windows build 26200; one `2560x1440` primary display with a
  `2560x1392` work area at 100% scaling.
- Live `Ctrl+Alt+J`: selected the foreground window's `\\.\DISPLAY1` monitor
  and placed the HUD at `800,346` with a `960x700` surface, centered within the
  work area.
- Returning focus to the foreground app dismissed the HUD.
- `Ctrl+Shift+Q` requested the safety exit; the watchdog restored the primary
  Windows taskbar, and no `Jarvis.Host` process remained.
- Pure placement tests cover negative secondary coordinates, compact work
  areas, 150% and 200% scaling, invalid rectangles, and unsupported scaling.
