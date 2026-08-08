# JARVIS Native Host

`Jarvis.Host` is the first Windows-native runtime for the JARVIS desktop. It keeps
the existing React interface, hosts `frontend/dist` in WebView2, and exposes a
small authenticated-by-origin JSON bridge to Windows services.

## Prerequisites

- Windows 10 or Windows 11 (Home and Pro are supported)
- .NET 8 SDK for building
- Microsoft Edge WebView2 Runtime for running (Evergreen Runtime is recommended)
- A built `frontend/dist/index.html`

A fresh profile starts in **hybrid primary-taskbar mode**. Explorer remains
running and owns the notification area while JARVIS places a separate always-on-top
surface over the rest of the primary taskbar. If the shell probe, exclusion region,
or renderer is unavailable, JARVIS closes that surface and keeps the complete native
taskbar active. Full replacement is an explicit experimental opt-in: it arms an
out-of-process recovery watchdog, waits for the watchdog's ready signal, and lets
that watchdog hide and confirm `Shell_TrayWnd` before revealing the custom surface.
Neither mode modifies the registry, terminates Explorer, changes the logon UI, or
requires administrator privileges.

The desktop host is excluded from the Windows taskbar and task switcher. If a
Win+D or shell transition tries to minimize it, JARVIS restores the desktop
surface without activation so ordinary application switching cannot expose the
Explorer desktop underneath it.

When full replacement is healthy, a dedicated low-level keyboard-hook thread
routes physical Alt+Tab and Alt+Shift+Tab through an independent no-activate
WebView2 HUD. The hook uses the cached, bounded taskbar snapshot and posts
renderer work asynchronously; releasing Alt revalidates and activates the
selected HWND through the existing taskbar service. Native and hybrid modes,
safe mode, Ctrl+Alt+Tab, injected input, Win+Tab, renderer failure, and empty
snapshots remain on the Windows switcher.

When an ordinary foreground application covers the complete primary-monitor
frame, JARVIS temporarily hides only its taskbar surface and chrome overlays.
The replacement lease, renderer heartbeat, watchdog, and Explorer recovery
state remain intact, so leaving F11 or borderless fullscreen reveals the same
validated surface without rebinding WebView2 or flashing the native taskbar.
Maximized work-area windows and fullscreen windows on secondary monitors do not
suppress the primary JARVIS taskbar. A retained maximized-state flag alone does
not disqualify fullscreen: JARVIS excludes only maximized windows that still
have a standard caption and resize frame, allowing F11 borderless windows to
hide the surface correctly.

The native taskbar is restored on normal exit, WebView failure, UI-thread crash,
watchdog failure, UI hang, and forced host-process termination. On recovery the
watchdog first hides the verified JARVIS taskbar HWND from outside the host, so a
hung topmost window cannot block the restored Windows taskbar. If the host UI is
continuously unresponsive, the watchdog terminates only the start-time-validated
JARVIS host process, waits for its windows to be destroyed, and then restores the
native taskbar. Secondary-monitor
taskbars are intentionally untouched in this milestone. Non-bottom, unavailable,
or already-hidden primary taskbars fall back to the native Windows taskbar.

Windows 11 native-window styling is independently configurable in four levels:
`off`, `conservative`, `enhanced`, and experimental `immersive`. Conservative
mode adds four narrow, DPI-aware, click-through aura strips around the active
window. Enhanced also uses supported DWM attributes for the active standard
window; immersive applies those attributes to all eligible standard windows.
JARVIS excludes its own windows, shell/security surfaces, elevated processes,
full-screen windows, cloaked/tool windows, and targets whose integrity cannot be
verified. Windows 10 automatically falls back to conservative mode.

Before changing an external DWM value, JARVIS atomically saves the original value
with the target HWND, PID, and process start time. Normal exit restores and removes
that snapshot. The taskbar watchdog also restores it after a forced termination;
the next launch retries any unresolved entry and falls back to safe mode rather
than styling more windows.

## Build and run

```powershell
dotnet restore .\host\Jarvis.Host.sln
dotnet build .\host\Jarvis.Host.sln -c Debug
dotnet run --project .\host\Jarvis.Host\Jarvis.Host.csproj
```

The project links `frontend/dist` into build and publish output under `frontend/`.
During development it can also find the repository copy by walking parent folders.
Set `JARVIS_FRONTEND_DIST` to an absolute distribution directory to override that
lookup. Set `JARVIS_WEBVIEW2_DEVTOOLS=1` to enable developer tools outside a
debugger.

For a real WebView2 integration check that does not take over the desktop or
taskbar, first build the frontend and Host, then run from the repository root:

```powershell
.\scripts\verify-renderer-smoke.ps1
```

The smoke process uses a one-time isolated WebView2 data directory, renders at
1040x720 off-screen, exercises F1 Help, Explorer + Agent linked layout, notice
placement, and Reduced Motion styling, writes a bounded receipt, and exits. It
fails closed if another JARVIS instance is running and confirms that Explorer's
native taskbar stayed visible.

Set `JARVIS_KEEP_NATIVE_TASKBAR=1` before launch to run the full-screen desktop
host without hiding or overlaying the native taskbar. Native-window hooks and
styling are also disabled. This is the recovery and development-safe mode.

For development recovery only, if the host and its watchdog have both exited
but `Shell_TrayWnd` remains hidden, run
`..\scripts\restore-native-taskbar.ps1`. It refuses to reshow Explorer while any
`Jarvis.Host` process is alive; use the global `Ctrl+Shift+Q` safety exit first
and allow the watchdog to finish whenever possible.

The replacement taskbar opens JARVIS-native Start, quick-settings,
date-and-time, Session Control, and notification panels on the desktop host.
Start can filter and launch the explicitly allowlisted Windows applications or
switch to a currently running window. Quick settings uses the live system
snapshot for network adapter, power-source, CPU, memory, and uptime status; its
controls open the matching Windows Settings pages rather than mutating system
settings directly.
The taskbar clock opens a Monday-first six-week calendar backed by the same
minute-level local clock projection. Selecting a date filters the bounded,
session-only JARVIS System Feed; it does not request a calendar account or
invent appointments. Date and time changes are handed off to the allowlisted
Windows Settings page.

Session Control keeps Exit to Windows as the safest primary action. Lock, sign
out, restart, and shutdown are fixed native actions: the renderer first requests
a 15-second single-use confirmation capability and must commit the same action
with that exact token. Executable paths and arguments remain host-only, and
restart/shutdown never add the force-close flag, preserving Windows unsaved-work
protections. Browser preview mode only simulates acceptance and cannot touch the
Windows session.

Running-window synchronization uses out-of-context Windows accessibility event
hooks for foreground, create/destroy, show/hide, location, title, minimize, and
cloak changes. Bursts are coalesced for 75 ms and refresh only the taskbar
snapshot; the one-second full telemetry poll remains active as a recovery
fallback. If all event hooks are unavailable, JARVIS continues in polling-only
mode and reports that degraded state through runtime diagnostics. Dynamic
application groups keep their first-seen order instead of following
foreground-window Z-order.

Eligible taskbar windows are filtered through the documented
`IVirtualDesktopManager::IsWindowOnCurrentVirtualDesktop` method. An explicit
off-desktop result is omitted from both the taskbar and the JARVIS switcher, and
task actions revalidate the same scope before activating, minimizing, or
closing. COM activation or query failures fail open so API degradation cannot
make all applications disappear. JARVIS does not call private Explorer virtual
desktop services and does not create, switch, move, or remove desktops.

Pinned taskbar items use Windows-style launch semantics: middle-click or
Shift+click requests a new application instance instead of toggling the current
window. Right-click opens a separate native flyout above the replacement taskbar
with only the actions valid for that item: open/new instance, close one or all
grouped windows, and unpin from the JARVIS registry. The native flyout returns a
validated action identifier to the originating renderer; it never accepts an
executable path or command line from WebView2.

Holding the mouse over a running taskbar item for 450 ms opens the same
no-activate DWM preview used by grouped-window clicks. The renderer resolves the
item again when the dwell timer fires and sends at most 24 current opaque window
IDs. Touch, pen, pinned-item drag, empty pins, and mixed native/internal groups
do not start a native hover preview. The flyout remains open only while the
pointer is inside it or a DPI-scaled corridor around its originating taskbar
item; moving to the tray or another non-preview target dismisses it after the
existing grace period.

Full replacement also exposes the familiar narrow Show Desktop target at the
far-right edge. The first click minimizes only eligible, non-minimized windows
on the current virtual desktop plus visible JARVIS workspace windows. The second
click restores only windows recorded by that same session. Every native restore
revalidates the HWND, PID, process start time, minimized state, and virtual
desktop scope, so a stale or reused handle is never restored. Opening another
window deliberately breaks the old toggle session. Hybrid mode keeps this
control hidden because Explorer's preserved notification area already owns its
native Show Desktop target.

JARVIS quick search combines the explicit application allowlist with a cached
index of `.lnk` entries under the current-user and common Start Menu Programs
directories plus packaged applications exposed by the Windows AppsFolder.
Uninstall and removal shortcuts are excluded from this launcher surface. Search
opens only from the JARVIS desktop and replacement taskbar; the host does not
register a system-wide search shortcut or create a hidden search renderer.
The Windows key and secure-desktop input remain untouched. The renderer receives
opaque application capability IDs rather than shortcut paths
or AppUserModelIDs. Shortcut entries also expose only normalized executable process
names obtained through the Shell Link target, while running packaged apps expose
the same opaque capability generated from their process AppUserModelID. This lets
the replacement taskbar associate a pinned entry with its live windows without
revealing either launch identity to WebView2. Before launch, the host resolves the ID from its current
index. Shortcut entries are revalidated against the two trusted roots, while
packaged apps are activated through `IApplicationActivationManager` with no
arguments. Arbitrary shortcut paths, AppUserModelIDs, and command-line arguments
are never accepted from WebView2.

The center taskbar control opens the embedded Pi Agent conversation window; it
does not replace JARVIS quick search. V1 is deliberately chat-only: the host
starts Pi lazily on the first prompt with tools, extensions, skills, and project
context disabled, and rejects tool-call events if a provider emits them. It does
not download Pi or collect credentials at application runtime. Release builds
stage the complete pinned Pi distribution under `AgentRuntime` and retain its
directory structure, trust manifest, provenance, and MIT license. The bundled
runtime takes precedence and must match the manifest embedded in `Jarvis.Host`;
the host verifies the byte-identical manifest, deterministic 217-file runtime
receipt, every upstream file hash, total size, and entry-point identity
immediately before every lazy start. A missing, stale, modified, linked, or
unexpected bundle file fails closed. Each accepted turn is also bounded to
16,384 events, 1 MiB of assistant-output characters, and 32 MiB of raw event
payload characters so
repeated cumulative snapshots cannot create unbounded parse or allocation work.
The host keeps the prompt command reservation until its matching RPC response
arrives, preventing a cancelled older request from terminating a newer turn.

An unpackaged developer may opt into an external native executable only by
setting `JARVIS_ALLOW_EXTERNAL_PI_RUNTIME=1`, `JARVIS_PI_EXECUTABLE` to an
absolute `.exe` path, and `JARVIS_PI_EXECUTABLE_SHA256` to its expected SHA-256.
This override is intentionally never an automatic fallback for a damaged bundle.
Neither path modifies global `PATH`, installs a global package, nor performs
silent Pi upgrades. Agent state and an empty private package directory are kept
under `%LOCALAPPDATA%\JARVIS\PiAgent`; provider credentials remain in the native
runtime environment and are never sent to WebView2. Pi starts in offline mode to
skip model-registry and version refreshes; provider inference still occurs only
after the user submits a prompt. The child process is created suspended through
native `CreateProcessW`, assigned to a kill-on-close Windows Job Object before
its primary thread can run, and resumed only after stdio containment is
complete. Startup fails closed and confirms termination when any launch or
Job-assignment step fails.

For native preview QA, set `JARVIS_TASKBAR_DIAGNOSTIC_FLYOUT_PROCESS` to a
process name such as `msedge`. After the taskbar is ready, the host opens the
same DWM-backed grouped-window flyout used by taskbar clicks. The variable is
unset in normal operation and does not change production behavior.
The equivalent one-run switch is `--taskbar-diagnostic-flyout=msedge`.
Set `JARVIS_TASKBAR_DIAGNOSTIC_SHOW_DESKTOP_SEQUENCE=1` only for a controlled
native QA run. Once full replacement is ready, the host invokes the same
`WindowTaskbarService` path as the far-right control, waits 500 ms, and invokes
it again. The host log records the hide and restore action plus the affected
window counts. The variable is unset in normal operation.
Set `JARVIS_DIAGNOSTIC_SHELL_PANEL` to `start`, `quick-settings`, `date-time`,
`notifications`, `session`, or `command` to open that desktop panel after
startup for native visual QA. This variable is also unset in normal operation.

`Ctrl+Shift+Q` is registered as a system-wide safety shortcut, so it returns to
Windows even while another normal application is focused. If registration is
unavailable, immersive mode falls back and the in-window shortcut plus Settings
exit action remain available. `Alt+F4` exits only while the JARVIS desktop itself
has focus. Inside the web UI, `Escape` remains reserved for closing the active
dialog.

## Release and installation

Build a clean, self-contained Windows x64 release and installer from the
repository root:

```powershell
.\scripts\publish-release.ps1 -Version 0.1.0
```

The script first downloads or reuses the exact Pi archive pinned by
`third_party/pi/runtime.json`, validates both archive and entry-point hashes,
and stages the full distribution. Only then does it rebuild `frontend/dist`,
publish the native host, create a portable ZIP, write `version.json`,
`RECOVERY.txt`, and `SHA256SUMS.txt`, and compile `installer/JARVIS.iss` when
Inno Setup 6 is available. Output is written under `artifacts/release` and
`artifacts/installer`. For an air-gapped or reproducible release, provide the
already-downloaded official archive explicitly:

```powershell
.\scripts\publish-release.ps1 -Version 0.1.0 `
  -OfflinePiRuntime `
  -PiRuntimeArchivePath .\artifacts\vendor\pi\0.83.0\pi-windows-x64.zip
```

The upstream Pi executable is currently unsigned. JARVIS therefore treats the
repository-pinned version, source commit, asset URL, size, and SHA-256 as its
explicit trust boundary; it never follows an upstream `latest` pointer.

The installer is per-user (`%LOCALAPPDATA%\Programs\JARVIS`), does not require
administrator privileges, and offers optional desktop-shortcut and sign-in
startup tasks. The same sign-in startup registration can be changed later in
JARVIS Settings. It uses only the current-user Run key and always launches the
installed executable with `--startup`.

Each release also writes `artifacts/release/JARVIS-update-manifest.json` with
the version, runtime requirements, package names, sizes, and SHA-256 hashes.
This is the stable metadata contract for a future hosted update channel; V1
remains a deliberate manual-update channel until signing and hosting exist.

JARVIS Settings includes an on-demand release and recovery check. It verifies
Explorer/taskbar recovery, the global safety shortcut, window-hook/integrity/
DWM-readback/aura/recovery state, WebView2, the current-user installer and startup
registrations, and every immutable release file listed in `SHA256SUMS.txt`.
Package hashing runs only when the user requests it and is never part of the
one-second telemetry loop.

To validate the compiled installer without touching an existing JARVIS
installation, run:

```powershell
.\scripts\verify-installer-lifecycle.ps1 -Version 0.1.0
```

The verifier refuses to run when an installation, startup registration, or
JARVIS process already exists. Otherwise it uses an isolated workspace path,
tests current-user installation, repair/reinstall, and uninstall, then confirms
Explorer is still running and removes its test state. Its installed-host check
uses a strict `--lifecycle-probe` mode that creates no `MainWindow`, does not
touch the taskbar or native-window appearance, and writes an authenticated
receipt beneath an isolated data root instead of using production JARVIS logs
or WebView2 state.

## Bridge protocol

JavaScript sends requests through `window.chrome.webview.postMessage`:

```json
{"id":"request-1","method":"system.getSnapshot","params":{}}
```

The host responds with one of:

```json
{"id":"request-1","ok":true,"result":{}}
{"id":"request-1","ok":false,"error":{"code":"INVALID_PARAMS","message":"..."}}
```

It also emits a `system.snapshot` event every second:

```json
{"event":"system.snapshot","data":{}}
```

File copy and move use a non-blocking transfer protocol. The host emits
`explorer.transferChanged` snapshots while scanning and transferring; cancellation
removes JARVIS-created partial destinations. Cross-volume move copies and verifies
the source byte count and file count before source deletion.

The host forwards WebView2's native Escape accelerator to the React document, so
the command dialog can close without terminating the Windows host.

The independent taskbar surface is served from
`index.html?surface=taskbar`. It receives bounded `taskbar.snapshot` events from
the event-driven runtime feed, with one-second polling retained as recovery, and
keeps fixed launchers synchronized with current-desktop top-level Windows
windows.

Supported methods:

- `system.getSnapshot`
- `system.getDetails` (on-demand process, hardware identity, graphics adapter, and drive snapshot)
- `desktop.listEntries`
- `explorer.browse`
- `explorer.createFolder`
- `explorer.rename`
- `explorer.recycle`
- `explorer.preflightTransfer` with paths, destination, and `copy|move`
- `explorer.startTransfer` with an explicit `rename|skip|replace` conflict policy
- `explorer.cancelTransfer` with an opaque job ID
- `explorer.getTransfers`
- `terminal.listProfiles`
- `terminal.create` with an allowlisted `{ "profileId": "powershell|cmd|wsl", "columns": 120, "rows": 32 }`
- `terminal.write` with an opaque host-generated session ID and bounded UTF-8 input
- `terminal.resize` with bounded rows and columns
- `terminal.close`
- `agent.getState`
- `agent.getMessages`
- `agent.prompt` with bounded `{ "message": "...", "clientMessageId": "..." }`
- `agent.abort`
- `agent.newSession`
- `taskbar.getSnapshot`
- `taskbar.toggleWindow` with `{ "windowId": "0x..." }`
- `taskbar.closeWindow` with `{ "windowId": "0x..." }`
- `taskbar.toggleDesktop` with an optional bounded
  `{ "hasVisibleInternalWindow": true|false }` renderer-state hint
- `taskbar.showFlyout` with an anchor position and `windows`, `overflow`, or
  validated task-item `context` mode
- `taskbar.hideFlyout`
- `session.getState`
- `session.prepare` with `{ "actionId": "lock|sign-out|restart|shut-down" }`
- `session.commit` with the prepared `{ "actionId": "...", "token": "..." }`
- `session.cancel`
- `windowAppearance.getState`
- `windowAppearance.setMode` with `{ "mode": "off|conservative|enhanced|immersive" }`
- `shell.listApplications`
- `shell.openApplication` with `{ "applicationId": "..." }`
- `shell.open` with `{ "target": "..." }`
- `lifecycle.showDesktop` with optional `{ "panel": "start" }`; supported
  panels are `start`, `quick-settings`, `date-time`, `notifications`, `session`,
  `command`, `explorer`, `terminal`, and `settings`
- `lifecycle.getRuntimeInfo`
- `lifecycle.setStartupEnabled` with `{ "enabled": true }`
- `lifecycle.runDiagnostics`
- `lifecycle.exitToWindows`

Terminal sessions use the Windows pseudoconsole API introduced in Windows 10
version 1809. The renderer cannot provide executable paths, arguments, or a
working directory. Terminal output and process exit are emitted as
`terminal.output` and `terminal.exited` events; every session is closed when its
tab, renderer, or native host is closed.

Bridge messages are accepted only from the local `https://jarvis.local/` virtual
origin. `shell.open` never accepts command-line arguments, elevation verbs,
arbitrary URI schemes, or arbitrary local paths. Path launches are limited to
non-executable items currently listed by the JARVIS desktop; applications require
an explicit allowlisted capability.
