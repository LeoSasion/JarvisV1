# R13 — Global Quick Search HUD

## Goal

Make the existing local Quick Search available above ordinary Windows
applications without returning to the JARVIS desktop, while keeping execution
inside the current allowlisted host capabilities.

## Scope

- Register `Ctrl+Alt+J` as an optional system-wide shortcut.
- Warm an independent, task-switcher-hidden WPF/WebView2 search surface after
  the desktop renderer is ready.
- Reuse the existing application, running-window, desktop-entry, and Windows
  settings index.
- Reuse the existing host launch, window activation, and `showDesktop` routes;
  do not create a second command executor.
- Add a narrow bridge profile so the search WebView cannot call terminal,
  file-mutation, diagnostics, taskbar-mode, audio, feed, or shutdown methods.
- Preserve the existing in-desktop `Ctrl+Space` search entry point.

## Shortcut contract

- `Ctrl+Alt+J` toggles the global search surface.
- Registration failure is non-fatal and leaves all Windows shortcuts intact.
- The shortcut never intercepts the Windows key, Alt+Space, Ctrl+Space, or
  secure-desktop input.
- `Escape` and outside-click dismissal restore the previously foreground
  eligible window.
- Successful execution hides the surface without restoring the old foreground
  window, allowing the selected target to activate normally.

## Capability contract

The global search renderer may request only:

- the bounded desktop-entry list;
- the cached application catalog;
- the cached taskbar-window snapshot;
- activation of a selected window ID;
- launch of an existing opaque application ID;
- opening an already allowlisted built-in target or listed desktop item;
- showing an allowlisted JARVIS desktop panel;
- dismissal of its own surface.

Every ID/path/target remains revalidated by the existing native service at
execution time. The search renderer cannot supply an executable path, command
line, arbitrary HWND, or arbitrary shell verb.

## Visual contract

- Flat near-black HUD frame with angular borders and layered
  cold-white/ice-cyan/cobalt emission.
- Search input is the dominant focus; results stay bounded to nine rows.
- Long labels and details clamp without changing result coordinates.
- Loading, empty, busy, error, and keyboard-selected states are visible without
  relying on color alone.
- The standalone surface supports deterministic browser preview and keyboard
  interaction checks.

## Acceptance

- The standalone route renders without framework or console errors.
- Typing filters apps, windows, desktop entries, and settings through the shared
  Quick Search scorer.
- Arrow, Home, End, Enter, and Escape behavior remains keyboard-first.
- React listeners and platform subscriptions are cleaned up on unmount.
- Frontend lint, formatting, and unit tests pass.
- Host source is reviewed for disposal, origin validation, method gating,
  foreground restoration, and shortcut conflict fallback.

## Validation boundary

Native compilation and acceptance were subsequently authorized after the
source-only R13 round. The integrated R13/R14 implementation was compiled,
tested, and exercised through the real system-wide shortcut before
publication. Full taskbar-replacement mode and packaged installer behavior
remain separate release-level acceptance scopes.

## Explicit exclusions

R13 does not add voice input, a local speech pipeline, an Agent executor, a
Windows-key hook, Win+S replacement, arbitrary commands, web search, clipboard
history, or secure-desktop integration.

## Result

`NATIVE ACCEPTANCE PASSED`

- Added the optional global `Ctrl+Alt+J` registration, transparent renderer
  warm-up, task-switcher-hidden search window, foreground restoration, and
  non-fatal registration fallback.
- Added a dedicated bridge profile limited to eight list/open/activate/show/
  dismiss methods. The hidden surface receives taskbar, application-catalog,
  and desktop-entry updates without subscribing to unrelated system, tray,
  feed, appearance, file-transfer, or terminal events.
- Added the standalone React search surface, busy/error/dismiss states, shared
  nine-row scorer, pure action routing, and capability-preserving tests.
- Frontend ESLint, format validation, and the original 40 R13 unit tests passed;
  the current integrated suite passes all 41 tests.
- Browser QA passed at `1280x720` and `720x500`: no overflow, framework error
  overlay, console warning, or console error; filtering, selection movement,
  and Escape dismissal were verified.
- The production frontend and .NET Debug solution compile successfully with
  zero warnings and zero errors. All 43 native host tests pass.
- Two safe-mode native runs confirmed renderer readiness and system-wide
  registration. `Ctrl+Alt+J` opened the standalone HUD above Notepad and Paint,
  and `Ctrl+Shift+Q` completed safe exit with no residual JARVIS process.
- Full taskbar-replacement mode, packaged release/installer behavior, and
  precise WebView2 memory reclamation measurement remain outside this
  acceptance.
