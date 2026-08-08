# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

JARVIS primarily serves Windows geeks, developers, and other code-centered
workers who spend much of the day moving among applications, terminals, files,
system controls, and AI agents. They want a compact, keyboard-efficient working
environment that reduces shell friction without hiding the underlying Windows
ecosystem or its recovery paths.

The product is not currently optimized for a general consumer audience. Its
first users are technically confident people who can understand the difference
between the safe application layer and future advanced system integration.

## Product Purpose

JARVIS is a post-sign-in Windows desktop system that brings desktop shortcuts,
taskbar and window control, local search, file workflows, terminals, system
state, a local knowledge graph, and agent conversations into one coherent work
surface.

The product succeeds when a code worker can remain in a focused JARVIS workspace
for normal daily tasks, move between local context and an agent with less
friction, and return safely to the native Windows shell whenever necessary.

## Positioning

JARVIS is more than a desktop theme or a single-agent chat wrapper. Its durable
direction is a provider-neutral Windows work layer with two operating modes:

1. **Safe application layer** — the default, reversible mode. JARVIS runs after
   normal Windows sign-in, owns selected desktop surfaces out of process, keeps
   Explorer and Windows recovery paths available, and exits cleanly back to the
   native shell.
2. **Deep mode** — a future, explicitly selected advanced mode intended to
   integrate more directly with native Windows processes. It may eventually use
   process injection, native-process replacement, or modified Windows DLLs, but
   none of those mechanisms are current product capabilities or commitments.

Agent integration is intentionally replaceable. Pi Agent is the current
recommended test provider, not the permanent product identity; future adapters
are expected to support providers such as OpenClaw, Claude, Codex, and Hermes.

## Operating Context

- The primary environment is an x64 Windows 10 or Windows 11 Home/Pro desktop.
- JARVIS is used after normal Windows sign-in during sustained coding and
  technical work sessions.
- Typical work crosses native Windows applications, running windows, desktop
  entries, repositories, folders, terminals, system settings, and external AI
  agent providers.
- The current implementation is a .NET 8 WPF host with a React interface in
  WebView2. Windows-sensitive actions remain in the native host and the renderer
  receives bounded capabilities.
- Windows secure desktop, UAC secure prompts, and sign-in remain native Windows
  surfaces in the safe application layer.
- The repository is publicly distributed under GPL-3.0-only.

## Capabilities and Constraints

Current product capabilities include a reversible Windows desktop host,
replacement taskbar, window switching and synchronization, desktop entries,
local Quick Search, guarded session controls, system telemetry, file tools, an
integrated ConPTY terminal, a local knowledge-graph workspace, and an embedded
chat surface backed by a bounded agent adapter.

Durable constraints and current boundaries:

- Windows 10 and Windows 11 Home/Pro are the supported product family;
  Enterprise-only shell features are not a dependency.
- The safe application layer remains the default and must retain a reliable exit
  to Windows, native taskbar recovery, and failure-safe behavior.
- Windows DLLs are not modified while the overall product and interaction
  design are still being completed.
- Deep mode is future work. Its exact injection, replacement, DLL modification,
  signing, compatibility, rollback, and recovery contracts remain undecided and
  must be designed and audited separately before implementation.
- Explorer, Windows sign-in, secure desktop, and recovery paths stay intact in
  the current safe application layer.
- Agent integration must use a provider-neutral adapter boundary. Pi is a
  recommended test integration; OpenClaw, Claude, Codex, Hermes, and additional
  providers must be able to participate through future adapters without
  redefining the desktop shell.
- JARVIS does not currently need its own cloud account or cross-device sync.
  Network access required by a user-selected external agent is separate from a
  JARVIS account system.
- Voice is not executed by the local search/action pipeline. Any future voice
  control belongs to an independently integrated computer-use agent.
- Renderer code must not receive arbitrary executable paths, commands, or other
  unbounded native authority.

## Brand Commitments

The product name is **JARVIS**, with **JarvisV1** as the current repository and
release identity. The interface must remain intentionally minimal for geeks and
code workers: functional state and working context take precedence over
decorative dashboard density. Agent providers are integrations, not part of the
JARVIS brand identity.

## Evidence on Hand

- The working product implementation and documented capability inventory are in
  `frontend/`, `host/`, `installer/`, and `README.md`.
- Existing approved design decisions are recorded in `frontend/AGENTS.md`.
- Restorable visual source material is retained under `assets/archive/`.
- Native-host safety, recovery, and release procedures are documented in
  `host/README.md` and `scripts/`.
- There is no established evidence yet for broad consumer adoption, certified
  security of a future deep mode, or a JARVIS-owned cloud account service; future
  work must not imply those claims.

## Product Principles

1. **Protect the working machine.** The safe application layer is reversible,
   recovery-aware, and truthful about what JARVIS does not control.
2. **Optimize for code work.** Reduce transitions among files, terminals,
   windows, system state, knowledge, and agents instead of adding ornamental
   surfaces.
3. **Keep agent choice open.** Treat every agent as a replaceable provider behind
   an explicit, bounded integration contract.
4. **Earn deeper control.** Advanced Windows modification belongs in a separately
   enabled deep mode with explicit compatibility, rollback, and recovery design.
5. **Stay useful without a JARVIS account.** Core shell and local workflows must
   not depend on proprietary cloud identity or synchronization.

## Accessibility & Inclusion

Core desktop workflows must remain keyboard-operable, focus state must remain
visible, and motion-dependent interactions must provide a reduced-motion path.
The global recovery action must remain available even when another ordinary
application has focus.
