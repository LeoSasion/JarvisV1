# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Approved JARVIS V1 decisions

- The approved V1 visual target is `design-reference/jarvis-night-shell-v1-approved.png`.
- Preserve the outer border, top bar, bottom taskbar, central composition, glow treatment, and overall styling from the selected third direction.
- Preserve the vertically stacked right-sidebar information architecture from the selected second direction.
- The left side belongs to Windows desktop shortcuts; system telemetry belongs on the right.
- Desktop shortcuts use fixed grid slots: label length must never shift an icon's horizontal or vertical coordinate. Labels wrap inside the tile, clamp to two lines, and end with an ellipsis when they exceed the tile bounds.
- Keep native File Explorer closed in the default desktop state.
- Use flat near-black navy surfaces, angular hairline borders, and layered cold-white / ice-cyan / cobalt emission. Do not introduce dimensional glass, broad neon fog, RGB accents, or uniform monochrome linework.
- Do not use `jarvis-compact-orb-64-v1.png` in the prototype UI; its visual center is offset. Use four position-specific crops from the approved source instead: top brand, top JARVIS-ready status, right core status, and bottom taskbar launcher.
- Reuse the immutable visual assets in the workspace archive; never overwrite them.
- When the user explicitly asks to archive an asset, save the named file directly under the repository's `assets/archive` directory with no new folder or Markdown sidecar.

## Approved Windows runtime decisions

- Target Windows 10 and Windows 11 Home and Pro as the primary supported editions; Enterprise-only features are out of scope.
- Do not depend on Unbranded Boot, Custom Logon, Shell Launcher, Credential Provider replacement, Windows edition spoofing, or patched system DLLs.
- Keep `Explorer.exe`, native Windows sign-in, and recovery paths intact. JARVIS starts after sign-in as a reversible desktop host.
- The first native milestone is a WPF + WebView2 host with a browser-compatible mock adapter, real telemetry, real desktop-entry enumeration, `ShellExecute` launching, and a safe exit back to Windows.
- Desktop folders and the pinned File Explorer entry open the on-demand JARVIS File Explorer by default. Keep `Explorer.exe` available only as an explicit per-folder fallback. JARVIS File Explorer supports bounded create, rename, copy, same-drive move, and Recycle Bin deletion behind explicit confirmation; name conflicts auto-rename, while cross-drive moves and permanent deletion remain disabled.
- Primary-taskbar replacement is now the default native mode. Keep Explorer running; show a separate topmost taskbar surface over the original horizontal primary-taskbar rectangle, arm an out-of-process watchdog, verify the React taskbar is rendered, and only then hide `Shell_TrayWnd`.
- Restore the native primary taskbar on every normal exit, startup/render failure, watchdog failure, and host crash. Never hide secondary taskbars, edit taskbar registry settings, terminate Explorer, or alter the Windows work area in V1.
- `JARVIS_KEEP_NATIVE_TASKBAR=1` is the development and recovery-safe opt-out. If the native taskbar is not on the bottom edge, unavailable, or already hidden, keep it unchanged and skip replacement.
- The replacement taskbar must render all eligible running top-level applications, not only the four pinned launchers. Group windows by process for V1, use the Windows-provided application icon when available, show a window-count badge for grouped windows, and keep activate/minimize state synchronized with the native host.
- Ship Windows releases as clean self-contained `win-x64` packages with a per-user installer. Sign-in startup is optional, stored only in the current-user Run key, points at the currently installed executable with `--startup`, and must be controllable from the JARVIS Settings panel without administrator privileges.
- Keep release and recovery diagnostics on demand rather than in the telemetry loop. The native check must cover Explorer/taskbar recovery, WebView2, current-user install/startup registration, and `SHA256SUMS.txt` package integrity; a portable or development build must remain valid without an installer registration.
- Treat `JARVIS-update-manifest.json` as the future hosted-update metadata contract. Keep V1 on a manual update channel until signed packages and a trusted HTTPS release origin are available.
- Treat the V1 command surface as keyboard-first local quick search across approved applications, running windows, desktop entries, and Windows settings. Do not add a voice button, local speech-to-text pipeline, or a shared voice action router. Future voice control belongs to a separately integrated Codex/Claude-style computer-use agent and bypasses this local search executor.
- Keep local Quick Search inside the JARVIS desktop and replacement taskbar. Do not register a system-wide search shortcut or create an independent hidden search renderer; the global `Ctrl+Shift+Q` recovery shortcut remains the only JARVIS-wide hotkey.
- Installed-application search indexes `.lnk` entries beneath the current-user and common Start Menu Programs roots plus packaged apps exposed by the Windows AppsFolder. Exclude uninstall/removal shortcuts. WebView receives opaque capability IDs; the host must revalidate shortcut roots or activate the host-cached AppUserModelID through `IApplicationActivationManager` with no arguments. Never expose an arbitrary shortcut path, AppUserModelID, or command-line launch method.
- The Start panel reuses the lazy cached application catalog: keep the stable pinned grid, expose a scroll-bounded grouped All Apps view, search installed apps and running windows locally, and store only the most recent opaque application capability IDs in versioned local storage after a successful launch.
- Start-panel pins and JARVIS taskbar pins share one versioned JARVIS registry. Persist only validated built-in IDs or opaque installed-application capability IDs, migrate the previous four-item order once, and resolve every entry against the current built-in/catalog allowlist before launch. This registry does not read or modify Windows native taskbar pins.
- Associate installed pins with live windows by normalized Shell Link target process names or the host-generated opaque packaged-application capability. Keep raw shortcut paths and AppUserModelIDs host-only, and consume matched windows so a running pinned app never appears again as a separate dynamic taskbar item.
- Refresh taskbar windows from out-of-context WinEvent hooks with short event coalescing, while retaining the one-second polling path as a recovery fallback. Event-only refreshes must not resample system telemetry or resend unchanged taskbar snapshots. Preserve first-seen ordering for unpinned running groups so foreground Z-order changes never make taskbar icons jump.
- In healthy full-taskbar mode, Alt+Tab and Alt+Shift+Tab use the bounded JARVIS HUD window switcher. Install its low-level keyboard hook on a dedicated message-loop thread, keep the callback free of enumeration/WebView/disk/synchronous UI work, and intercept only after the independent renderer is ready. Native/hybrid/safe modes, Ctrl+Alt+Tab, injected input, Win+Tab, secure desktop, and any failed first selection remain on the native Windows path.
- Match Windows taskbar input conventions where the safe launcher contract allows it: left click toggles the selected window, middle click or Shift+click launches another instance of a pinned item, and right click uses the native above-taskbar flyout for open/new-instance, close-group, and unpin actions. Never synthesize a launch target for an unpinned running process; context commands must resolve against the current renderer item before execution.
- The built-in Terminal launcher opens the JARVIS Terminal Workbench rather than `wt.exe`. Its renderer is lazy-loaded, while the native host owns allowlisted ConPTY sessions for PowerShell, CMD, and WSL; the renderer must never supply an executable path or command-line arguments.
- Visual themes are controlled token sets with separate core, edge, halo, and bloom emission layers. Do not restore arbitrary CSS injection. UI audio is synthesized locally, disabled by default, and user-controlled from Settings.
- Detailed process, hardware identity, graphics-adapter, and drive inspection is on demand. Never move those queries into the one-second telemetry loop. Temperature, fan, and voltage sensors remain visibly unavailable until a hardware provider and its license/runtime behavior are separately audited.
- The post-login boot sequence must reflect real runtime, telemetry, window-channel, and ConPTY checks. It remains skippable and must never imply replacement of Windows secure boot or sign-in screens.
