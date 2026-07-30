# JARVIS V1 R45-R47 Taskbar Date and Time Plan

Status: `IMPLEMENTED - NON-COMPILATION GATES AND BROWSER QA PASSED`

Baseline: `main @ 3c6f72c`

Primary environment: current Windows 11 development machine

## Product outcome

Restore the familiar taskbar clock interaction in Full replacement mode without
requesting calendar-account access or inventing appointments. The panel uses the
existing native system timestamp and session-only JARVIS System Feed.

## R45 - Deterministic local calendar model

- Build a Monday-first 6 by 7 month grid from local calendar dates.
- Handle month and year boundaries, leap years, and invalid timestamps without
  relying on UTC date-string slicing.
- Mark today, the selected day, adjacent-month days, and bounded session-event
  counts.
- Keep month navigation and keyboard date movement in pure tested functions.

## R46 - Taskbar clock entry and surface routing

- Replace the passive clock text with a keyboard-focusable button.
- Route `date-time` through the same bounded desktop-panel bridge used by Start,
  Quick Settings, and the System Feed.
- Keep Hybrid mode unchanged because Explorer still owns its notification area
  and native clock.
- Add the panel to the guarded native diagnostic allowlist for a later visual
  acceptance run.

## R47 - Date and time center

- Show the current local time and long date from the shared platform clock.
- Provide previous month, next month, Today, arrow-key, Home/End, and Page
  Up/Page Down navigation.
- List only real JARVIS session events whose timestamps fall on the selected
  local day; provide an honest empty state for dates without activity.
- Open Windows Date & Time Settings through the existing allowlisted shell
  target instead of adding unverified clock or time-zone mutation controls.
- Preserve Escape and click-outside dismissal through `ShellPanelLayer`.

## Safety and performance boundaries

- Do not request Outlook, Windows Calendar, Microsoft Graph, or notification
  history permissions.
- Do not write system time, time zone, locale, or first-day-of-week settings.
- Do not add a timer or polling loop; reuse the existing minute-level clock
  projection and event-driven feed store.
- Keep visible session events bounded and avoid a second feed subscription.
- Preserve and exclude all user changes under `assets/archive`.

## Validation contract

- Run frontend unit tests, ESLint, and format checks without producing a
  production bundle.
- Run C# format verification without restoring or compiling the host.
- Defer production build and native visual acceptance until the user explicitly
  permits compilation.

## Validation evidence

- Frontend unit tests: `65/65` passed.
- ESLint and Prettier verification passed.
- C# format verification passed with `--no-restore`.
- Browser QA passed at `1280 x 720` and `2560 x 1440` with no application
  warnings or errors.
- Verified taskbar-clock activation, the 42-cell calendar matrix, selection of a
  date containing a real session event, and Arrow Right keyboard navigation.
- Production packaging, EXE compilation, and native WebView2 acceptance remain
  intentionally deferred.
