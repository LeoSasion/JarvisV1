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
            StateChanged?.Invoke(state);
        }

        return state;
    }

    public TaskbarModeState ReportEffectiveMode(
        TaskbarMode effectiveMode,
        bool hybridAvailable,
        string? fallbackReason)
    {
        TaskbarModeState state;
        var changed = false;
        lock (_gate)
        {
            var normalizedFallbackReason = string.IsNullOrWhiteSpace(fallbackReason)
                ? _configurationFallbackReason
                : fallbackReason.Trim();
            changed = _effectiveMode != effectiveMode ||
                      _hybridAvailable != hybridAvailable ||
                      !string.Equals(
                          _fallbackReason,
                          normalizedFallbackReason,
                          StringComparison.Ordinal);
            _effectiveMode = effectiveMode;
            _hybridAvailable = hybridAvailable;
            _fallbackReason = normalizedFallbackReason;
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

    internal static TaskbarMode ResolveInitialMode(
        TaskbarMode? persistedMode,
        bool settingsFileExists) =>
        persistedMode ??
        (settingsFileExists ? TaskbarMode.Native : TaskbarMode.Full);

    private TaskbarModeState CreateState() => new(
        ToWireValue(_requestedMode),
        ToWireValue(_effectiveMode),
        _fallbackReason,
        _hybridAvailable,
        IsSafeModeEnabled());

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
    bool SafeMode);
