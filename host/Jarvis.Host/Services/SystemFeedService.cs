using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Services;

internal sealed class SystemFeedService : IDisposable
{
    private const int MaximumItems = 50;
    private const int MaximumRendererFaultTitleLength = 160;
    private const int MaximumRendererFaultDetailLength = 320;
    private static readonly TimeSpan DuplicateWindow = TimeSpan.FromSeconds(30);
    private static readonly HashSet<string> RendererFaultSeverities =
        new(StringComparer.Ordinal)
        {
            "warning",
            "error"
        };
    private static readonly HashSet<string> RendererFaultSources =
        new(StringComparer.Ordinal)
        {
            "agent",
            "desktop",
            "explorer",
            "notifications",
            "runtime",
            "settings",
            "shell",
            "system",
            "taskbar",
            "terminal",
            "window-appearance"
        };

    private readonly object _gate = new();
    private readonly TrayStatusService _trayStatusService;
    private readonly SystemFeedBuffer _buffer =
        new(MaximumItems, DuplicateWindow);

    private TrayStatusSnapshot? _previousTray;
    private bool _started;
    private bool _disposed;

    public SystemFeedService(TrayStatusService trayStatusService)
    {
        _trayStatusService = trayStatusService;
    }

    public event Action<SystemFeedSnapshot>? SnapshotChanged;

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
            _trayStatusService.SnapshotChanged += OnTraySnapshot;
        }

        Add(
            "runtime.ready",
            "info",
            "JARVIS status feed connected",
            "Events in this panel describe the current JARVIS session.",
            actionId: null,
            deduplicationKey: "runtime.ready");
    }

    public SystemFeedSnapshot GetSnapshot()
    {
        lock (_gate)
        {
            return _buffer.GetSnapshot();
        }
    }

    public SystemFeedSnapshot Add(
        string type,
        string severity,
        string title,
        string detail,
        string? actionId = null,
        string? deduplicationKey = null)
    {
        SystemFeedSnapshot snapshot;
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            var now = DateTimeOffset.UtcNow;
            var key = string.IsNullOrWhiteSpace(deduplicationKey)
                ? $"{type}:{title}:{detail}"
                : deduplicationKey.Trim();
            var item = new SystemFeedItem(
                Guid.NewGuid().ToString("N"),
                type,
                NormalizeSeverity(severity),
                title.Trim(),
                detail.Trim(),
                now,
                Unread: true,
                NormalizeActionId(actionId));
            if (!_buffer.TryAdd(key, item, out snapshot))
            {
                return snapshot;
            }
        }

        Publish(snapshot);
        return snapshot;
    }

    public SystemFeedSnapshot ReportRendererFault(RendererFaultReport report)
    {
        ArgumentNullException.ThrowIfNull(report);
        var source = NormalizeRendererFaultSource(report.Source);
        var severity = NormalizeRendererFaultSeverity(report.Severity);
        var title = NormalizeRendererFaultText(
            report.Title,
            nameof(report.Title),
            MaximumRendererFaultTitleLength,
            required: true);
        var detail = NormalizeRendererFaultText(
            report.Detail,
            nameof(report.Detail),
            MaximumRendererFaultDetailLength,
            required: false);
        var actionId = NormalizeRendererFaultActionId(report.ActionId);
        var type = $"renderer.{source}.fault";
        var deduplicationKey =
            $"renderer:{source}:{severity}:{title.Length}:{title}:{detail.Length}:{detail}:{actionId ?? string.Empty}";

        return Add(
            type,
            severity,
            title,
            detail,
            actionId,
            deduplicationKey);
    }

    public SystemFeedSnapshot MarkAllRead()
    {
        SystemFeedSnapshot snapshot;
        lock (_gate)
        {
            snapshot = _buffer.MarkAllRead();
        }

        Publish(snapshot);
        return snapshot;
    }

    public SystemFeedSnapshot Clear()
    {
        SystemFeedSnapshot snapshot;
        lock (_gate)
        {
            snapshot = _buffer.Clear();
        }

        Publish(snapshot);
        return snapshot;
    }

    private void OnTraySnapshot(TrayStatusSnapshot current)
    {
        TrayStatusSnapshot? previous;
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            previous = _previousTray;
            _previousTray = current;
        }

        if (previous is null)
        {
            if (!current.Audio.Available)
            {
                Add(
                    "audio.unavailable",
                    "warning",
                    "Audio endpoint unavailable",
                    current.Audio.Error ?? "Windows did not report a usable default output endpoint.",
                    "open-sound-settings",
                    "audio.unavailable");
            }
            return;
        }

        if (previous.Network.IsAvailable != current.Network.IsAvailable)
        {
            Add(
                current.Network.IsAvailable ? "network.online" : "network.offline",
                current.Network.IsAvailable ? "ok" : "warning",
                current.Network.IsAvailable ? "Network connection restored" : "Network connection unavailable",
                current.Network.IsAvailable
                    ? current.Network.InterfaceName ?? "Windows reports an active network interface."
                    : "Windows reports no active non-loopback interface.",
                "open-network-settings",
                $"network:{current.Network.IsAvailable}");
        }

        if (previous.Audio.Available != current.Audio.Available)
        {
            Add(
                current.Audio.Available ? "audio.restored" : "audio.unavailable",
                current.Audio.Available ? "ok" : "warning",
                current.Audio.Available ? "Audio endpoint restored" : "Audio endpoint unavailable",
                current.Audio.Available
                    ? current.Audio.DeviceLabel ?? "The default Windows output endpoint is ready."
                    : current.Audio.Error ?? "The default Windows output endpoint is unavailable.",
                "open-sound-settings",
                $"audio:{current.Audio.Available}");
        }

        var previousLow = previous.Power.BatteryPresent &&
                          previous.Power.Percentage is < 20;
        var currentLow = current.Power.BatteryPresent &&
                         current.Power.Percentage is < 20;
        if (!previousLow && currentLow)
        {
            Add(
                "power.low",
                "warning",
                "Battery level is low",
                $"Windows reports {current.Power.Percentage}% remaining.",
                "open-power-settings",
                "power.low");
        }

        if (previous.Power.Charging != current.Power.Charging && current.Power.Charging)
        {
            Add(
                "power.charging",
                "ok",
                "Battery charging started",
                $"Windows reports {current.Power.Percentage ?? 0}% battery.",
                "open-power-settings",
                "power.charging");
        }
    }

    private static string NormalizeSeverity(string severity) =>
        severity.Trim().ToLowerInvariant() switch
        {
            "ok" => "ok",
            "warning" => "warning",
            "error" => "error",
            _ => "info"
        };

    private static string? NormalizeActionId(string? actionId) =>
        actionId?.Trim().ToLowerInvariant() switch
        {
            "open-network-settings" => "open-network-settings",
            "open-sound-settings" => "open-sound-settings",
            "open-power-settings" => "open-power-settings",
            "open-runtime-settings" => "open-runtime-settings",
            _ => null
        };

    private static string NormalizeRendererFaultSource(string source)
    {
        var normalized = NormalizeRendererFaultText(
            source,
            nameof(RendererFaultReport.Source),
            maximumLength: 32,
            required: true).ToLowerInvariant();
        if (!RendererFaultSources.Contains(normalized))
        {
            throw new ArgumentException(
                $"Renderer fault source '{normalized}' is not supported.",
                nameof(source));
        }

        return normalized;
    }

    private static string NormalizeRendererFaultSeverity(string severity)
    {
        var normalized = NormalizeRendererFaultText(
            severity,
            nameof(RendererFaultReport.Severity),
            maximumLength: 16,
            required: true).ToLowerInvariant();
        if (!RendererFaultSeverities.Contains(normalized))
        {
            throw new ArgumentException(
                "Renderer faults must use warning or error severity.",
                nameof(severity));
        }

        return normalized;
    }

    private static string? NormalizeRendererFaultActionId(string? actionId)
    {
        if (string.IsNullOrWhiteSpace(actionId))
        {
            return null;
        }

        var normalized = NormalizeRendererFaultText(
            actionId,
            nameof(RendererFaultReport.ActionId),
            maximumLength: 32,
            required: true).ToLowerInvariant();
        var safeActionId = NormalizeActionId(normalized);
        if (safeActionId is null)
        {
            throw new ArgumentException(
                $"Renderer fault action '{normalized}' is not supported.",
                nameof(actionId));
        }

        return safeActionId;
    }

    private static string NormalizeRendererFaultText(
        string? value,
        string fieldName,
        int maximumLength,
        bool required)
    {
        var normalized = value?.Trim() ?? string.Empty;
        if (required && normalized.Length == 0)
        {
            throw new ArgumentException(
                $"Renderer fault {fieldName} must not be empty.",
                fieldName);
        }
        if (normalized.Length > maximumLength)
        {
            throw new ArgumentException(
                $"Renderer fault {fieldName} must not exceed {maximumLength} characters.",
                fieldName);
        }
        if (normalized.Any(char.IsControl))
        {
            throw new ArgumentException(
                $"Renderer fault {fieldName} must not contain control characters.",
                fieldName);
        }

        return normalized;
    }

    private void Publish(SystemFeedSnapshot snapshot)
    {
        var subscribers = SnapshotChanged;
        if (subscribers is null)
        {
            return;
        }

        foreach (Action<SystemFeedSnapshot> subscriber in subscribers.GetInvocationList())
        {
            try
            {
                subscriber(snapshot);
            }
            catch (Exception ex)
            {
                HostLog.Error("A system-feed subscriber rejected a snapshot.", ex);
            }
        }
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
            if (_started)
            {
                _trayStatusService.SnapshotChanged -= OnTraySnapshot;
                _started = false;
            }

            SnapshotChanged = null;
        }
    }
}

internal sealed record RendererFaultReport(
    string Source,
    string Severity,
    string Title,
    string? Detail = null,
    string? ActionId = null);

internal sealed record SystemFeedItem(
    string Id,
    string Type,
    string Severity,
    string Title,
    string Detail,
    DateTimeOffset Timestamp,
    bool Unread,
    string? ActionId);

internal sealed record SystemFeedSnapshot(
    IReadOnlyList<SystemFeedItem> Items,
    int UnreadCount,
    int Capacity);

internal sealed class SystemFeedBuffer
{
    private readonly int _capacity;
    private readonly TimeSpan _duplicateWindow;
    private readonly List<SystemFeedItem> _items = [];
    private readonly Dictionary<string, DateTimeOffset> _lastByKey =
        new(StringComparer.Ordinal);

    public SystemFeedBuffer(int capacity, TimeSpan duplicateWindow)
    {
        _capacity = Math.Max(1, capacity);
        _duplicateWindow = duplicateWindow < TimeSpan.Zero
            ? TimeSpan.Zero
            : duplicateWindow;
    }

    public bool TryAdd(
        string key,
        SystemFeedItem item,
        out SystemFeedSnapshot snapshot)
    {
        PruneDeduplicationKeys(item.Timestamp);
        if (_lastByKey.TryGetValue(key, out var last) &&
            item.Timestamp - last < _duplicateWindow)
        {
            snapshot = GetSnapshot();
            return false;
        }

        _lastByKey[key] = item.Timestamp;
        TrimDeduplicationIndex();
        _items.Insert(0, item);
        if (_items.Count > _capacity)
        {
            _items.RemoveRange(_capacity, _items.Count - _capacity);
        }

        snapshot = GetSnapshot();
        return true;
    }

    internal int DeduplicationKeyCount => _lastByKey.Count;

    private void PruneDeduplicationKeys(DateTimeOffset timestamp)
    {
        var cutoff = timestamp - _duplicateWindow;
        foreach (var key in _lastByKey
                     .Where(entry => entry.Value <= cutoff)
                     .Select(entry => entry.Key)
                     .ToArray())
        {
            _lastByKey.Remove(key);
        }
    }

    private void TrimDeduplicationIndex()
    {
        if (_lastByKey.Count <= _capacity)
        {
            return;
        }

        foreach (var key in _lastByKey
                     .OrderBy(entry => entry.Value)
                     .Take(_lastByKey.Count - _capacity)
                     .Select(entry => entry.Key)
                     .ToArray())
        {
            _lastByKey.Remove(key);
        }
    }

    public SystemFeedSnapshot MarkAllRead()
    {
        for (var index = 0; index < _items.Count; index++)
        {
            _items[index] = _items[index] with { Unread = false };
        }

        return GetSnapshot();
    }

    public SystemFeedSnapshot Clear()
    {
        _items.Clear();
        _lastByKey.Clear();
        return GetSnapshot();
    }

    public SystemFeedSnapshot GetSnapshot() => new(
        _items.ToArray(),
        _items.Count(item => item.Unread),
        _capacity);
}
