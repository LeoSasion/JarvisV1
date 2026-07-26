using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Services;

internal sealed class TrayStatusService : IDisposable
{
    private readonly object _gate = new();
    private readonly RuntimeSnapshotFeed _runtimeFeed;
    private readonly AudioEndpointService _audioService;
    private TrayStatusSnapshot? _latest;
    private bool _started;
    private bool _disposed;

    public TrayStatusService(
        RuntimeSnapshotFeed runtimeFeed,
        AudioEndpointService audioService)
    {
        _runtimeFeed = runtimeFeed;
        _audioService = audioService;
    }

    public event Action<TrayStatusSnapshot>? SnapshotChanged;

    public void Start()
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_started)
            {
                return;
            }

            _started = true;
            _runtimeFeed.SnapshotAvailable += OnRuntimeSnapshot;
            _audioService.SnapshotChanged += OnAudioSnapshot;
        }

    }

    public TrayStatusSnapshot GetSnapshot() => Capture();

    public TrayStatusSnapshot SetVolume(int volumePercent)
    {
        _audioService.SetVolume(volumePercent);
        return Capture();
    }

    public TrayStatusSnapshot SetMuted(bool muted)
    {
        _audioService.SetMuted(muted);
        return Capture();
    }

    private TrayStatusSnapshot Capture()
    {
        var system = _runtimeFeed.GetSystemSnapshot();
        return Store(new TrayStatusSnapshot(
            DateTimeOffset.UtcNow,
            _audioService.GetSnapshot(),
            system.Network,
            system.Power));
    }

    private void OnRuntimeSnapshot(RuntimeTelemetrySnapshot snapshot)
    {
        if (!snapshot.SystemChanged)
        {
            return;
        }

        PublishIfChanged(new TrayStatusSnapshot(
            DateTimeOffset.UtcNow,
            _audioService.GetSnapshot(),
            snapshot.System.Network,
            snapshot.System.Power));
    }

    private void OnAudioSnapshot(AudioEndpointSnapshot audio)
    {
        var system = _runtimeFeed.GetSystemSnapshot();
        PublishIfChanged(new TrayStatusSnapshot(
            DateTimeOffset.UtcNow,
            audio,
            system.Network,
            system.Power));
    }

    private TrayStatusSnapshot Store(TrayStatusSnapshot snapshot)
    {
        lock (_gate)
        {
            if (_latest is not null && StatesEqual(_latest, snapshot))
            {
                return _latest;
            }

            _latest = snapshot;
            return snapshot;
        }
    }

    private void PublishIfChanged(TrayStatusSnapshot snapshot)
    {
        Action<TrayStatusSnapshot>? subscribers;
        lock (_gate)
        {
            if (_disposed || (_latest is not null && StatesEqual(_latest, snapshot)))
            {
                return;
            }

            _latest = snapshot;
            subscribers = SnapshotChanged;
        }

        if (subscribers is null)
        {
            return;
        }

        foreach (Action<TrayStatusSnapshot> subscriber in subscribers.GetInvocationList())
        {
            try
            {
                subscriber(snapshot);
            }
            catch (Exception ex)
            {
                HostLog.Error("A tray-state subscriber rejected a snapshot.", ex);
            }
        }
    }

    private static bool StatesEqual(TrayStatusSnapshot left, TrayStatusSnapshot right) =>
        left.Audio == right.Audio &&
        left.Network == right.Network &&
        left.Power == right.Power;

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            if (_started)
            {
                _runtimeFeed.SnapshotAvailable -= OnRuntimeSnapshot;
                _audioService.SnapshotChanged -= OnAudioSnapshot;
                _started = false;
            }

            SnapshotChanged = null;
        }
    }
}

internal sealed record TrayStatusSnapshot(
    DateTimeOffset Timestamp,
    AudioEndpointSnapshot Audio,
    NetworkSnapshot Network,
    PowerSnapshot Power);
