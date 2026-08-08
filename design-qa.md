# JARVIS Black / White / Orange Shell Design QA

## Comparison target

- Single Explorer source: `C:\Users\Administrator\Documents\JARVIS\assets\archive\jarvis-orange-explorer-single-v1.png`
- Single Explorer implementation: `C:\Users\Administrator\Documents\JARVIS\.design-qa\explorer-single-final.png`
- Single full-view comparison: `C:\Users\Administrator\Documents\JARVIS\.design-qa\comparison-single.png`
- Explorer + Pi Agent source: `C:\Users\Administrator\Documents\JARVIS\assets\archive\jarvis-orange-explorer-pi-agent-linked-v1.png`
- Explorer + Pi Agent completed interaction: `C:\Users\Administrator\Documents\JARVIS\.design-qa\linked-flow-complete-v3.png`
- Linked full-view comparison: `C:\Users\Administrator\Documents\JARVIS\.design-qa\comparison-linked-flow-v3.png`
- Latest relation processing implementation: `C:\Users\Administrator\Documents\JARVIS\.design-qa\linked-relation-running-v4.png`
- Latest relation full-view comparison: `C:\Users\Administrator\Documents\JARVIS\.design-qa\comparison-linked-relation-v4.png`
- Latest relation focused comparison: `C:\Users\Administrator\Documents\JARVIS\.design-qa\comparison-linked-relation-focus-v4.png`
- Compact-rail implementation: `C:\Users\Administrator\Documents\JARVIS\.design-qa\compact-rails-explorer-v7.png`
- Compact-rail full-view comparison: `C:\Users\Administrator\Documents\JARVIS\.design-qa\comparison-compact-rails-v7.png`
- Compact-rail focused comparison: `C:\Users\Administrator\Documents\JARVIS\.design-qa\comparison-compact-rails-focus-v7.png`
- Borderless maximized implementation: `C:\Users\Administrator\Documents\JARVIS\.design-qa\maximized-borderless-v8.png`
- Borderless maximized comparison: `C:\Users\Administrator\Documents\JARVIS\.design-qa\comparison-maximized-borderless-v8.png`
- Edge-aligned docked Explorer implementation: `C:\Users\Administrator\Documents\JARVIS\.design-qa\docked-explorer-edge-alignment-v9-1672x941.png`
- Edge-aligned maximized Terminal implementation: `C:\Users\Administrator\Documents\JARVIS\.design-qa\maximized-terminal-edge-alignment-v9-1672x941.png`
- Edge-alignment full-view comparison: `C:\Users\Administrator\Documents\JARVIS\.design-qa\comparison-maximized-edge-alignment-v9.png`
- Compact-height docked Explorer implementation: `C:\Users\Administrator\Documents\JARVIS\.design-qa\docked-explorer-edge-alignment-v9-1280x720.png`
- Annotated Terminal cap-line source: `C:\Users\ADMINI~1\AppData\Local\Temp\codex-clipboard-a4be6b0f-04fc-4a5d-b493-29d11498c52b.png`
- Terminal cap-line removal implementation: `C:\Users\Administrator\Documents\JARVIS\.design-qa\terminal-no-cap-lines-v10-1514x854.png`
- Terminal cap-line full-view comparison: `C:\Users\Administrator\Documents\JARVIS\.design-qa\comparison-terminal-cap-lines-v10.png`
- Source and implementation pixels: `1672 × 941` for both states.
- CSS viewport: `1672 × 941`; density normalization: 1:1, no browser frame and no scale mismatch.
- States: Explorer focus; explicit context staging; Pi Agent processing; completed result return; live system rail.

## Findings

- No remaining P0, P1, or P2 mismatch blocks this pass.
- The implementation preserves the source hierarchy and palette while using the real Explorer model, current host state, and current Pi safety boundary instead of fictional file/task data.
- The linked source depicts an active file-summary exchange. The implementation now reproduces the causal interaction pattern with an explicit `ASK AGENT` action, a frozen metadata reference, processing state, a route to the latest matching conversation node, streamed response, and an inline result-reuse action.
- Intentional safety deviation: the reference implies that Pi has read the selected file. The current host has no audited read-only file-context capability, so the implementation shares immutable metadata only and says so in the interface and prompt. It does not falsely claim to inspect file contents.

## Required fidelity surfaces

- Fonts and typography: compact monospaced data text, condensed display labels, strong warm-white headings, restrained uppercase tracking, truncation, and small-value hierarchy remain readable at all tested widths.
- Spacing and layout rhythm: the single state keeps the dominant Explorer plus Inspector composition. The linked state keeps the reference's approximately `53 / 32 / 15` Explorer, Agent, and System split. Square corners, one-pixel dividers, narrow toolbars, and a flat taskbar replace the former glass/card treatment.
- Colors and tokens: the rendered shell is materially black with warm-white information and orange reserved for active, selected, connected, and actionable signals. Disabled and inactive controls remain neutral; no cyan application chrome remains.
- Image quality and asset fidelity: both target states are primarily line-interface compositions. Fluent line icons and native Windows application icons preserve recognizable identity; no bitmap HUD background, decorative glow texture, emoji, or placeholder illustration was introduced.
- Copy and content: shell labels, Explorer file metadata, provider connection state, notifications, and task counts are derived from working models. Fictional storage/status values in the concept were not copied into the product.
- Icons and controls: toolbar, navigation, taskbar, window controls, focus states, selected rows, disabled commands, and centered Pi Agent gate share one thin-stroke family and consistent orange activation language.
- Accessibility and motion: semantic buttons and labels, keyboard focus, disabled maximize behavior in docked layouts, `hidden`/`inert` suppression for non-active compact panes, reduced-motion fallback, contrast, and page-visibility animation pause were retained.
- Responsiveness: the linked workspace was checked at `1366`, `1100`, and `860` CSS-pixel widths. It transitions from three-pane to two-pane/drawer to one active pane without horizontal clipping. Independent taskbar and window-switcher surfaces were also checked.

## Comparison history

### Iteration 1

- Earlier P2: linked panes depended on legacy media rules, causing compact widths to expose conflicting geometry and the desktop-only notice to block the `860` state.
- Fix: introduced explicit workspace layout modes, responsive variants, docked window geometry, live inset variables, and inactive-pane suppression.
- Post-fix evidence: `explorer-agent-1366.png`, `explorer-agent-1100-v2.png`, and `explorer-agent-860-v4.png` show stable three-pane, drawer, and single-pane states.

### Iteration 2

- Earlier P2: settings, flyouts, switcher, inspector, terminal chrome, and system panels still leaked legacy cyan or glass surfaces.
- Fix: consolidated black/warm-white/orange tokens and hardened every shell-owned surface, while keeping ANSI terminal colors inside terminal content.
- Post-fix evidence: `settings-orange-v2.png`, `taskbar-flyout-orange.png`, `window-switcher-orange.png`, `system-inspector-orange.png`, and `terminal-orange.png` show one coherent visual language.

### Iteration 3

- Earlier P1: taskbar preview cards exposed blank mock rectangles and app/notification badges still used the retired blue accent.
- Fix: preview cards now carry the real application icon and window label; all shell-owned badges use square orange-on-black status styling with no cyan glow.
- Earlier P2: switcher and Inspector operational labels were undersized, odd-width linked panes could overrun by one pixel, and a live drag/resize gesture could survive a layout-mode change.
- Fix: raised the affected microtype to the readable shell baseline, derived the Agent width from the exact remaining workspace width, and cancel active gestures whenever docked geometry or the viewport changes.
- Post-fix evidence: `explorer-agent-final-v2.png`, `comparison-linked-v2.png`, `window-switcher-final-v2.png`, `system-inspector-final-v2.png`, and `desktop-badges-final.png` confirm the corrected hierarchy and status language.
- Evidence limitation: the selected in-app browser surface does not expose a pointer-hover primitive, so the native taskbar thumbnail hover was not captured. Its real-icon/label rendering and hover eligibility remain covered by the component implementation and regression suite.

### Iteration 4 — explicit Explorer / Pi interaction

- Earlier P1: Explorer and Pi Agent were merely adjacent panes; selection did not create a truthful, visible causal relationship and the interface depended on rigid gray frames.
- Fix: selection remains local until the user explicitly chooses `ASK AGENT`. That action snapshots up to five case-insensitively deduplicated metadata references, freezes the source marker, stages the Agent context, and then exposes a safe editable directive.
- Fix: a single non-interactive SVG route layer connects source to context and completed result to the next-directive composer. Routes are orthogonal and deterministic; only the active processing packet moves. There is no idle animation loop.
- Fix: the Agent pane is now an open vertical event timeline. Full borders remain only around the context payload, result payload, and composer; repeated pane, system-section, row, and title-control boxes were reduced to seams and short ledger marks.
- Earlier P2: the running composer could show a misleading runtime-repair placeholder, the browser simulator echoed its internal metadata envelope, and the compact transcript scrollbar retained cyan.
- Fix: each was corrected with phase-aware copy, directive-only mock excerpts, and a neutral structural scrollbar.
- Interaction evidence: `linked-flow-staged-v3.png`, `linked-flow-running-v3.png`, and `linked-flow-complete-v3.png` capture the complete causal sequence at `1672 × 941`.
- Responsive evidence: `linked-flow-compact-1100-v3.png` and `linked-flow-narrow-860-v3.png` confirm route suppression and usable two-pane/drawer and one-pane states without clipping.

### Iteration 5 — latest related message and scroll-locked route

- Earlier P1: the route ended on permanent context/result blocks rather than the latest real message belonging to the file relation. A completed context also wrapped every later send, so ordinary chat was incorrectly treated as file-related.
- Fix: every explicit `ASK AGENT`/`RELINK AGENT` creates a fresh relation identity and arms exactly one send. The accepted `clientMessageId` and host `runId` now survive normalization; only the newest matching user or Assistant article receives the sole route target. Later ordinary messages remain plain and cannot steal that marker.
- Earlier P2: the result-to-composer route used four orthogonal segments, while the reference uses a strict three-segment `H → V → H` connector.
- Fix: there is now one causal Explorer-to-message route, generated by a tested pure three-segment geometry model. No line appears before an accepted relation message exists, and completion no longer auto-connects a decorative result box to the composer.
- Earlier P2: scroll measurements passed through React state, observers were rebound during every geometry read, and offscreen anchors could leave a line crossing fixed chrome.
- Fix: nested scroll, resize, mutation, and a bounded layout-transition burst are coalesced into animation frames that write the SVG path and terminals directly. Geometry itself does not tween. The moving packet references the stable path with `mpath`, and the route hides when either endpoint center leaves its owning scroll viewport.
- Post-fix visual evidence: `linked-relation-running-v4.png` shows the source row connected directly to the active Assistant timeline node; `linked-relation-complete-v4.png` shows the completed response with its inline reuse action and no second result box; `linked-relation-unrelated-v4.png` shows later ordinary turns left unconnected while the original relation remains the sole marked node.
- Post-fix quantitative evidence: four transcript scroll samples retained terminal error `x = 0 px`, `y = 0.04 px`; three Explorer scroll samples retained `x = 0 px`, `y = 0 px`. Scrolling the related message fully outside its transcript set route visibility to `false` without changing the single relation target.
- Full and focused comparison evidence: `comparison-linked-relation-v4.png` and `comparison-linked-relation-focus-v4.png` confirm the reference's sparse orange three-segment connector, direct causal target, open timeline, and absence of extra gray result framing.
- Compact console evidence: a fresh `860 × 760` linked single-pane run suppressed the inaccessible Explorer pane with a boolean `inert` attribute and produced zero console warnings or errors.

### Iteration 6 — compact global rails and hairline outlines

- Earlier P2: the `62px` top rail and `80px` taskbar consumed more vertical space than the selected Explorer reference, while two-pixel activation bars made the chrome feel heavier than the surrounding one-pixel ledger system.
- Fix: the standard desktop rails now measure `48px` and `56px`; the `720px`-high boundary uses a `52px` taskbar. High-DPI structural outlines use a `0.5 CSS px` hairline token, while orange activation and selection markers use one CSS pixel.
- Earlier P2 after the first CSS-only pass: managed windows retained the old `78px / 86px` viewport insets, leaving excess black space above and below the expanded work area.
- Superseded by Iteration 8: the first pass used `64px / 62px` top and bottom insets, which still preserved a `16px / 6px` gutter and therefore did not constitute true maximization.
- Post-fix evidence: `compact-rails-explorer-v7.png` renders at `1672 × 941` with top rail `48px`, taskbar `56px`, Explorer bounds `x=12, y=64, w=1648, h=815`, no viewport overflow, and zero console warnings or errors.
- Boundary evidence: `1280 × 720` rendered the `48px / 52px` compact pair without overflow; clicking the pinned Explorer button opened the dialog and changed its taskbar label to `File Explorer, active, 1 open window`.
- Full and focused comparison evidence: `comparison-compact-rails-v7.png` and `comparison-compact-rails-focus-v7.png` confirm a visibly lighter top/bottom frame while preserving the reference hierarchy, taskbar centering, icon sharpness, and orange-only active state.

### Iteration 7 — borderless maximized windows

- Earlier P2: a maximized managed window retained its one-pixel perimeter. Near the persistent top rail and taskbar this read as a second frame, making the compact shell denser than the selected reference.
- Fix: maximized Explorer, Terminal, Inspector, and Agent surfaces now remove only their outer border and shadow. The single-Explorer docked state follows the same rule. Internal titlebars, toolbars, tabs, list rows, seams, selection markers, focus rings, and status dividers remain unchanged.
- State evidence: the Terminal outer surface measured `1px` on all four sides when restored, `0px` on all four sides when maximized, and returned to `1px` after Restore. Its internal titlebar divider remained `1px` while maximized.
- Docked evidence: the single-Explorer focus surface measured `0px` on all four outer sides with no shadow, preventing a duplicate perimeter in its maximized-style product state.
- Visual evidence: `maximized-borderless-v8.png` and `comparison-maximized-borderless-v8.png` show one global shell frame with the maximized Terminal content defined by internal ledger lines rather than a second enclosing rectangle. Console warnings and errors remained empty.

### Iteration 8 — true edge-aligned maximization

- Earlier P1: removing the outer window border did not change the managed-window rectangle. Maximized and docked windows still used the legacy floating-window viewport (`12px` horizontal, `16px` below the top rail, and `6px` above the taskbar), so the result looked like shortened horizontal rules inside an unchanged empty frame.
- Fix: the window manager now reads the live `--top-height` and `--taskbar-height` CSS tokens and uses zero horizontal inset. Maximized, single-Explorer docked, and Explorer/Pi docked geometry therefore shares the exact usable work area between the persistent rails. Floating windows retain their centered default dimensions and restore bounds.
- Standard viewport evidence: at `1672 × 941`, the maximized Terminal measured `x=0`, `y=48`, `width=1672`, `height=837`, ending exactly at taskbar `y=885`. All four computed gaps were `0px`; its outer borders and shadow stayed removed while the internal titlebar divider remained `1px`.
- Docked Explorer evidence: at the same viewport, Explorer measured the same edge-aligned work area with all four gaps at `0px` and no outer border or shadow.
- Compact media evidence: at `1280 × 720`, the live taskbar token changed to `52px`; Explorer automatically reflowed to `x=0`, `y=48`, `width=1280`, `height=620`, ending exactly at taskbar `y=668` with no hard-coded mismatch.
- Full comparison evidence: `comparison-maximized-edge-alignment-v9.png` confirms that the implementation now follows the source's continuous rail-to-content composition instead of floating inside a second black margin. Console warnings and errors remained empty.

### Iteration 9 — remove residual Terminal perimeter caps

- Earlier P2: the legacy Terminal surface still drew two isolated one-pixel pseudo-element strokes: a `168px` top-left cap and a `92px` bottom-right cap. Once the real outer border was removed and the window touched both rails, these read as unexplained white dashes rather than semantic structure.
- Fix: both Terminal perimeter pseudo-elements now resolve to `content: none` and `display: none` in every window state. Continuous titlebar, tabbar, statusbar, top-rail, and taskbar dividers remain intact.
- Computed-style evidence: in the maximized state, both `::before` and `::after` report `content: none` and `display: none`; the Terminal remains maximized and all functional dividers are still visible.
- Visual evidence: the user-annotated `1513 × 855` source was normalized to the `1514 × 854` CSS capture for comparison. `comparison-terminal-cap-lines-v10.png` confirms that only the two marked dashes disappeared; layout, typography, controls, orange state markers, and continuous rail boundaries did not move. Console warnings and errors remained empty.

### Iteration 10 — Pi Agent replaces taskbar Search

- Earlier P1: Pi Agent used `left: 50%` absolute positioning plus a dedicated center reserve. It could cover running applications and reduced the real application strip even when the center looked visually empty.
- Fix: the Pi launcher now occupies the normal second grid cell immediately after Start, replacing the former taskbar Search control. The center overlay and spacer node were removed; the application strip receives every remaining pixel before the system tray.
- Wide-layout evidence: at `1672 × 941`, Start ends and Pi begins at `x=72`; Pi ends and applications begin at `x=280`; applications continue for `1101px` to the system tray at `x=1381`. Pi reports `position: relative` and `transform: none`.
- Compact evidence: at `1280 × 720`, Pi occupies `x=72–238.39`, applications occupy `x=238.39–989`, and the overflow control contains the two programs beyond visible capacity. No taskbar regions overlap.
- Interaction evidence: clicking the taskbar Pi launcher opened the Agent dialog and changed the same button to `is-running is-active` without moving any taskbar region. `taskbar-pi-replaces-search-v11-1672x941.png` and `taskbar-pi-replaces-search-v11-1280x720.png` record the two states; the console contained only Vite and React development messages, with no warning or error.

### Final comparison

- The combined single-state image confirms the same top command rail, dominant Explorer, right Inspector, and bottom taskbar hierarchy. Real data creates a denser toolbar, but not a structural mismatch.
- The latest combined linked-state image confirms the intended three-column relationship, one sparse orange source-to-message route, open Agent timeline, right system rail, and taskbar continuity.
- The compact-rail comparison confirms the requested thinner silhouette: the bars approach the selected reference density without clipping two-line Agent status, system indicators, Explorer commands, or taskbar application states.
- The maximized-window comparison confirms that the outer window rectangle no longer competes with the persistent rails; restored floating windows still retain their perimeter and spatial affordance.
- The edge-alignment comparison confirms that maximized and docked content begins immediately below the `48px` top rail, ends immediately above the live `56px`/`52px` taskbar, and reaches both side edges without a residual floating-window gutter.
- The Terminal cap-line comparison confirms that the two isolated legacy perimeter dashes are absent while all continuous structural separators and semantic orange indicators remain unchanged.
- The taskbar comparison confirms that Pi now replaces Search beside Start, while running applications own the formerly reserved center width and fall back to the existing overflow control at compact widths.
- Focused regions were not required after the full-size combined images were opened at original resolution: typography, icons, one-pixel dividers, disabled states, selection bars, and taskbar markers are legible at 1:1.

## Interaction and runtime checks

- Primary interaction replayed in browser: taskbar Explorer launch → select `界面设计规范.md` → `ASK AGENT` → staged context → submit → processing/stream → response ready → inline `USE IN DIRECTIVE` action.
- Latest relation replay: the same linked turn was followed by six ordinary questions; all remained unlinked, the original Assistant response remained the only relation target, and the composer returned to the plain `DIRECTIVE` state after the one-shot send.
- Scroll replay: the Explorer origin and Agent target were independently moved through multiple visible scroll positions, then the Agent target was moved fully offscreen to verify route suppression.
- Additional interactions: Explorer open/close and navigation, Pi Agent open/close, linked layout activation, taskbar launch/focus state, start/search panel, quick settings, date/time, notifications, session control, terminal, settings, system inspector, taskbar flyout, and window switcher.
- Edge-alignment interaction replay: launch Terminal from the taskbar → maximize → inspect live rail/window rectangles → close → launch single Explorer → resize from `1672 × 941` to `1280 × 720` → confirm token-driven reflow.
- Cap-line interaction replay: launch Terminal from its pinned taskbar item → maximize → inspect `::before` and `::after` computed styles → confirm both decorations are non-rendering with no console warning or error.
- Taskbar Pi replay: inspect Start/Pi/apps/tray boundaries at `1672 × 941` → open Pi from the taskbar → resize to `1280 × 720` → confirm stable grid order, active state, and bounded application overflow.
- Browser console: no application warnings or errors after the completed linked flow.
- Automated boundaries: immutable context normalization, Windows-path deduplication, phase transitions, prompt safety, layout variants, exact breakpoints, suppressed-pane state, session model, taskbar geometry, and existing interface behavior are covered by the frontend suite.

## Follow-up polish

- P3: run a later native WebView2 pass at Windows `125%` and `150%` display scaling; browser QA does not prove native DPI behavior.
- P3: repeat the same interaction with a real provider once native Pi credentials are available; the present evidence uses the explicit browser-preview simulator and labels it as such.

## Implementation checklist

- [x] Apply the black / warm-white / orange system to all shell-owned surfaces.
- [x] Implement separate Explorer-focus and Explorer + Pi Agent linked states.
- [x] Make linked panes responsive and suppress inaccessible inactive panes.
- [x] Place Pi Agent in the Windows Search slot beside Start, keep it in normal grid flow, and let applications own all remaining width before the system tray.
- [x] Preserve real Windows icons, data, commands, and permission boundaries.
- [x] Compare both source and implementation states in combined 1:1 images.
- [x] Implement explicit source → accepted relation message → processing → reusable response interaction states.
- [x] Remove non-semantic frame stacking and preserve reduced-motion and compact-layout fallbacks.
- [x] Limit every relation to one explicit send and one latest matching conversation target.
- [x] Keep every connector to exactly three orthogonal segments and lock both terminals to nested scrolling without geometry lag.
- [x] Reduce the standard top/taskbar rails to `48px / 56px`, synchronize managed-window insets, and converge all two-pixel active outlines to one-pixel accents.
- [x] Remove the outer border and shadow only in maximized or single-Explorer docked states, while restoring the normal floating-window outline on Restore.
- [x] Make maximized and docked window geometry touch the exact inner edges of the live top rail and taskbar at standard and compact heights.
- [x] Remove the Terminal's isolated top-left and bottom-right perimeter cap decorations without changing real structural dividers.

final result: passed
