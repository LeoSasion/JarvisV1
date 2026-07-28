# R14 — Global Quick Search Control

## Goal

Turn the R13 global Quick Search shortcut into a user-controlled, reversible
runtime capability instead of an always-on host behavior.

## Scope

- Add a JARVIS Settings switch for the fixed `Ctrl+Alt+J` shortcut.
- Persist the preference for the current Windows user.
- Expose enabled, registered, failed, and intentionally disabled states.
- Show the native registration failure reason without treating it as fatal.
- Unregister the shortcut and dispose the hidden search WebView when disabled.
- Recreate and warm the renderer before registering the shortcut when enabled.
- Keep the in-desktop `Ctrl+Space` search path available in every state.
- Include the configured state in release and recovery diagnostics.

## State contract

- `enabled + registered`: `Ctrl+Alt+J` opens the global search HUD.
- `enabled + unavailable`: Windows keeps the conflicting shortcut; Settings
  exposes the failure and offers a retry.
- `disabled`: no global hotkey or hidden search WebView remains allocated.
- `configuration warning`: malformed saved state falls back to enabled, reports
  the warning, and remains user-correctable.
- A preference write must succeed before the runtime lifecycle changes.

## Safety contract

- The shortcut remains fixed; R14 does not add arbitrary key capture.
- Disabling is synchronous from the native settings request and releases the
  hotkey before returning the new state.
- Enabling registers only after the isolated WebView reports ready.
- Registration or renderer failure never disables the desktop `Ctrl+Space`
  entry point or changes Windows shell shortcuts.
- The Global Search bridge profile does not receive the settings methods.

## Acceptance

- Browser preview loads the saved mock preference and toggles it both ways.
- The switch distinguishes loading, saving, disabled, registered, and retry
  states without relying on color alone.
- Mock platform tests cover persistence-facing state changes and diagnostics.
- Frontend lint, formatting, and unit tests pass.
- Host source is reviewed for persistence, teardown, recreation, failure
  preservation, bridge profile isolation, and shutdown cleanup.

## Validation boundary

Native test authorization was granted on 2026-07-28. Compile and runtime
acceptance use `JARVIS_KEEP_NATIVE_TASKBAR=1`; full taskbar replacement and
external native-window styling remain outside this round. Commit and push still
require a separate request.

## Explicit exclusions

R14 does not add configurable key combinations, voice input, an Agent executor,
Windows Search replacement, secure-desktop input, arbitrary commands, or
enterprise shell replacement.

## Result

`NATIVE ACCEPTANCE PASSED`

- Added a versioned current-user preference with atomic writes, an enabled-by-
  default fallback, and visible malformed-configuration warnings.
- Added explicit disabled, starting, registered, and unavailable states.
- Disabling unregisters `Ctrl+Alt+J`, dismisses the HUD, closes the isolated
  window, and disposes its WebView2 bridge. Enabling recreates the renderer and
  registers only after readiness.
- Registration and renderer failures remain non-fatal, preserve their real
  reason, and keep desktop `Ctrl+Space` available.
- Added a Settings control, bounded readiness polling, browser-preview
  persistence, dynamic diagnostics, and platform coverage.
- ESLint, format validation, and all 41 frontend tests pass.
- The production frontend and .NET Debug solution compile successfully with
  zero warnings and zero errors. All 43 native host tests pass, including
  isolated default, persistence, startup-state, and malformed-preference cases.
- Browser QA passed for ON → OFF → ON, the disabled-state fallback copy,
  panel containment, and zero console warnings/errors. The observed three-pixel
  scroll-width difference is clipped by the existing `overflow-x: hidden`
  contract and has no overflowing descendant.
- The browser tab and local Vite server were closed after validation; no
  `Jarvis.Host` process remains.
- The Debug EXE passed two safe-mode runs. Host logs confirmed renderer
  readiness and system-wide registration; `Ctrl+Alt+J` opened the standalone
  HUD above Notepad and Paint, showing installed applications and current
  windows. `Ctrl+Shift+Q` completed safe exit on both runs.
- Full replacement mode, packaged release/installer behavior, and precise
  WebView2 memory reclamation measurement remain outside R14 acceptance.
