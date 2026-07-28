# JARVIS V1 R21-R23 Multi-monitor Window Switcher Plan

Status: `VALIDATED ON AVAILABLE HARDWARE · PHYSICAL INPUT AND TWO-MONITOR LIVE PENDING`

Baseline: `main @ 802a155`

Primary environment: current Windows 11 development machine

## Product evidence

The R12 window switcher still calculates its rectangle from the primary monitor
even when the foreground application is on another display. It also uses the
full monitor rectangle instead of the work area and fixed physical-pixel
constraints at every DPI.

`PresentAsync` sends state to WebView2 before revealing the native window. A
dismissal or newer selection can occur while that asynchronous script is still
in flight, allowing an obsolete completion to reveal the HUD after the switch
session has already ended.

## R21 - Deterministic DPI-aware placement

- Extract switcher sizing and centering into a pure model.
- Reuse one shared logical-to-physical DPI policy with Quick Search so the two
  HUD surfaces cannot drift to different supported scale ranges.
- Scale the logical width, height, and margin limits into native pixels for
  100%-500% Per-Monitor-V2 displays.
- Use the selected monitor's work area, including negative virtual coordinates.
- Keep every valid rectangle within the work area and fail closed for invalid,
  undersized, or unsupported display inputs.
- Cover primary, negative secondary, compact, 150%, 200%, invalid rectangle,
  and invalid scale cases.

## R22 - Foreground-monitor targeting

- Capture the foreground HWND while the non-activating switcher is hidden.
- Select the nearest monitor for that foreground window.
- Fall back to the primary monitor only when foreground targeting is
  unavailable.
- Position after `Show()` so WPF cannot reapply stale XAML dimensions.
- Log the chosen source, monitor, scale, work area, and final rectangle once per
  switch session rather than once per selection step.

## R23 - Stale presentation rejection

- Assign a monotonic epoch to each asynchronous renderer update.
- Starting a newer update invalidates every older in-flight completion.
- Dismissal and shutdown invalidate the active epoch before hiding or disposing
  the surface.
- Reveal only when the renderer completion still owns the current epoch.
- Cover superseded and explicitly invalidated epochs with pure tests.

## Safety boundary

- Native and Hybrid taskbar modes continue to use the Windows switcher.
- Injected input, secure desktop, Win+Tab, and failed first selection remain on
  the native Windows path.
- No native compile, EXE launch, keyboard interception, or taskbar manipulation
  occurs without a new explicit authorization.
- Preserve and exclude all user changes under `assets/archive`.
- The current host exposes one physical display; real two-monitor acceptance
  remains pending for compatible hardware.

## Source review result

- R21 adds a deterministic work-area placement model and shares the supported
  DPI policy with Quick Search instead of duplicating scale arithmetic.
- R22 selects the foreground window's nearest monitor, falls back to the
  primary display, and emits one placement diagnostic per switch session.
- R23 rejects both superseded and dismissed asynchronous renderer completions,
  including their stale error paths.
- Static diff, reference, geometry, process, and archive-scope checks pass.
- Native compilation, automated tests, and the persistent diagnostic surface
  pass on the available display.
- Physical Alt+Tab remains a manual check because the low-level hook rejects
  injected input by design.
- Physical two-monitor targeting is not claimed because the current development
  host enumerates only one monitor.

## Validation evidence - 2026-07-29

- `dotnet build host/Jarvis.Host.sln -c Debug`: passed with 0 warnings and
  0 errors.
- `dotnet test host/Jarvis.Host.sln -c Debug --no-build`: passed 69/69 tests.
- Live acceptance used `JARVIS_KEEP_NATIVE_TASKBAR=1`; the native taskbar and
  native window appearance remained untouched.
- Current display: one `1920x1200` primary monitor with a `1920x1152` work area
  at 100% scaling.
- The persistent switcher diagnostic selected `\\.\DISPLAY9` from the
  foreground window and placed the HUD at `400,384` with a `1120x384` surface,
  exactly centered inside that work area.
- Visual inspection confirmed five complete window cards, a distinct selected
  state, readable footer controls, and no frame or content clipping.
- Placement diagnostics emitted once for the session rather than for every
  visible selection.
- `Ctrl+Shift+Q` completed the safe exit; no `Jarvis.Host` process remained,
  and every temporary Notepad and Calculator window was closed.
