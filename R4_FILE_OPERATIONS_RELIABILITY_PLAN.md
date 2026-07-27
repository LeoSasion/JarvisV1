# R4 — File Operations Reliability

## Outcome

Turn JARVIS File Explorer copy and move from a blocking best-effort command into a cancellable, observable Windows-style transfer workflow without weakening the existing local-filesystem safety boundary.

## Scope

1. Add a native transfer coordinator with explicit queued, scanning, transferring, completed, cancelled, and failed states.
2. Add transfer preflight with top-level name-conflict discovery and three deliberate policies:
   - keep both by generating a unique Windows-style name;
   - skip conflicting items;
   - replace with rollback protection.
3. Stream file copies with byte progress and cancellation checkpoints.
4. Support cross-volume move as verified copy followed by source deletion; never delete the source after a cancelled or incomplete copy.
5. Continue rejecting network/optical paths and all source or nested reparse points.
6. Raise the local long-path boundary to the Windows long-path-aware limit already declared by the host manifest.
7. Add an in-window transfer center with progress, current item, conflict choice, cancellation, and concise completion/error summaries.
8. Keep the browser mock behavior contract-compatible so the complete flow can be tested without modifying real files.

## Safety invariants

- Only one transfer job may mutate the filesystem at a time.
- A partial destination created by JARVIS is removed after cancellation or failure.
- Replace first moves the existing target to a same-directory rollback path and restores it if the new transfer fails.
- Cross-volume move deletes the source only after the destination copy has completed and its byte count matches the scan.
- Reparse points are never traversed, copied, moved, or replaced.
- Drive roots, UNC paths, device paths, network drives, optical drives, and unavailable drives remain outside scope.

## Verification gates

- Frontend lint, format, unit tests, and production build.
- Host unit tests and Release build.
- Host tests cover conflict policy, cancellation cleanup, reparse blocking, long paths, and cross-volume planning where the environment permits.
- Browser QA covers conflict selection, visible progress, cancellation, and terminal completion state with no framework or console errors.
- Native Host smoke test uses only temporary disposable files.
- Every test process/window/tab opened by Codex is closed and the native Windows taskbar is restored before delivery.

## Explicitly deferred

- Undo history across application restarts.
- Network shares, cloud placeholders, elevation prompts, encrypted files, and optical media.
- Parallel multi-job transfer queues and bandwidth throttling.
- Windows 10 compatibility certification; implementation remains Win10-compatible in API choice, with final compatibility validation deferred to the Win10 environment.
