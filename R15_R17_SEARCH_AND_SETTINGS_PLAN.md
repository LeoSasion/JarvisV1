# JARVIS V1 R15-R17 Search and Settings Plan

Status: `REVIEWED · FRONTEND ACCEPTANCE PASSED`

Baseline: `main @ 50c6a72`

Primary environment: Windows 11 browser-compatible frontend preview

## Product evidence

The current desktop, local Quick Search, standalone global Quick Search, and
Settings flow were inspected at `1280x720`.

- The visual hierarchy and HUD language are coherent enough to preserve.
- Empty-query Quick Search still uses a fixed priority list even though JARVIS
  already records recently opened installed applications.
- Keyboard selection changes visually but does not explicitly keep an
  off-screen active result in view.
- Search results are readable, but the typed query is not highlighted and the
  input does not expose the complete ARIA combobox contract.
- Settings is a single long scrolling surface with no section-level navigation.

## R15 - Behavior-aware Quick Access

- Feed the existing bounded recent-application registry into the shared Quick
  Search index.
- Rank recent installed applications ahead of static defaults only while the
  query is empty.
- Preserve explicit-query scoring and opaque application capabilities.
- Cover recency ranking and malformed recent IDs with pure-function tests.

## R16 - Search clarity and keyboard continuity

- Highlight direct query matches without changing result labels or capability
  routing.
- Expose the input as an expanded list-autocomplete combobox.
- Announce result-count/indexing state through one bounded live region.
- Keep the selected option in view while Arrow, Home, and End navigation remain
  focused on the input.
- Cover highlight segmentation and normalized search behavior with unit tests.

## R17 - Settings section navigation

- Add a compact sticky section navigator beneath the existing sticky Settings
  header.
- Link General, Taskbar, Windows, Interface, Integration, and Recovery without
  hiding any section or changing current settings behavior.
- Keep the navigator keyboard accessible and horizontally scrollable at narrow
  widths.
- Preserve the current flat dark HUD language; do not introduce glass, cards,
  or a second visual system.

## Validation boundary

- Run frontend lint, format validation, unit tests, and browser visual checks.
- Do not build or launch the native EXE without separate user authorization.
- Preserve and exclude all user changes under `assets/archive`.
- After R17, review the combined diff and push one atomic commit directly to
  `main`.

## Result

- R15 connected the existing bounded recent-application registry to shared
  empty-query Quick Access ranking. Explicit queries retain their original
  scoring and capability routing.
- R16 added direct-match glow, a complete combobox/listbox relationship, a
  bounded live result status, a 160-character query limit, and automatic
  keyboard-selection scrolling.
- R17 added a six-section sticky Settings navigator. Click and manual scroll
  keep the current section synchronized; reduced-motion users skip smooth
  scrolling.
- Browser QA confirmed recent PowerShell ranking, three visible `edge` match
  highlights, nine-result End-key scrolling, General and Recovery navigation,
  zero horizontal overflow, and zero console warnings or errors at `1280x720`.
- Frontend ESLint, format validation, and all 43 unit tests pass.
- The preview tab and Vite server were closed after evidence capture.
- Native compilation and EXE launch were not run because this batch changes
  only the frontend and the user did not authorize a native build.
