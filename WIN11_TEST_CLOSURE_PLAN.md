# JARVIS V1 Windows 11 Test Closure Plan

Status: `AVAILABLE WINDOWS 11 GATES PASSED`

Date: 2026-07-30

## Scope

Close the remaining release evidence on the current Windows 11 development
machine without claiming Windows 10 certification or unavailable hardware
coverage.

Current host:

- Windows build 26200, x64
- one physical 2560×1440 monitor
- WebView2 Evergreen detected
- primary-monitor replacement policy

## Safety boundary

- Preserve the two user-owned `assets/archive` changes.
- Keep every live native test bounded by a timeout and an explicit recovery
  path.
- Capture evidence, then immediately close JARVIS, restore the native taskbar,
  and verify that no JARVIS or preview process remains.
- Do not automate lock, sign-out, restart, shutdown, sleep, or network
  disruption while the user may be working.
- Do not claim physical two-monitor or physical-keyboard Alt+Tab coverage on
  hardware that is not present.

## Automated gates

- [x] Windows compatibility probe in strict mode
- [x] frontend tests, ESLint, format contract, and production build
- [x] locked Host restore, Release build, and full Host test suite
- [x] clean self-contained `win-x64` release publication
- [x] portable ZIP, checksums, update manifest, and installer generation
- [x] safe-mode native lifecycle launch and recovery
- [x] isolated current-user install, repair, safe launch, uninstall, and
      startup-registration cleanup

## Controlled live Windows 11 gates

- [x] Full replacement launch hides the native primary taskbar only after the
      watchdog handshake
- [x] JARVIS desktop and replacement taskbar render at 2560×1440
- [x] Start, Quick Search, File Explorer, context menu, selection, and sorting
      remain operable in the native host
- [x] F11 hides and restores both top and bottom shell chrome
- [x] an eligible pre-existing Windows app receives the configured DWM/aura
      appearance and has a recovery receipt
- [x] normal exit restores the native taskbar and native window appearance
- [x] final process, listener, Explorer, and taskbar recovery checks pass

The Start, command search, and File Explorer panels were opened through the
real WebView2 host and inspected at native resolution. Their non-mutating
selection, sorting, and context-menu models are also covered by the current
frontend suite; no user file operation was executed during closure.

## Current-run evidence

- strict compatibility probe: Windows `10.0.26200.0`, x64, 2560×1440,
  WebView2 `150.0.4078.105`, compatible
- frontend: 113 tests passed; ESLint, formatting, and production build passed
- native Host: 140 tests passed; Release build completed without warnings or
  errors
- full replacement: watchdog handshake completed, native primary taskbar was
  hidden, and the JARVIS taskbar was revealed
- native panels: Start, command search, and File Explorer rendered through the
  full host at 2560×1440
- fullscreen regression: F11 suppressed the standalone JARVIS taskbar window;
  leaving F11 restored it, with both transitions recorded in the Host log
- native appearance: immersive DWM attributes, four click-through aura edges,
  and the recovery receipt were verified against an existing Windows app
- package integrity: all 273 `SHA256SUMS.txt` entries passed
- portable ZIP SHA-256:
  `52efada277a23c15814b92bc429ce830bb79932ec6e88e1f00ee5f1b705a0954`
- installer SHA-256:
  `a8654390d3d1a81bdc971b8c09829c9eca21cf87a60d56e4c3d0ac7c3813e8ed`
- installer lifecycle: isolated install, native-taskbar-safe launch, repair,
  uninstall, startup cleanup, and Explorer recovery passed
- final recovery: JARVIS process count 0, Explorer process count 1, native
  taskbar visible, no pending window-appearance recovery receipt, and no
  installer test directory

## Defects closed during this pass

- disabled automatic Git-SHA suffixing so the packaged executable reports the
  requested product version `0.1.0`
- updated installer lifecycle evidence to the current durable native-safe
  taskbar receipt and removed stray process-wait output
- fixed F11 handling for applications that retain maximized window styles while
  DWM presents a work-area-constrained fullscreen surface

## Explicitly unavailable or deferred

- Windows 10 real-machine certification
- physical two-monitor placement and DPI transition
- physical-keyboard Alt+Tab hook feel
- lock/unlock, sleep/resume, network disconnect, sign-out, restart, and
  shutdown
- signed MSIX notification-history permission lifecycle

## Completion rule

This plan may be marked complete only when every available gate has current-run
evidence, any discovered defect has been fixed and retested, generated packages
match the tested commit, and the Windows desktop has been released.
