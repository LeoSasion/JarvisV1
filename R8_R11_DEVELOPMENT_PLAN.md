# R8–R11 delivery record

## R8 — Desktop interaction and file-operation loop

- File-system watchers refresh user and public desktop entries through a debounced bridge event.
- Desktop selection supports single, Ctrl/Command toggle, Shift range, Ctrl+A, and drag-marquee selection.
- The desktop context menu supports new folder, paste, cut, copy, rename, recycle, properties, refresh, view, sort, auto-arrange, and grid alignment.
- File copy/cut state uses the Windows file-drop clipboard rather than a renderer-only clipboard.
- Mutations retain the existing bounded-path validation, transfer preflight, conflict rename policy, and Windows Recycle Bin recovery path.

## R9 — Drag and drop

- A bounded, versioned JARVIS file-path payload enables copy/move drag operations between desktop icons and JARVIS File Explorer.
- Shift requests a move; copy is the safe default.
- Folder entries accept drops directly, and the Explorer viewport accepts drops into the current folder.
- Native Windows file drops onto the JARVIS desktop or File Explorer are captured before WebView2, normalized through the host path guard, routed by drop coordinates, and copied through the transfer coordinator.
- Native outbound OLE dragging from WebView2 to arbitrary third-party Windows apps is not claimed in this round; the system clipboard remains the interoperable fallback.

## R10 — Windows notification-history feasibility

- The host probes the Windows `UserNotificationListener` contract and current package identity.
- The renderer reports API, identity, access, and history availability without fabricating notification records.
- Unpackaged builds remain in `requires-package-identity`.
- `installer/msix/user-notification-listener.capability.xml` records the exact gated manifest capability without changing the current installer.
- A signed MSIX identity, privacy declaration, and explicit user permission are release prerequisites before a history adapter can be enabled.

## R11 — Multi-display and Windows 10 preparation

- The host enumerates monitor bounds, work areas, primary ownership, effective DPI, and scale.
- JARVIS desktop/taskbar replacement remains primary-monitor only; secondary native taskbars are preserved.
- Display changes are published live to the renderer and shown in Settings.
- Windows 10 baseline remains build 17763 (1809), x64, .NET 8 Desktop Runtime, and WebView2 Evergreen.
- `scripts/test-windows-compatibility.ps1` provides a non-mutating readiness probe.
- The current development machine verifies Windows 11 behavior only. Windows 10 certification remains a future real-machine test, not a completed claim.

## Acceptance boundary

- Frontend lint, formatting, unit tests, and browser-preview visual checks run locally.
- Native host build/test runs in GitHub Actions after push unless the user explicitly requests a local build.
- Every native replacement path must keep Explorer running, preserve the recovery hotkey, and restore the primary Windows taskbar on exit or failure.
