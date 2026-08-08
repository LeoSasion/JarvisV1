using System.IO;
using System.Text.Json;
using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Services;

internal enum TaskbarMode
{
    Native,
    Hybrid,
    Full
}

internal enum TaskbarTransitionStatus
{
    Settled,
    Applying,
    Fallback,
    Cooldown
}

internal sealed class TaskbarModeService
{
    private static readonly string SettingsPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "JARVIS",
        "Settings",
        "taskbar-mode.json");

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private readonly object _gate = new();
    private TaskbarMode _requestedMode;
    private TaskbarMode _effectiveMode = TaskbarMode.Native;
    private string? _fallbackReason;
    private string? _configurationFallbackReason;
    private bool _hybridAvailable;
    private TaskbarTransitionStatus _transitionStatus = TaskbarTransitionStatus.Settled;
    private long _transitionGeneration;
    private string? _transitionReason = "initial state";
    private TaskbarRecoveryCircuitSnapshot _recovery;

    public TaskbarModeService()
    {
        var persistedMode = LoadMode(out var settingsFileExists);
        _requestedMode = ResolveInitialMode(persistedMode, settingsFileExists);

        if (settingsFileExists && persistedMode is null)
        {
            _configurationFallbackReason =
                "Invalid taskbar mode settings were ignored; native taskbar fallback is active.";
            _fallbackReason = _configurationFallbackReason;
        }

        if (IsSafeModeEnabled())
        {
            _fallbackReason = "JARVIS_KEEP_NATIVE_TASKBAR=1 keeps the native Windows taskbar active.";
        }
    }

    public event Action? RequestedModeChanged;

    public event Action<TaskbarModeState>? StateChanged;

    public event Action? RetryRequested;

    public TaskbarMode RequestedMode
    {
        get
        {
            lock (_gate)
            {
                return _requestedMode;
            }
        }
    }

    public TaskbarModeState GetState()
    {
        lock (_gate)
        {
            return CreateState();
        }
    }

    public TaskbarModeState SetRequestedMode(string value)
    {
        if (!TryParseMode(value, out var mode))
        {
            throw new ArgumentException(
                "Taskbar mode must be native, hybrid, or full.",
                nameof(value));
        }

        var changed = false;
        TaskbarModeState state;
        lock (_gate)
        {
            changed = _requestedMode != mode;
            _requestedMode = mode;
            _configurationFallbackReason = null;
            _fallbackReason = null;
            SaveMode(mode);
            state = CreateState();
        }

        if (changed)
        {
            RequestedModeChanged?.Invoke();
            state = GetState();
            StateChanged?.Invoke(state);
        }

        return state;
    }

    public TaskbarModeState BeginTransition(
        long generation,
        string reason,
        TaskbarRecoveryCircuitSnapshot recovery)
    {
        if (generation <= 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(generation),
                "Taskbar transition generations must be positive.");
        }

        TaskbarModeState state;
        var changed = false;
        lock (_gate)
        {
            if (generation <= _transitionGeneration)
            {
                return CreateState();
            }

            var normalizedReason = NormalizeTransitionReason(reason);
            changed = _transitionGeneration != generation ||
                      _transitionStatus != TaskbarTransitionStatus.Applying ||
                      !string.Equals(
                          _transitionReason,
                          normalizedReason,
                          StringComparison.Ordinal) ||
                      _fallbackReason is not null ||
                      _recovery != recovery;
            _transitionGeneration = generation;
            _transitionStatus = TaskbarTransitionStatus.Applying;
            _transitionReason = normalizedReason;
            _fallbackReason = null;
            _recovery = recovery;
            state = CreateState();
        }

        if (changed)
        {
            StateChanged?.Invoke(state);
        }

        return state;
    }

    public TaskbarModeState ReportEffectiveMode(
        long generation,
        TaskbarMode effectiveMode,
        bool hybridAvailable,
        string? fallbackReason,
        string transitionReason,
        TaskbarRecoveryCircuitSnapshot recovery)
    {
        TaskbarModeState state;
        var changed = false;
        lock (_gate)
        {
            if (generation != _transitionGeneration)
            {
                return CreateState();
            }

            var normalizedFallbackReason = string.IsNullOrWhiteSpace(fallbackReason)
                ? _configurationFallbackReason
                : fallbackReason.Trim();
            var normalizedTransitionReason = NormalizeTransitionReason(transitionReason);
            var transitionStatus = ResolveTransitionStatus(
                _requestedMode,
                effectiveMode,
                normalizedFallbackReason,
                recovery);
            changed = _effectiveMode != effectiveMode ||
                      _hybridAvailable != hybridAvailable ||
                      !string.Equals(
                          _fallbackReason,
                          normalizedFallbackReason,
                          StringComparison.Ordinal) ||
                      _transitionStatus != transitionStatus ||
                      !string.Equals(
                          _transitionReason,
                          normalizedTransitionReason,
                          StringComparison.Ordinal) ||
                      _recovery != recovery;
            _effectiveMode = effectiveMode;
            _hybridAvailable = hybridAvailable;
            _fallbackReason = normalizedFallbackReason;
            _transitionStatus = transitionStatus;
            _transitionReason = normalizedTransitionReason;
            _recovery = recovery;
            state = CreateState();
        }

        if (changed)
        {
            StateChanged?.Invoke(state);
        }

        return state;
    }

    public TaskbarModeState RequestRetry()
    {
        lock (_gate)
        {
            if (IsSafeModeEnabled())
            {
                throw new InvalidOperationException(
                    "Taskbar retry is unavailable while native-taskbar safety mode is active.");
            }

            if (_transitionStatus == TaskbarTransitionStatus.Applying)
            {
                throw new InvalidOperationException(
                    "A taskbar transition is already in progress.");
            }

            if (_recovery.RetryAfterUtc is { } retryAfterUtc &&
                retryAfterUtc > DateTimeOffset.UtcNow)
            {
                throw new InvalidOperationException(
                    $"Taskbar retry is cooling down until {retryAfterUtc:O}.");
            }

            if (_requestedMode == _effectiveMode)
            {
                throw new InvalidOperationException(
                    "The requested taskbar mode is already active.");
            }
        }

        RetryRequested?.Invoke();
        var state = GetState();
        StateChanged?.Invoke(state);
        return state;
    }

    public TaskbarModeState ReportRecoverySnapshot(
        long generation,
        TaskbarRecoveryCircuitSnapshot recovery)
    {
        TaskbarModeState state;
        var changed = false;
        lock (_gate)
        {
            if (generation != _transitionGeneration)
            {
                return CreateState();
            }

            changed = _recovery != recovery;
            _recovery = recovery;
            state = CreateState();
        }

        if (changed)
        {
            StateChanged?.Invoke(state);
        }

        return state;
    }

    public static string ToWireValue(TaskbarMode mode) =>
        mode.ToString().ToLowerInvariant();

    public static bool TryParseMode(string? value, out TaskbarMode mode)
    {
        switch (value?.Trim().ToLowerInvariant())
        {
            case "native":
                mode = TaskbarMode.Native;
                return true;
            case "hybrid":
                mode = TaskbarMode.Hybrid;
                return true;
            case "full":
                mode = TaskbarMode.Full;
                return true;
            default:
                mode = TaskbarMode.Native;
                return false;
        }
    }

    internal static TaskbarTransitionStatus ResolveTransitionStatus(
        TaskbarMode requestedMode,
        TaskbarMode effectiveMode,
        string? fallbackReason,
        TaskbarRecoveryCircuitSnapshot recovery) =>
        recovery.IsOpen && requestedMode != TaskbarMode.Native
            ? TaskbarTransitionStatus.Cooldown
            : !string.IsNullOrWhiteSpace(fallbackReason) ||
              effectiveMode != requestedMode
                ? TaskbarTransitionStatus.Fallback
                : TaskbarTransitionStatus.Settled;

    internal static TaskbarMode ResolveInitialMode(
        TaskbarMode? persistedMode,
        bool settingsFileExists) =>
        persistedMode ??
        (settingsFileExists ? TaskbarMode.Native : TaskbarMode.Hybrid);

    private TaskbarModeState CreateState()
    {
        var safeMode = IsSafeModeEnabled();
        var transitionStatus = _transitionStatus;
        var retryAllowed = !safeMode &&
                           transitionStatus != TaskbarTransitionStatus.Applying &&
                           _requestedMode != _effectiveMode &&
                           (_recovery.RetryAfterUtc is null ||
                            _recovery.RetryAfterUtc <= DateTimeOffset.UtcNow);
        if (transitionStatus == TaskbarTransitionStatus.Cooldown && retryAllowed)
        {
            transitionStatus = TaskbarTransitionStatus.Fallback;
        }

        return new TaskbarModeState(
            ToWireValue(_requestedMode),
            ToWireValue(_effectiveMode),
            _fallbackReason,
            _hybridAvailable,
            safeMode,
            transitionStatus.ToString().ToLowerInvariant(),
            _transitionGeneration,
            _transitionReason,
            retryAllowed,
            _recovery.FailureCount,
            _recovery.RetryAfterUtc);
    }

    private static string NormalizeTransitionReason(string reason) =>
        string.IsNullOrWhiteSpace(reason) ? "unspecified" : reason.Trim();

    private static TaskbarMode? LoadMode(out bool settingsFileExists)
    {
        settingsFileExists = File.Exists(SettingsPath);
        if (!settingsFileExists)
        {
            return null;
        }

        try
        {
            var settings = JsonSerializer.Deserialize<TaskbarModeSettings>(
                File.ReadAllText(SettingsPath),
                JsonOptions);
            return TryParseMode(settings?.Mode, out var mode) ? mode : null;
        }
        catch (Exception ex) when (
            ex is IOException or UnauthorizedAccessException or JsonException)
        {
            HostLog.Warning($"Taskbar mode settings could not be read: {ex.Message}");
            return null;
        }
    }

    private static void SaveMode(TaskbarMode mode)
    {
        var temporaryPath = SettingsPath + ".tmp";
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
            File.WriteAllText(
                temporaryPath,
                JsonSerializer.Serialize(
                    new TaskbarModeSettings(ToWireValue(mode)),
                    JsonOptions));
            File.Move(temporaryPath, SettingsPath, overwrite: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            HostLog.Warning($"Taskbar mode settings could not be saved: {ex.Message}");
            try
            {
                File.Delete(temporaryPath);
            }
            catch
            {
                // A stale temporary settings file is harmless and can be replaced later.
            }
        }
    }

    private static bool IsSafeModeEnabled() =>
        Environment.GetEnvironmentVariable("JARVIS_KEEP_NATIVE_TASKBAR") == "1";

    private sealed record TaskbarModeSettings(string Mode);
}

internal sealed record TaskbarModeState(
    string RequestedMode,
    string EffectiveMode,
    string? FallbackReason,
    bool HybridAvailable,
    bool SafeMode,
    string TransitionStatus,
    long TransitionGeneration,
    string? TransitionReason,
    bool RetryAllowed,
    int RecoveryFailureCount,
    DateTimeOffset? RetryAfterUtc);
