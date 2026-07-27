using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Services;

internal sealed class RuntimeSnapshotFeed : IDisposable
{
    private static readonly TimeSpan RefreshInterval = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan TaskbarEventDebounce = TimeSpan.FromMilliseconds(75);

    private readonly object _stateGate = new();
    private readonly object _captureGate = new();
    private readonly object _publishGate = new();
    private readonly SystemSnapshotService _systemService;
    private readonly WindowTaskbarService _taskbarService;
    private readonly WindowTaskbarEventMonitor _taskbarEventMonitor = new();
    private readonly CancellationTokenSource _shutdown = new();

    private RuntimeTelemetrySnapshot? _latest;
    private Task? _loopTask;
    private Timer? _taskbarRefreshTimer;
    private int _taskbarEventHookCount;
    private int _eventRefreshFailures;
    private bool _disposed;

    public RuntimeSnapshotFeed(
        SystemSnapshotService systemService,
        WindowTaskbarService taskbarService)
    {
        _systemService = systemService;
        _taskbarService = taskbarService;
    }

    public event Action<RuntimeTelemetrySnapshot>? SnapshotAvailable;

    public void Start()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        lock (_stateGate)
        {
            if (_loopTask is not null)
            {
                return;
            }

            _taskbarRefreshTimer = new Timer(
                OnTaskbarRefreshTimer,
                null,
                Timeout.InfiniteTimeSpan,
                Timeout.InfiniteTimeSpan);
            _taskbarEventMonitor.Changed += OnTaskbarWindowChanged;
            _taskbarEventHookCount = _taskbarEventMonitor.Start();
            if (_taskbarEventHookCount == 0)
            {
                HostLog.Warning(
                    "Windows taskbar event hooks were unavailable; the one-second polling fallback remains active.");
            }
            else
            {
                var message =
                    $"Windows taskbar event refresh armed with {_taskbarEventHookCount}/" +
                    $"{WindowTaskbarEventMonitor.ExpectedHookCount} hook(s).";
                if (_taskbarEventHookCount == WindowTaskbarEventMonitor.ExpectedHookCount)
                {
                    HostLog.Info(message);
                }
                else
                {
                    HostLog.Warning($"{message} Polling will cover missing event ranges.");
                }
            }

            _loopTask = Task.Run(() => RunAsync(_shutdown.Token));
        }
    }

    public SystemSnapshot GetSystemSnapshot() => GetLatestOrCapture().System;

    public WindowTaskbarSnapshot GetTaskbarSnapshot() => GetLatestOrCapture().Taskbar;

    public bool TryGetLatestTaskbarSnapshot(out WindowTaskbarSnapshot snapshot)
    {
        lock (_stateGate)
        {
            if (_latest is null)
            {
                snapshot = default!;
                return false;
            }

            snapshot = _latest.Taskbar;
            return true;
        }
    }

    public RuntimeTaskbarFeedDiagnostics CaptureTaskbarDiagnostics()
    {
        lock (_stateGate)
        {
            return new RuntimeTaskbarFeedDiagnostics(
                _loopTask is not null && !_disposed,
                _taskbarEventHookCount,
                WindowTaskbarEventMonitor.ExpectedHookCount,
                checked((int)TaskbarEventDebounce.TotalMilliseconds),
                checked((int)RefreshInterval.TotalMilliseconds));
        }
    }

    private RuntimeTelemetrySnapshot GetLatestOrCapture()
    {
        lock (_stateGate)
        {
            if (_latest is not null)
            {
                return _latest;
            }
        }

        return CaptureAndStore();
    }

    private RuntimeTelemetrySnapshot CaptureAndStore()
    {
        lock (_captureGate)
        {
            lock (_stateGate)
            {
                if (_latest is not null && _loopTask is null)
                {
                    return _latest;
                }
            }

            var snapshot = new RuntimeTelemetrySnapshot(
                _systemService.Capture(),
                _taskbarService.Capture(),
                SystemChanged: true,
                TaskbarChanged: true);
            lock (_stateGate)
            {
                _latest = snapshot;
            }

            return snapshot;
        }
    }

    private RuntimeTelemetrySnapshot? CaptureTaskbarAndStore()
    {
        lock (_captureGate)
        {
            RuntimeTelemetrySnapshot? current;
            lock (_stateGate)
            {
                current = _latest;
            }

            var taskbar = _taskbarService.Capture();
            if (current is not null && TaskbarSnapshotsEqual(current.Taskbar, taskbar))
            {
                return null;
            }

            var snapshot = new RuntimeTelemetrySnapshot(
                current?.System ?? _systemService.Capture(),
                taskbar,
                SystemChanged: current is null,
                TaskbarChanged: true);
            lock (_stateGate)
            {
                _latest = snapshot;
            }

            return snapshot;
        }
    }

    private void OnTaskbarWindowChanged()
    {
        lock (_stateGate)
        {
            if (_disposed)
            {
                return;
            }

            _ = _taskbarRefreshTimer?.Change(
                TaskbarEventDebounce,
                Timeout.InfiniteTimeSpan);
        }
    }

    private void OnTaskbarRefreshTimer(object? state)
    {
        _ = state;
        lock (_stateGate)
        {
            if (_disposed)
            {
                return;
            }
        }

        try
        {
            var snapshot = CaptureTaskbarAndStore();
            _eventRefreshFailures = 0;
            if (snapshot is not null)
            {
                PublishIfCurrent(snapshot);
            }
        }
        catch (Exception ex)
        {
            var failureCount = Interlocked.Increment(ref _eventRefreshFailures);
            if (failureCount == 1 || failureCount % 30 == 0)
            {
                HostLog.Error(
                    $"Event-driven taskbar refresh failed {failureCount} consecutive time(s); polling remains active.",
                    ex);
            }
        }
    }

    private void PublishIfCurrent(RuntimeTelemetrySnapshot snapshot)
    {
        lock (_publishGate)
        {
            lock (_stateGate)
            {
                if (_disposed || !ReferenceEquals(_latest, snapshot))
                {
                    return;
                }
            }

            var subscribers = SnapshotAvailable;
            if (subscribers is null)
            {
                return;
            }

            foreach (Action<RuntimeTelemetrySnapshot> subscriber in subscribers.GetInvocationList())
            {
                try
                {
                    subscriber(snapshot);
                }
                catch (Exception ex)
                {
                    HostLog.Error("A telemetry subscriber rejected a runtime snapshot.", ex);
                }
            }
        }
    }

    private static bool TaskbarSnapshotsEqual(
        WindowTaskbarSnapshot left,
        WindowTaskbarSnapshot right)
    {
        if (!string.Equals(
                left.ForegroundWindowId,
                right.ForegroundWindowId,
                StringComparison.OrdinalIgnoreCase) ||
            left.Windows.Count != right.Windows.Count)
        {
            return false;
        }

        for (var index = 0; index < left.Windows.Count; index++)
        {
            var leftWindow = left.Windows[index];
            var rightWindow = right.Windows[index];
            if (leftWindow != rightWindow)
            {
                return false;
            }
        }

        return true;
    }

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(RefreshInterval);
        var consecutiveFailures = 0;

        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
            {
                RuntimeTelemetrySnapshot snapshot;
                try
                {
                    snapshot = await Task.Run(CaptureAndStore, cancellationToken);
                    consecutiveFailures = 0;
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    consecutiveFailures++;
                    if (consecutiveFailures == 1 || consecutiveFailures % 30 == 0)
                    {
                        HostLog.Error(
                            $"Runtime telemetry sampling failed {consecutiveFailures} consecutive time(s); the feed will retry.",
                            ex);
                    }

                    continue;
                }

                PublishIfCurrent(snapshot);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Expected during normal host shutdown.
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _taskbarEventMonitor.Changed -= OnTaskbarWindowChanged;
        _taskbarEventMonitor.Dispose();
        _taskbarRefreshTimer?.Dispose();
        _taskbarRefreshTimer = null;
        _shutdown.Cancel();
        SnapshotAvailable = null;
        _shutdown.Dispose();
    }
}

internal sealed record RuntimeTelemetrySnapshot(
    SystemSnapshot System,
    WindowTaskbarSnapshot Taskbar,
    bool SystemChanged,
    bool TaskbarChanged);

internal sealed record RuntimeTaskbarFeedDiagnostics(
    bool PollingActive,
    int EventHookCount,
    int ExpectedEventHookCount,
    int EventDebounceMilliseconds,
    int PollingIntervalMilliseconds);
