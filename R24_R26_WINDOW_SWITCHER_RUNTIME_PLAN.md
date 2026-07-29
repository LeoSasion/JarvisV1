# JARVIS V1 R24-R26 Window Switcher Runtime Plan

Status: `COMPLETE · AUTOMATED AND LIVE VALIDATION PASSED`

Baseline: `main @ 07c7398`

Primary environment: current Windows 11 development machine

## Product evidence

The window-switcher WebView2 surface and low-level keyboard hook are currently
created as soon as the desktop renderer becomes ready. Native and Hybrid
taskbar modes never use that surface, but still retain its renderer, HWND,
controller, and hook for the entire JARVIS session.

The diagnostic startup path intentionally relies on the switcher while
`JARVIS_KEEP_NATIVE_TASKBAR=1` is active, so a safe optimization must preserve
an explicit diagnostic override without making it part of normal startup.

## R24 - Pure runtime policy

- Decide renderer and hook ownership from requested taskbar mode, safety mode,
  and the explicit switcher diagnostic flag.
- Prewarm only for Full mode during normal operation.
- Keep Native and Hybrid modes on the Windows switcher without creating the
  JARVIS switcher runtime.
- Let explicit diagnostics override the normal and safety-mode policy.
- Return a stable decision reason for lifecycle diagnostics.

## R25 - Reversible runtime lifecycle

- Reconcile switcher ownership after desktop readiness and every requested
  taskbar-mode change.
- Create the renderer and hook before Full replacement becomes effective, but
  keep interception disabled until the existing readiness gates pass.
- Disable interception, dispose the hook/controller, close WebView2, and clear
  ownership when leaving Full mode.
- Treat a mode change during WebView2 prewarming as an intentional cancellation
  instead of a renderer startup failure.
- Recreate the runtime when a later mode transition requests Full again.
- Use the same idempotent release path for hook startup failure and host
  shutdown.

## R26 - Transition regression coverage

- Cover Full, Native, Hybrid, safety-mode, and diagnostic decisions.
- Cover both Full-to-Native release and Native-to-Full creation transitions.
- Review every creation and release path for stale references and duplicate
  shutdown logic.
- Compile, run automated tests, and perform live Full/Native/Full lifecycle
  diagnostics only after a new explicit authorization.

## Safety boundary

- Native and Hybrid taskbar modes continue to use Windows Alt+Tab.
- Full mode still cannot intercept input until both its renderer and taskbar
  replacement report ready.
- The diagnostic override remains opt-in through
  `JARVIS_WINDOW_SWITCHER_DIAGNOSTIC=1`.
- No native compile, EXE launch, keyboard interception, taskbar manipulation,
  or visual automation occurs without a new explicit authorization.
- Preserve and exclude all user changes under `assets/archive`.

## Source review result

- Runtime ownership is now expressed as a pure, deterministic policy.
- MainWindow reconciles that policy at desktop readiness and requested-mode
  transitions.
- Native/Hybrid/safety paths release all switcher-owned native and WebView2
  resources instead of merely disabling interception.
- Hook startup failure and host shutdown share the same idempotent release
  path.
- In-flight WebView2 prewarming observes the window shutdown token and exits
  without a false failure when a mode transition releases it.
- Authorized automated and live validation passed.

## Validation result

- `dotnet build host/Jarvis.Host.sln -c Debug` completed with zero warnings and
  zero errors.
- The complete host regression suite passed: 98 tests.
- Live Full mode created the JARVIS window-switcher runtime before replacement
  activation and released it during the global safety exit.
- Live Native and Hybrid startup logs contained no window-switcher runtime
  creation, leaving Windows Alt+Tab ownership intact.
- Full replacement remained stable beyond its 30-second recovery-clear gate.
