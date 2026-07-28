using System.IO;
using System.Text.Json;
using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Services;

internal sealed class QuickSearchShortcutSettingsService
{
    private static readonly string DefaultSettingsPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "JARVIS",
        "Settings",
        "quick-search-shortcut.json");

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private readonly object _gate = new();
    private readonly string _settingsPath;
    private readonly Action<string> _warningSink;
    private bool _enabled;
    private bool _runtimeStarting;
    private string? _configurationWarning;

    public QuickSearchShortcutSettingsService(
        string? settingsPath = null,
        Action<string>? warningSink = null)
    {
        _settingsPath = string.IsNullOrWhiteSpace(settingsPath)
            ? DefaultSettingsPath
            : Path.GetFullPath(settingsPath);
        _warningSink = warningSink ?? HostLog.Warning;
        _enabled = LoadEnabled(
            _settingsPath,
            _warningSink,
            out _configurationWarning);
    }

    public event Action? EnabledChanged;

    public bool Enabled
    {
        get
        {
            lock (_gate)
            {
                return _enabled;
            }
        }
    }

    public QuickSearchShortcutState GetState()
    {
        bool enabled;
        bool runtimeStarting;
        string? configurationWarning;
        lock (_gate)
        {
            enabled = _enabled;
            runtimeStarting = _runtimeStarting;
            configurationWarning = _configurationWarning;
        }

        if (!enabled)
        {
            return new QuickSearchShortcutState(
                Enabled: false,
                Registered: false,
                Status: "disabled",
                Shortcut: "Ctrl+Alt+J",
                FailureReason: null,
                ConfigurationWarning: configurationWarning);
        }

        if (runtimeStarting)
        {
            return new QuickSearchShortcutState(
                Enabled: true,
                Registered: false,
                Status: "starting",
                Shortcut: "Ctrl+Alt+J",
                FailureReason: null,
                ConfigurationWarning: configurationWarning);
        }

        var hotkey = GlobalQuickSearchHotkey.CaptureStatus();
        return new QuickSearchShortcutState(
            Enabled: true,
            Registered: hotkey.Registered,
            Status: hotkey.Registered ? "registered" : "unavailable",
            Shortcut: "Ctrl+Alt+J",
            FailureReason: hotkey.FailureReason,
            ConfigurationWarning: configurationWarning);
    }

    public QuickSearchShortcutState SetEnabled(bool enabled)
    {
        bool changed;
        lock (_gate)
        {
            SaveEnabled(_settingsPath, enabled, _warningSink);
            changed = _enabled != enabled;
            _enabled = enabled;
            if (!enabled)
            {
                _runtimeStarting = false;
            }
            _configurationWarning = null;
        }

        var retryRequested = enabled &&
                             !GlobalQuickSearchHotkey.CaptureStatus().Registered;
        if (changed || retryRequested)
        {
            EnabledChanged?.Invoke();
        }

        return GetState();
    }

    public void ReportRuntimeStarting()
    {
        lock (_gate)
        {
            _runtimeStarting = _enabled;
        }
    }

    public void ReportRuntimeSettled()
    {
        lock (_gate)
        {
            _runtimeStarting = false;
        }
    }

    private static bool LoadEnabled(
        string settingsPath,
        Action<string> warningSink,
        out string? configurationWarning)
    {
        configurationWarning = null;
        if (!File.Exists(settingsPath))
        {
            return true;
        }

        try
        {
            var settings = JsonSerializer.Deserialize<QuickSearchShortcutSettings>(
                File.ReadAllText(settingsPath),
                JsonOptions);
            if (settings is not null)
            {
                return settings.Enabled;
            }
        }
        catch (Exception exception) when (
            exception is IOException or UnauthorizedAccessException or JsonException)
        {
            configurationWarning =
                "The saved Quick Search shortcut setting could not be read; the shortcut defaulted to enabled.";
            warningSink(
                $"Quick Search shortcut settings could not be read: {exception.Message}");
            return true;
        }

        configurationWarning =
            "The saved Quick Search shortcut setting was invalid; the shortcut defaulted to enabled.";
        warningSink(
            "Quick Search shortcut settings were empty or invalid; enabled fallback applied.");
        return true;
    }

    private static void SaveEnabled(
        string settingsPath,
        bool enabled,
        Action<string> warningSink)
    {
        var temporaryPath = settingsPath + ".tmp";
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(settingsPath)!);
            File.WriteAllText(
                temporaryPath,
                JsonSerializer.Serialize(
                    new QuickSearchShortcutSettings(enabled),
                    JsonOptions));
            File.Move(temporaryPath, settingsPath, overwrite: true);
        }
        catch (Exception exception) when (
            exception is IOException or UnauthorizedAccessException)
        {
            warningSink(
                $"Quick Search shortcut settings could not be saved: {exception.Message}");
            try
            {
                File.Delete(temporaryPath);
            }
            catch
            {
                // A stale temporary file is harmless and can be replaced later.
            }

            throw;
        }
    }

    private sealed record QuickSearchShortcutSettings(bool Enabled);
}

internal sealed record QuickSearchShortcutState(
    bool Enabled,
    bool Registered,
    string Status,
    string Shortcut,
    string? FailureReason,
    string? ConfigurationWarning);
