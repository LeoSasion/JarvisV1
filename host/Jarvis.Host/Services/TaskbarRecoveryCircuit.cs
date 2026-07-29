namespace Jarvis.Host.Services;

internal sealed class TaskbarRecoveryCircuit
{
    internal const int FailureThreshold = 3;
    internal static readonly TimeSpan FailureWindow = TimeSpan.FromSeconds(60);
    internal static readonly TimeSpan Cooldown = TimeSpan.FromSeconds(60);

    private readonly object _gate = new();
    private readonly Queue<DateTimeOffset> _failures = new();
    private DateTimeOffset? _retryAfterUtc;

    public TaskbarRecoveryCircuitSnapshot ReportFailure(DateTimeOffset nowUtc)
    {
        lock (_gate)
        {
            Normalize(nowUtc);
            if (_retryAfterUtc is not null)
            {
                return CreateSnapshot();
            }

            _failures.Enqueue(nowUtc);
            PruneFailures(nowUtc);
            if (_failures.Count >= FailureThreshold)
            {
                _retryAfterUtc = nowUtc + Cooldown;
            }

            return CreateSnapshot();
        }
    }

    public TaskbarRecoveryCircuitSnapshot Capture(DateTimeOffset nowUtc)
    {
        lock (_gate)
        {
            Normalize(nowUtc);
            return CreateSnapshot();
        }
    }

    public TaskbarRecoveryCircuitSnapshot Reset()
    {
        lock (_gate)
        {
            _failures.Clear();
            _retryAfterUtc = null;
            return CreateSnapshot();
        }
    }

    public TaskbarRecoveryCircuitSnapshot ReportStableSuccess() => Reset();

    private void Normalize(DateTimeOffset nowUtc)
    {
        if (_retryAfterUtc is not null)
        {
            if (_retryAfterUtc <= nowUtc)
            {
                _failures.Clear();
                _retryAfterUtc = null;
            }

            return;
        }

        PruneFailures(nowUtc);
    }

    private void PruneFailures(DateTimeOffset nowUtc)
    {
        var oldestAllowed = nowUtc - FailureWindow;
        while (_failures.TryPeek(out var failure) && failure < oldestAllowed)
        {
            _ = _failures.Dequeue();
        }
    }

    private TaskbarRecoveryCircuitSnapshot CreateSnapshot() => new(
        _failures.Count,
        _retryAfterUtc);
}

internal readonly record struct TaskbarRecoveryCircuitSnapshot(
    int FailureCount,
    DateTimeOffset? RetryAfterUtc)
{
    public bool IsOpen => RetryAfterUtc is not null;
}
