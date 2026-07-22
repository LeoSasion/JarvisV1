# JarvisV1

JarvisV1 is an experimental HUD-style desktop shell for Windows 10 and Windows 11. It combines a native C#/WPF host with a React/WebView2 interface to provide a replacement taskbar, desktop command surface, system telemetry, native window styling, file tools, and an integrated ConPTY terminal.

![JARVIS Night Shell](frontend/design-reference/jarvis-night-shell-v1-approved.png)

## Current scope

- Windows 10 and Windows 11 Home/Pro desktop environments
- Native taskbar overlay with running-window synchronization and recovery watchdog
- Keyboard-first application search and launcher
- Windows-native system telemetry and on-demand process/hardware inspection
- Integrated PowerShell, Command Prompt, and WSL sessions through ConPTY
- Configurable conservative, enhanced, and experimental immersive window styling
- Layered low-glare HUD themes and optional local interaction sounds
- Per-user installer and startup registration

JarvisV1 is under active development. The experimental immersive mode can alter the appearance of eligible application windows, but it does not replace the Windows sign-in or secure desktop. `Ctrl+Shift+Q` is the global recovery shortcut for returning to the native Windows shell.

## Architecture

- `frontend/` — React and Vite interface rendered by WebView2
- `host/` — .NET 8 WPF host, Windows bridge, taskbar and recovery services
- `installer/` — Inno Setup definition for per-user installation
- `scripts/` — release and native lifecycle verification scripts
- `assets/archive/` — approved source visual assets retained for restoration

The WebView renderer receives bounded capabilities rather than executable paths or arbitrary command lines. Windows integration and safety-sensitive operations remain in the native host.

## Development

Requirements:

- Windows 10 version 1809 or later, or Windows 11
- Node.js and npm
- .NET 8 SDK
- Microsoft Edge WebView2 Runtime

Build the frontend:

```powershell
cd .\frontend
npm ci
npm run build
```

Build and run the native host from the repository root:

```powershell
dotnet restore .\host\Jarvis.Host.sln
dotnet build .\host\Jarvis.Host.sln -c Debug
dotnet run --project .\host\Jarvis.Host\Jarvis.Host.csproj
```

Set `JARVIS_KEEP_NATIVE_TASKBAR=1` before launch to keep the Windows taskbar visible while developing or recovering. More native-host and release details are documented in [`host/README.md`](host/README.md).

## License

JarvisV1 is licensed under [GPL-3.0-only](LICENSE). Third-party components and reference notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
