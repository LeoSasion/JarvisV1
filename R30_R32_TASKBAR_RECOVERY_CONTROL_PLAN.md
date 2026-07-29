# JARVIS V1 R30-R32 Taskbar Recovery Control Plan

Status: `COMPLETE · AUTOMATED AND LIVE VALIDATION PASSED`

Baseline: `main @ 07c7398` plus unvalidated R24-R29 source

Primary environment: current Windows 11 development machine

## Product evidence

`taskbarMode.setMode` currently returns after saving the requested mode, before
the native taskbar rebind has completed. The frontend therefore clears
`APPLYING` and may announce a fallback based on the previous effective mode
while the real transition is still running.

When the requested mode remains Full but the effective mode falls back to
Native, selecting Full again is ignored by both the frontend and
`TaskbarModeService`. There is no explicit retry command.

An unexpected watchdog exit queues another Full rebind after 750 ms. Repeated
renderer or watchdog failures can therefore cycle through create, hide,
restore, and retry without a bounded failure policy.

## R30 - Observable taskbar transition transaction

- Extend taskbar mode state with a wire-safe transition status:
  `settled`, `applying`, `fallback`, or `cooldown`.
- Attach the active rebind epoch and a stable transition reason to the state.
- Publish `applying` when an owned rebind begins, not merely when the preference
  is saved.
- Publish `settled` only after Native, Hybrid, or Full reaches its verified
  effective state.
- Publish `fallback` only after the native taskbar has been restored and the
  failure outcome belongs to the current epoch.
- Ensure stale generations cannot overwrite a newer transition status.
- Add pure tests for requested/effective transitions, stale completion
  rejection, and temporary lock/suspend recovery states.

## R31 - Bounded recovery circuit

- Add a pure `TaskbarRecoveryCircuit` that classifies failures from renderer
  readiness, watchdog activation, watchdog loss, shell probing, and unexpected
  lifecycle exceptions.
- Open the circuit after three owned failures inside a 60-second rolling
  window.
- While open, keep the Windows taskbar visible and reject automatic Full
  reactivation until the cooldown expires.
- Reset consecutive failures after a verified stable replacement interval or
  an explicit user recovery action.
- Do not count user-selected Native/Hybrid transitions, display cancellation,
  lock, suspend, shutdown, or superseded epochs as failures.
- Surface retry eligibility and remaining cooldown without starting a polling
  loop when the settings panel is closed.
- Cover threshold, rolling-window expiry, exclusions, manual reset, and stable
  success with deterministic clock-driven tests.

## R32 - Explicit retry and truthful settings UI

- Add `taskbarMode.retry` as a separate bridge operation; it retries the saved
  requested mode without rewriting the preference.
- Reject retry during an active transition, safety mode, or open cooldown, and
  return a structured bridge fault.
- Keep taskbar controls disabled while the host reports `applying`.
- Replace the immediate mode-switch toast with a toast driven by the final
  `taskbarMode.changed` outcome.
- Show current transition reason, fallback reason, and cooldown state in the
  taskbar settings telemetry.
- Present `RETRY FULL` only when the requested mode differs from the effective
  mode and the recovery circuit permits it.
- Extend the mock platform and frontend state normalizer for every transition
  status.
- Add frontend tests for applying-to-settled, applying-to-fallback, cooldown,
  retry success, retry rejection, and out-of-order event suppression.

## Acceptance contract

1. Selecting Full immediately reports `APPLYING`, while the Windows taskbar
   remains recoverable.
2. The UI does not claim success or fallback until the current host epoch
   publishes a terminal outcome.
3. A single failure restores Windows and offers an explicit retry.
4. Repeated failures cannot produce an unbounded hide/restore loop.
5. Native and Hybrid remain selectable during ordinary fallback unless safety
   recovery requires controls to be temporarily locked.
6. Lock, suspend, Explorer restart, and display topology changes never consume
   the user-failure budget.
7. Diagnostics expose requested mode, effective mode, transition state, epoch,
   circuit state, and the latest owned failure reason.

## Validation plan

- Validate the R24-R29 lifecycle gates independently before exercising the
  R30-R32 failure and retry paths.
- Keep review evidence separated by round even if the source batches are
  compiled in one authorized build.
- Run host unit tests for transition state and recovery-circuit timing.
- Run frontend state and component tests for asynchronous outcomes.
- Live-test Native -> Full -> Native, forced renderer failure, manual retry,
  three-failure cooldown, and cooldown recovery.
- During live testing, use the native-taskbar safety path for diagnostic-only
  surfaces and restore the saved requested mode afterward.
- Close every test app and JARVIS window immediately after capturing required
  evidence.

## Safety boundary

- A cooldown can block JARVIS reactivation only; it must never block restoration
  or ordinary use of the Windows taskbar.
- Retry is explicit and local to the current user session.
- Do not persist failure counters across reboot in V1.
- Do not kill or restart Explorer as part of retry.
- No compile, EXE launch, taskbar manipulation, input hook, visual automation,
  commit, or push occurs until R24-R29 has passed its authorized validation
  gate.
- Preserve and exclude all user changes under `assets/archive`.

## Source review result

- Taskbar mode state now exposes owned transition status, transition
  generation, reason, retry eligibility, recovery failure count, and retry
  timestamp.
- Rebind generation is published as `applying` before asynchronous work begins;
  terminal reports are accepted only from the owned generation.
- Three owned failures inside 60 seconds open a 60-second recovery circuit.
  The circuit preserves its evidence during cooldown and clears on expiry,
  explicit recovery action, or 30 seconds of verified replacement stability.
- Watchdog loss first publishes the restored Native state, then retries only
  while the recovery circuit remains closed.
- `taskbarMode.retry` retries the saved requested mode without rewriting the
  preference and returns structured rejection while applying, cooling down, in
  safety mode, or already settled.
- Frontend state rejects older generations and same-generation regressions from
  terminal status back to `applying`.
- Settings remain disabled only while a transaction is applying; final toasts
  are driven by terminal events, and eligible fallback exposes an explicit
  retry control with local cooldown countdown.
- Mock platform and host/frontend regression suites cover transition states,
  out-of-order events, circuit threshold/expiry/reset, asynchronous settlement,
  and retry rejection.
- Authorized compilation, automated execution, and live taskbar manipulation
  passed.

## Validation result

- Frontend formatting, lint, build, and all 51 tests passed.
- Host build completed with zero warnings and zero errors; all 98 host tests
  passed.
- Browser QA verified `applying` and terminal mode outcomes, generation
  ordering, retry visibility rules, and an empty runtime error log.
- Live Windows 11 validation at 2560 x 1440 verified Native, Hybrid, and Full
  layouts. Full replacement remained stable for 30 seconds and the safety exit
  restored the native taskbar through the watchdog.
- Native validation exposed a fullscreen placement defect: the desktop surface
  could cover the Windows work area even while lifecycle state reported
  `NativeVisible`. `DesktopSurfacePlacementPolicy` now uses the monitor work
  area while replacement is pending or Native/Hybrid is effective, and the
  full monitor only after Full replacement activation is confirmed. Dedicated
  policy tests cover this boundary.
- The temporary Explorer window was closed after evidence capture, no JARVIS or
  test-server process remained, and the pre-test absence of
  `taskbar-mode.json` was restored.
- Recovery threshold, cooldown expiry, exclusions, and manual reset are covered
  by deterministic tests. Deliberate live renderer/watchdog fault injection was
  not performed because it would add native-shell risk without improving the
  already isolated circuit-policy evidence.
