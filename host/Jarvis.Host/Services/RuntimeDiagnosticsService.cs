using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Jarvis.Host.Infrastructure;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace Jarvis.Host.Services;

internal sealed partial class RuntimeDiagnosticsService
{
    private const string UninstallKeyPath =
        @"Software\Microsoft\Windows\CurrentVersion\Uninstall\{3D127645-F2E2-4F10-A50F-A4E4B71CE06E}_is1";

    private readonly StartupRegistrationService _startupRegistrationService;
    private readonly NativeWindowAppearanceService? _windowAppearanceService;
    private readonly RuntimeSnapshotFeed? _snapshotFeed;

    public RuntimeDiagnosticsService(
        StartupRegistrationService startupRegistrationService,
        NativeWindowAppearanceService? windowAppearanceService = null,
        RuntimeSnapshotFeed? snapshotFeed = null)
    {
        _startupRegistrationService = startupRegistrationService;
        _windowAppearanceService = windowAppearanceService;
        _snapshotFeed = snapshotFeed;
    }

    public RuntimeInfoSnapshot CaptureRuntimeInfo()
    {
        var startup = _startupRegistrationService.Capture();
        var installationMode = DetectInstallationMode(startup.ExecutablePath);

        return new RuntimeInfoSnapshot(
            startup.ProductName,
            startup.Version,
            startup.BuildConfiguration,
            startup.ExecutablePath,
            startup.StartupEnabled,
            startup.StartupCommandCurrent,
            startup.StartupCommand,
            installationMode,
            Environment.OSVersion.VersionString,
            GetWebView2Version() ?? "UNAVAILABLE",
            IsSafeModeEnabled(),
            IsRecoveryReady());
    }

    public RuntimeInfoSnapshot SetStartupEnabled(bool enabled)
    {
        _startupRegistrationService.SetStartupEnabled(enabled);
        return CaptureRuntimeInfo();
    }

    public RuntimeDiagnosticsSnapshot RunDiagnostics()
    {
        var runtime = CaptureRuntimeInfo();
        var checks = new List<RuntimeDiagnosticCheck>();

        AddRecoveryCheck(checks);
        AddTaskbarSynchronizationCheck(checks);
        AddSafetyHotkeyCheck(checks);
        AddNativeWindowAppearanceCheck(checks);
        AddWebView2Check(checks, runtime.WebView2Version);
        AddInstallationCheck(checks, runtime);
        AddStartupCheck(checks, runtime);
        AddPackageIntegrityCheck(checks, runtime);

        var overallStatus = checks.Any(check => check.Status == DiagnosticStatus.Failed)
            ? DiagnosticStatus.Failed
            : checks.Any(check => check.Status == DiagnosticStatus.Attention)
                ? DiagnosticStatus.Attention
                : DiagnosticStatus.Ready;

        var snapshot = new RuntimeDiagnosticsSnapshot(
            overallStatus,
            checks.Sum(check => check.VerifiedFiles),
            DateTimeOffset.Now,
            checks);
        HostLog.Info(
            $"Runtime diagnostics completed with {overallStatus}; " +
            $"{snapshot.VerifiedFiles} package files verified.");
        return snapshot;
    }

    private void AddTaskbarSynchronizationCheck(ICollection<RuntimeDiagnosticCheck> checks)
    {
        if (_snapshotFeed is null)
        {
            checks.Add(new RuntimeDiagnosticCheck(
                "taskbar-synchronization",
                "TASKBAR SYNCHRONIZATION",
                DiagnosticStatus.Attention,
                "Taskbar synchronization diagnostics are unavailable; polling status could not be verified.",
                0));
            return;
        }

        var feed = _snapshotFeed.CaptureTaskbarDiagnostics();
        var eventDriven = feed.EventHookCount > 0;
        var completeEventCoverage = feed.EventHookCount == feed.ExpectedEventHookCount;
        var available = feed.PollingActive || eventDriven;
        var status = !available
            ? DiagnosticStatus.Failed
            : completeEventCoverage
                ? DiagnosticStatus.Ready
                : DiagnosticStatus.Attention;
        var detail = completeEventCoverage
            ? $"{feed.EventHookCount}/{feed.ExpectedEventHookCount} Windows event hooks are active with " +
              $"{feed.EventDebounceMilliseconds} ms coalescing; " +
              $"{feed.PollingIntervalMilliseconds} ms polling remains as recovery fallback."
            : eventDriven && feed.PollingActive
                ? $"Only {feed.EventHookCount}/{feed.ExpectedEventHookCount} Windows event hooks are active; " +
                  $"{feed.PollingIntervalMilliseconds} ms polling covers missing event ranges."
                : feed.PollingActive
                ? $"Windows event hooks are unavailable; " +
                  $"{feed.PollingIntervalMilliseconds} ms polling fallback is active."
                : "Neither Windows event hooks nor the polling fallback are active.";

        checks.Add(new RuntimeDiagnosticCheck(
            "taskbar-synchronization",
            "TASKBAR SYNCHRONIZATION",
            status,
            detail,
            0));
    }

    private static void AddRecoveryCheck(ICollection<RuntimeDiagnosticCheck> checks)
    {
        var explorerRunning = Process.GetProcessesByName("explorer").Length > 0;
        var nativeTaskbarVisible = NativeTaskbarController.IsPrimaryVisible();
        var ownsRecoveryLease = NativeTaskbarController.OwnsVisibilityLease;
        var ready = explorerRunning && (nativeTaskbarVisible || ownsRecoveryLease);
        var detail = !explorerRunning
            ? "Explorer is not running; automatic taskbar recovery is unavailable."
            : ownsRecoveryLease
                ? "Explorer is running and the watchdog-backed taskbar restore lease is armed."
                : nativeTaskbarVisible
                    ? "Explorer and the native Windows taskbar are available."
                    : "Explorer is running, but the native primary taskbar could not be verified.";

        checks.Add(new RuntimeDiagnosticCheck(
            "windows-recovery",
            "WINDOWS RECOVERY",
            ready ? DiagnosticStatus.Ready : DiagnosticStatus.Failed,
            detail,
            0));
    }

    private static void AddSafetyHotkeyCheck(ICollection<RuntimeDiagnosticCheck> checks)
    {
        var hotkey = GlobalSafetyHotkey.CaptureStatus();
        checks.Add(new RuntimeDiagnosticCheck(
            "global-safety-hotkey",
            "GLOBAL SAFETY EXIT",
            hotkey.Registered ? DiagnosticStatus.Ready : DiagnosticStatus.Attention,
            hotkey.Registered
                ? "Ctrl+Shift+Q is registered system-wide for safe JARVIS exit."
                : $"The system-wide safety shortcut is unavailable. {hotkey.FailureReason}",
            0));
    }

    private void AddNativeWindowAppearanceCheck(ICollection<RuntimeDiagnosticCheck> checks)
    {
        if (_windowAppearanceService is null)
        {
            checks.Add(new RuntimeDiagnosticCheck(
                "native-window-appearance",
                "WINDOW APPEARANCE",
                DiagnosticStatus.Attention,
                "The native appearance service is unavailable to runtime diagnostics.",
                0));
            return;
        }

        var appearance = _windowAppearanceService.CaptureDiagnostics();
        var status = !appearance.Ready
            ? DiagnosticStatus.Failed
            : string.IsNullOrWhiteSpace(appearance.FallbackReason)
                ? DiagnosticStatus.Ready
                : DiagnosticStatus.Attention;
        var detail = string.IsNullOrWhiteSpace(appearance.FallbackReason)
            ? appearance.Detail
            : $"{appearance.Detail} Fallback: {appearance.FallbackReason}";
        checks.Add(new RuntimeDiagnosticCheck(
            "native-window-appearance",
            "WINDOW APPEARANCE",
            status,
            detail,
            0));
    }

    private static void AddWebView2Check(
        ICollection<RuntimeDiagnosticCheck> checks,
        string webView2Version)
    {
        var available = !webView2Version.Equals("UNAVAILABLE", StringComparison.OrdinalIgnoreCase);
        checks.Add(new RuntimeDiagnosticCheck(
            "webview2",
            "WEBVIEW2 RUNTIME",
            available ? DiagnosticStatus.Ready : DiagnosticStatus.Failed,
            available ? $"Evergreen runtime {webView2Version}." : "Microsoft Edge WebView2 Runtime is unavailable.",
            0));
    }

    private static void AddInstallationCheck(
        ICollection<RuntimeDiagnosticCheck> checks,
        RuntimeInfoSnapshot runtime)
    {
        if (!runtime.InstallationMode.Equals("INSTALLED", StringComparison.Ordinal))
        {
            checks.Add(new RuntimeDiagnosticCheck(
                "installation",
                "INSTALLATION MODE",
                DiagnosticStatus.Ready,
                $"{runtime.InstallationMode} mode does not require an installer registration.",
                0));
            return;
        }

        using var uninstallKey = Registry.CurrentUser.OpenSubKey(UninstallKeyPath, writable: false);
        var installLocation = uninstallKey?.GetValue("InstallLocation") as string;
        var executableDirectory = Path.GetDirectoryName(runtime.ExecutablePath);
        var registered = !string.IsNullOrWhiteSpace(installLocation) &&
                         !string.IsNullOrWhiteSpace(executableDirectory) &&
                         PathsEqual(installLocation, executableDirectory);

        checks.Add(new RuntimeDiagnosticCheck(
            "installation",
            "INSTALLATION RECORD",
            registered ? DiagnosticStatus.Ready : DiagnosticStatus.Attention,
            registered
                ? "The current-user installer registration matches the active executable."
                : "The executable is in the installed location, but its uninstall registration is missing or stale.",
            0));
    }

    private static void AddStartupCheck(
        ICollection<RuntimeDiagnosticCheck> checks,
        RuntimeInfoSnapshot runtime)
    {
        var status = runtime.StartupEnabled && !runtime.StartupCommandCurrent
            ? DiagnosticStatus.Attention
            : DiagnosticStatus.Ready;
        var detail = runtime.StartupEnabled
            ? runtime.StartupCommandCurrent
                ? "The current-user startup command points to this executable."
                : "The saved startup command points to a different JARVIS executable."
            : "Automatic startup is disabled; manual start is configured.";

        checks.Add(new RuntimeDiagnosticCheck(
            "startup",
            "SIGN-IN STARTUP",
            status,
            detail,
            0));
    }

    private static void AddPackageIntegrityCheck(
        ICollection<RuntimeDiagnosticCheck> checks,
        RuntimeInfoSnapshot runtime)
    {
        var executableDirectory = Path.GetDirectoryName(runtime.ExecutablePath)
            ?? throw new InvalidOperationException("The active executable directory is unavailable.");
        var manifestPath = Path.Combine(executableDirectory, "SHA256SUMS.txt");
        if (!File.Exists(manifestPath))
        {
            checks.Add(new RuntimeDiagnosticCheck(
                "package-integrity",
                "PACKAGE INTEGRITY",
                runtime.InstallationMode.Equals("DEVELOPMENT", StringComparison.Ordinal)
                    ? DiagnosticStatus.Ready
                    : DiagnosticStatus.Attention,
                runtime.InstallationMode.Equals("DEVELOPMENT", StringComparison.Ordinal)
                    ? "Development builds do not include a release checksum manifest."
                    : "SHA256SUMS.txt is missing; package integrity cannot be verified.",
                0));
            return;
        }

        var failures = new List<string>();
        var manifestEntries = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var verifiedFiles = 0;
        var rootPrefix = Path.GetFullPath(executableDirectory).TrimEnd(Path.DirectorySeparatorChar) +
                         Path.DirectorySeparatorChar;

        foreach (var line in File.ReadLines(manifestPath))
        {
            var match = ChecksumLine().Match(line);
            if (!match.Success)
            {
                failures.Add("Malformed checksum entry");
                continue;
            }

            var manifestRelativePath = match.Groups[2].Value.Replace('\\', '/');
            if (!manifestEntries.Add(manifestRelativePath))
            {
                failures.Add($"Duplicate entry: {manifestRelativePath}");
                continue;
            }

            var relativePath = manifestRelativePath.Replace('/', Path.DirectorySeparatorChar);
            var targetPath = Path.GetFullPath(Path.Combine(executableDirectory, relativePath));
            if (!targetPath.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase) ||
                !File.Exists(targetPath))
            {
                failures.Add(relativePath);
                continue;
            }

            using var stream = new FileStream(
                targetPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete);
            var actual = Convert.ToHexString(SHA256.HashData(stream));
            if (!actual.Equals(match.Groups[1].Value, StringComparison.OrdinalIgnoreCase))
            {
                failures.Add(relativePath);
                continue;
            }

            verifiedFiles++;
        }

        foreach (var filePath in Directory.EnumerateFiles(
                     executableDirectory,
                     "*",
                     SearchOption.AllDirectories))
        {
            var relativePath = Path.GetRelativePath(executableDirectory, filePath).Replace('\\', '/');
            if (relativePath.Equals("SHA256SUMS.txt", StringComparison.OrdinalIgnoreCase) ||
                manifestEntries.Contains(relativePath) ||
                InstallerGeneratedFile().IsMatch(relativePath))
            {
                continue;
            }

            failures.Add($"Unexpected file: {relativePath}");
        }

        checks.Add(new RuntimeDiagnosticCheck(
            "package-integrity",
            "PACKAGE INTEGRITY",
            failures.Count == 0 && verifiedFiles > 0
                ? DiagnosticStatus.Ready
                : DiagnosticStatus.Failed,
            failures.Count == 0 && verifiedFiles > 0
                ? $"Verified {verifiedFiles} packaged files against SHA-256."
                : $"Integrity verification failed for {failures.Count} package entries.",
            verifiedFiles));
    }

    private static string DetectInstallationMode(string executablePath)
    {
#if DEBUG
        return "DEVELOPMENT";
#else
        var installedRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs",
            "JARVIS");
        var normalizedRoot = Path.GetFullPath(installedRoot).TrimEnd(Path.DirectorySeparatorChar) +
                             Path.DirectorySeparatorChar;
        return Path.GetFullPath(executablePath).StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase)
            ? "INSTALLED"
            : "PORTABLE";
#endif
    }

    private static string? GetWebView2Version()
    {
        try
        {
            return CoreWebView2Environment.GetAvailableBrowserVersionString();
        }
        catch (Exception exception)
        {
            HostLog.Error("WebView2 version detection failed during runtime diagnostics.", exception);
            return null;
        }
    }

    private static bool IsSafeModeEnabled() =>
        Environment.GetEnvironmentVariable("JARVIS_KEEP_NATIVE_TASKBAR") == "1";

    private static bool IsRecoveryReady() =>
        Process.GetProcessesByName("explorer").Length > 0 &&
        (NativeTaskbarController.IsPrimaryVisible() || NativeTaskbarController.OwnsVisibilityLease);

    private static bool PathsEqual(string left, string right) =>
        Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar)
            .Equals(
                Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar),
                StringComparison.OrdinalIgnoreCase);

    [GeneratedRegex("^([0-9a-fA-F]{64})  (.+)$", RegexOptions.CultureInvariant)]
    private static partial Regex ChecksumLine();

    [GeneratedRegex(@"\Aunins\d{3}\.(?:dat|exe|msg)\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex InstallerGeneratedFile();
}

internal static class DiagnosticStatus
{
    public const string Ready = "READY";
    public const string Attention = "ATTENTION";
    public const string Failed = "FAILED";
}

internal sealed record RuntimeInfoSnapshot(
    string ProductName,
    string Version,
    string BuildConfiguration,
    string ExecutablePath,
    bool StartupEnabled,
    bool StartupCommandCurrent,
    string? StartupCommand,
    string InstallationMode,
    string WindowsVersion,
    string WebView2Version,
    bool SafeMode,
    bool RecoveryReady);

internal sealed record RuntimeDiagnosticsSnapshot(
    string OverallStatus,
    int VerifiedFiles,
    DateTimeOffset CheckedAt,
    IReadOnlyList<RuntimeDiagnosticCheck> Checks);

internal sealed record RuntimeDiagnosticCheck(
    string Id,
    string Label,
    string Status,
    string Detail,
    int VerifiedFiles);
