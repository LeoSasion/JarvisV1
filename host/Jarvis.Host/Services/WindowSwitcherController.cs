using System.Windows.Threading;
using Jarvis.Host.Bridge;
using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Services;

internal sealed class WindowSwitcherController : IDisposable
{
    private readonly object _gate = new();
    private readonly Dispatcher _dispatcher;
    private readonly RuntimeSnapshotFeed _snapshotFeed;
    private readonly WindowTaskbarService _taskbarService;
    private readonly WindowSwitcherWindow _window;
    private readonly WindowSwitcherSelectionMachine _selection = new();
    private readonly GlobalWindowSwitcherHook _hook;

    private bool _enabled;
    private bool _disposed;

    public WindowSwitcherController(
        Dispatcher dispatcher,
        RuntimeSnapshotFeed snapshotFeed,
        WindowTaskbarService taskbarService,
        WindowSwitcherWindow window)
    {
        _dispatcher = dispatcher;
        _snapshotFeed = snapshotFeed;
        _taskbarService = taskbarService;
        _window = window;
        _hook = new GlobalWindowSwitcherHook(
            BeginOrAdvance,
            Commit,
            Cancel,
            _taskbarService.ObserveFullscreenShortcut,
            _taskbarService.ObserveFullscreenExitShortcut);
    }

    public bool Start() => _hook.Register();

    public void SetEnabled(bool enabled)
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _enabled = enabled;
            if (!enabled)
            {
                _selection.Cancel();
            }
        }

        _hook.SetEnabled(enabled);
        if (!enabled)
        {
            _ = _dispatcher.BeginInvoke(_window.Dismiss);
        }
    }

    private bool BeginOrAdvance(bool reverse)
    {
        WindowSwitcherPresentationState? state;
        lock (_gate)
        {
            if (_disposed || !_enabled || !_window.IsReady)
            {
                return false;
            }

            state = _selection.Active
                ? _selection.Advance(reverse)
                : _snapshotFeed.TryGetLatestTaskbarSnapshot(out var snapshot)
                    ? _selection.Begin(snapshot, reverse)
                    : null;
        }

        if (state is null)
        {
            return false;
        }

        _ = _dispatcher.BeginInvoke(() => _ = _window.PresentAsync(state));
        return true;
    }

    private void Commit()
    {
        string? windowId;
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            windowId = _selection.Commit();
        }

        _ = _dispatcher.BeginInvoke(() =>
        {
            _window.Dismiss();
            if (string.IsNullOrWhiteSpace(windowId))
            {
                return;
            }

            try
            {
                _taskbarService.Activate(windowId);
            }
            catch (BridgeFaultException ex)
            {
                HostLog.Warning($"Window switcher activation was rejected: {ex.Message}");
            }
            catch (Exception ex)
            {
                HostLog.Error("Window switcher activation failed unexpectedly.", ex);
            }
        });
    }

    private void Cancel()
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _selection.Cancel();
        }

        _ = _dispatcher.BeginInvoke(_window.Dismiss);
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _enabled = false;
            _selection.Cancel();
        }

        _hook.Dispose();
        _window.Dismiss();
    }
}
