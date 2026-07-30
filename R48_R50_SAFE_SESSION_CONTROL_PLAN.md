# JARVIS V1 R48-R50 Safe Session Control Plan

Status: `IMPLEMENTED - NON-COMPILATION GATES AND BROWSER QA PASSED`

Baseline: `main @ 3c6f72c`

Primary environment: current Windows 11 development machine

## Product outcome

Replace the misleading one-click power icon with a deliberate JARVIS session
control center. Users can safely return to Explorer or request a Windows lock,
sign-out, restart, or shutdown without exposing a generic command executor to
the renderer.

## R48 - Bounded session action contract

- Define a fixed native action set: lock, sign out, restart, and shut down.
- Keep executable names and arguments entirely in the native host.
- Issue a single-use, short-lived confirmation capability before accepting an
  action.
- Reject unknown actions, stale tokens, reused tokens, and commits that do not
  match the prepared action.
- Never force-close applications during sign out, restart, or shutdown.

## R49 - Session control HUD

- Route the top-bar power button and Start footer into a dedicated Session
  Control panel instead of immediately exiting JARVIS.
- Keep Exit to Windows as the safest primary action.
- Present the four native actions with clear impact language.
- Require a second explicit confirmation step and keep Cancel immediately
  available.
- Show native availability and bridge errors honestly.

## R50 - Recovery and validation

- Preserve `Ctrl+Shift+Q` as the unconditional JARVIS recovery path.
- Keep the browser mock non-destructive: it may simulate a successful action
  but must never touch the Windows session.
- Unit-test the frontend confirmation model and native single-use challenge
  policy without executing real system actions.
- Add the panel to the bounded desktop-panel allowlists for later native visual
  acceptance.

## Safety and performance boundaries

- Do not accept an executable path, command line, delay, or force flag from
  JavaScript.
- Do not use `/f`; Windows must retain its normal unsaved-work protections.
- Do not run any real lock, sign-out, restart, or shutdown during automated
  validation.
- Do not add polling, global hooks, background services, or account
  permissions.
- Preserve and exclude all user changes under `assets/archive`.

## Validation contract

- Run frontend unit tests, ESLint, and format checks without producing a
  production bundle.
- Run C# format verification without restoring or compiling the host.
- Defer production build, native WebView2 acceptance, and every real Windows
  session action until the user explicitly permits them.

## Validation evidence

- Frontend unit tests: `69/69` passed.
- ESLint and Prettier verification passed.
- C# format verification passed with `--no-restore`.
- Browser QA passed at `1280 x 720` and `2560 x 1440` with no application
  warnings or errors.
- Verified both power entry points, all five visible choices, Restart
  preparation, the 15-second single-use confirmation contract, and Cancel
  returning safely to the action list.
- No confirmation commit, Windows session mutation, production build, or EXE
  compilation was performed.
