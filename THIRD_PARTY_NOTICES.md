# Third-party notices

JARVIS is distributed under the GNU General Public License version 3.0 only.

## eDEX-UI

- Project: eDEX-UI
- Copyright: GitSquared and eDEX-UI contributors
- Source: https://github.com/GitSquared/edex-ui
- Reference revision: `04a00c4079908788b371c6ecdefff96d0d9950f8`
- License: GNU General Public License version 3.0
- Use in JARVIS: interaction and information-architecture reference for terminal tabs, startup sequencing, theme switching, system-process views, and UI sound-event categories. The Windows terminal backend and React components in JARVIS are new implementations for WPF, WebView2, and ConPTY; no eDEX-UI media assets are included.

The original license is available at https://github.com/GitSquared/edex-ui/blob/master/LICENSE.

## Microsoft Fluent UI System Icons

- Package: `@fluentui/react-icons`
- Source: https://github.com/microsoft/fluentui-system-icons
- License: MIT

## Pi coding agent

- Project: Pi coding agent
- Package: `@earendil-works/pi-coding-agent`
- Copyright: Copyright (c) 2025 Mario Zechner
- Source: https://github.com/earendil-works/pi
- Pinned release: `v0.83.0`
- Pinned commit: `845d6ff1f6643aba440341cce877ce1c43ebbc39`
- License: MIT
- Use in JARVIS: separately executed, privately bundled JSONL RPC runtime for the embedded chat surface. JARVIS V1 disables Pi tools, extensions, skills, prompt templates, project context, themes, approvals, and Pi-managed sessions.

Release packages retain the complete upstream Windows x64 distribution together
with `AgentRuntime/LICENSE-Pi.txt`, `AgentRuntime/runtime.json`, and provenance.
The official upstream release provides SHA-256 checksums but no Authenticode or
detached release signature. JARVIS pins the exact archive and entry point,
derives a deterministic receipt for all 217 upstream files, verifies that full
runtime tree before launch, and does not silently update the runtime.

The original license is available at https://github.com/earendil-works/pi/blob/v0.83.0/LICENSE.

## Microsoft WebView2

- Package: `Microsoft.Web.WebView2`
- Source: https://www.nuget.org/packages/Microsoft.Web.WebView2
- License: Microsoft software license terms; see the package and installed runtime terms.

## xterm.js

- Packages: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-search`, `@xterm/addon-webgl`
- Source: https://github.com/xtermjs/xterm.js
- License: MIT
- Use in JARVIS: terminal rendering, fit, search, and optional WebGL acceleration. Windows process hosting is implemented by JARVIS through ConPTY.

## React and Vite

- React: https://github.com/facebook/react — MIT
- Vite: https://github.com/vitejs/vite — MIT

Dependency packages may include their own notices. Release packaging must retain the license files shipped by those packages.
