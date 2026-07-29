# JARVIS V1 R33-R38 Fullscreen and Virtual Desktop Plan

Status: `F11 CORRECTION IMPLEMENTED - INTERACTIVE RETEST PENDING`

Baseline: `main @ 57ef7d1`

Primary environment: current Windows 11 development machine

## Product evidence

The replacement taskbar is a topmost WPF surface. It currently remains visible
when the foreground application enters exclusive-looking borderless or F11
fullscreen mode, so it can cover the application's bottom edge.

The taskbar and JARVIS Alt+Tab snapshot currently enumerate every eligible
top-level window. They do not ask Windows whether a window belongs to the
currently active virtual desktop, so another workspace can leak into the
current taskbar and switcher.

Microsoft exposes `IVirtualDesktopManager::IsWindowOnCurrentVirtualDesktop` for
desktop applications on Windows 10 and later. This round uses that documented
read-only method only. It does not move windows or call private Explorer
virtual-desktop interfaces.

Primary references:

- https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ivirtualdesktopmanager-iswindowoncurrentvirtualdesktop
- https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-iszoomed

## R33 - Pure fullscreen presentation policy

- Classify fullscreen from the foreground window frame and its monitor bounds.
- Allow a narrow DWM frame tolerance without treating an ordinary maximized
  work-area window as fullscreen.
- Exclude a maximized window only when it still has the standard caption and
  resize-frame styles. Read both synchronized `IsZoomed` state and the earlier
  `WS_MAXIMIZE` transition bit, but do not reject a borderless F11 window merely
  because the browser retained either maximized marker.
- Suppress only for a fullscreen foreground window on the primary monitor.
- Keep invalid, minimized, shell-owned, secondary-monitor, and unmeasurable
  windows on the ordinary taskbar path.

## R34 - Event-driven fullscreen observation

- Add foreground window location changes to the existing coalesced WinEvent
  refresh set so entering and leaving F11 is detected without a new poll loop.
- Carry the current fullscreen state in the bounded taskbar snapshot.
- Keep the one-second taskbar capture as the existing recovery fallback.
- Publish only when the snapshot changes.

## R35 - Reversible taskbar suppression

- Separate lifecycle activation from temporary fullscreen suppression.
- Hide the taskbar surface, launcher overlay, edge overlay, and native flyout
  while suppression is active.
- Keep the renderer heartbeat and watchdog replacement lease alive.
- Reveal the same validated surface when fullscreen ends; do not rebind or
  restart WebView2.
- Never restore the native taskbar merely because an application entered
  fullscreen.

## R36 - Documented virtual desktop query

- Create the documented `CLSID_VirtualDesktopManager` COM object.
- Call only `IsWindowOnCurrentVirtualDesktop`.
- Query eligible top-level windows during the existing taskbar capture.
- Treat an explicit `false` result as off-workspace and exclude that window.
- Fail open when COM activation or an individual HRESULT fails so an API
  problem cannot make all applications disappear.

## R37 - Scoped taskbar actions and switcher

- Apply the same current-desktop filter to taskbar enumeration and to
  revalidation before activate, minimize, or close.
- Because the JARVIS switcher consumes the taskbar snapshot, it inherits the
  same workspace boundary without a second enumeration path.
- Report filter availability and the number of off-desktop windows omitted in
  runtime diagnostics.

## R38 - Regression and live acceptance

- Cover exact fullscreen, DWM-tolerant fullscreen, maximized work area,
  secondary-monitor fullscreen, and invalid geometry with pure tests.
- Cover virtual-desktop current, other, and unavailable outcomes with pure
  fail-open tests.
- Cover taskbar lifecycle visibility independently from temporary suppression.
- Run frontend and host quality gates after the implementation is reviewed.
- Perform a short controlled F11 foreground test on the current Windows 11
  machine, then exit JARVIS, restore the native taskbar, and close every window
  opened for the test.
- Do not synthesize a virtual desktop switch during unattended validation;
  document the public COM integration and rely on deterministic scope tests
  until a user-coordinated multi-desktop test is appropriate.

## Safety boundary

- Preserve Explorer, the native taskbar, secure desktop, and all recovery paths.
- Do not press or intercept Windows-key virtual-desktop shortcuts.
- Do not create, switch, rename, remove, or move windows between virtual
  desktops.
- Do not use undocumented `ImmersiveShell` virtual-desktop services.
- Do not add high-frequency polling.
- Preserve and exclude all user changes under `assets/archive`.

## Validation result

- Host Debug tests and Release build passed after the F11 correction; the
  Release build completed with 0 warnings and 0 errors.
- Host tests after the correction: 119 passed, 0 failed, including retained
  `IsZoomed` and `WS_MAXIMIZE` borderless-F11 regressions.
- Frontend: format contract, ESLint, 51 tests, and Vite production build all
  passed.
- Safe native lifecycle on Windows build 26200: `READY`; Explorer remained
  alive, the native taskbar was visible before and after, and no JARVIS process
  remained.
- Runtime log: 6/6 WinEvent ranges active and documented
  `IVirtualDesktopManager` filtering available on the current Windows 11
  machine.
- Strict compatibility readiness: Windows build 26200, x64, 2560x1440 primary
  monitor, and WebView2 `150.0.4078.105` all detected as compatible. This is
  current-machine readiness, not Windows 10 certification.
- Real Edge window-style probe: ordinary maximized Edge reported maximized state
  and retained a work-area frame; `--start-fullscreen` removed maximized state
  and covered the complete 2560x1440 primary monitor. The maximized false
  positive found during the first live run is covered by both `IsZoomed` and
  the earlier `WS_MAXIMIZE` transition bit.
- The Codex desktop-control session could enumerate and capture isolated QA
  windows but could not make any non-Codex window foreground, even before
  JARVIS started. Therefore an unattended F11 enter/leave screenshot could not
  be obtained in this run. No production-only activation bypass was added;
  interactive F11 confirmation was delegated to the user on the built
  executable.
- User acceptance on 2026-07-29 found that F11 hid the top chrome but left the
  JARVIS taskbar visible. The runtime log contained no fullscreen-suppression
  event. The correction now distinguishes a standard framed maximized window
  from a borderless F11 window whose browser retains `IsZoomed` or
  `WS_MAXIMIZE`; deterministic regression coverage is included. A rebuilt
  executable still requires one short interactive F11 retest.
- Post-correction safe lifecycle verification returned `READY`: Explorer
  remained alive, the native taskbar was visible before and after, and no
  JARVIS process remained.
