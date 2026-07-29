# JARVIS V1 R27-R29 Taskbar Rebind Epoch Plan

Status: `COMPLETE · AUTOMATED AND LIVE VALIDATION PASSED`

Baseline: `main @ 07c7398` plus unvalidated R24-R26 source

Primary environment: current Windows 11 development machine

## Product evidence

Taskbar surface callbacks are accepted when their captured generation equals a
raw shared counter. Requested-mode handling temporarily deferred incrementing
that counter to the UI dispatcher, leaving a narrow interval in which an older
surface could still report ready after the requested mode had changed.

Taskbar WebView2 startup also did not observe the surface shutdown token until
its later DOM readiness loop. Closing a concealed surface during initialization
could therefore emit a false startup failure, and telemetry completion could
start a heartbeat for a surface that had already been released.

## R27 - Explicit rebind epoch

- Replace scattered raw generation reads and increments with one testable epoch.
- Reject generation zero and every superseded taskbar callback.
- Invalidate the active epoch immediately when a requested mode, suspend, lock,
  or host shutdown makes existing work obsolete.
- Keep the epoch visible in runtime lifecycle snapshots.

## R28 - Ordered mode transition preparation

- Let a queued rebind own an optional synchronous preparation step.
- Reconcile switcher runtime ownership inside the newly owned epoch and before
  taskbar teardown or creation starts.
- Recheck epoch ownership after preparation so any nested transition fails
  closed.
- Preserve cancellation of delayed display, resume, unlock, and Explorer
  recovery work.

## R29 - Shutdown-aware taskbar prewarming

- Observe the taskbar surface shutdown token while obtaining and initializing
  WebView2.
- Treat intentional rebind closure during prewarming as cancellation instead of
  a renderer startup failure.
- Recheck cancellation after telemetry startup before launching the heartbeat
  or reporting surface readiness.
- Suppress heartbeat errors that race intentional close or cancellation.
- Cover epoch supersession, explicit invalidation, and zero-generation
  rejection with pure tests.

## Safety boundary

- Every stale callback continues to fall back without hiding the Windows
  taskbar.
- Full taskbar activation still requires its existing renderer and watchdog
  handshakes.
- No native compile, EXE launch, taskbar manipulation, input hook, or visual
  automation occurs without a new explicit authorization.
- Preserve and exclude all user changes under `assets/archive`.

## Source review result

- Requested-mode and native-restore events now fence stale work before their UI
  callbacks can run.
- Window-switcher ownership is reconciled before a newly owned taskbar rebind.
- Taskbar WebView2 initialization and readiness now exit quietly when their
  concealed surface is intentionally released.
- Raw generation operations have one owner and pure regression coverage.
- Authorized automated and live validation passed.

## Validation result

- Pure epoch tests cover initial ownership, immediate supersession, explicit
  invalidation, and zero-generation rejection.
- Host build completed with zero warnings and zero errors; all 98 host tests
  passed.
- Browser mock validation exercised ordered Hybrid -> Full -> Hybrid
  transactions and rejected stale presentation state.
- Separate native launches verified that Native, Hybrid, and Full each settle
  to the requested effective mode. In-process real-mode switching was not used
  as evidence for this round.
- Full startup and safety shutdown logs confirmed owned readiness callbacks,
  stable activation, and idempotent switcher/runtime release.
