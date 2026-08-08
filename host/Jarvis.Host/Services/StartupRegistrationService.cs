using System.Diagnostics;
using System.IO;
using Jarvis.Host.Infrastructure;
using Microsoft.Win32;

namespace Jarvis.Host.Services;

internal sealed class StartupRegistrationService
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string StartupValueName = "JARVIS";
    private const string LegacyStartupValueName = "JARVIS Night Shell";

    public RuntimeSettingsSnapshot Capture()
    {
        var executablePath = GetExecutablePath();
        var expectedCommand = BuildStartupCommand(executablePath);
        var configuredCommand = ReadConfiguredCommand();
        var enabled = !string.IsNullOrWhiteSpace(configuredCommand);

        return new RuntimeSettingsSnapshot(
            ProductName: "JARVIS",
            Version: GetProductVersion(),
            BuildConfiguration: GetBuildConfiguration(),
            ExecutablePath: executablePath,
            StartupEnabled: enabled,
            StartupCommandCurrent: enabled &&
                                   configuredCommand!.Equals(
                                       expectedCommand,
                                       StringComparison.OrdinalIgnoreCase),
            StartupCommand: configuredCommand);
    }

    public RuntimeSettingsSnapshot SetStartupEnabled(bool enabled)
    {
        var executablePath = GetExecutablePath();
        using var runKey = Registry.CurrentUser.CreateSubKey(RunKeyPath, writable: true)
            ?? throw new InvalidOperationException("Windows startup settings are unavailable for this user.");

        if (enabled)
        {
            runKey.SetValue(
                StartupValueName,
                BuildStartupCommand(executablePath),
                RegistryValueKind.String);
            runKey.DeleteValue(LegacyStartupValueName, throwOnMissingValue: false);
            HostLog.Info($"Current-user startup registration enabled for {executablePath}.");
        }
        else
        {
            runKey.DeleteValue(StartupValueName, throwOnMissingValue: false);
            runKey.DeleteValue(LegacyStartupValueName, throwOnMissingValue: false);
            HostLog.Info("Current-user startup registration disabled.");
        }

        return Capture();
    }

    private static string GetExecutablePath()
    {
        var executablePath = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(executablePath) || !Path.IsPathFullyQualified(executablePath))
        {
            throw new InvalidOperationException("JARVIS could not resolve its executable path.");
        }

        return Path.GetFullPath(executablePath);
    }

    private static string BuildStartupCommand(string executablePath) =>
        $"\"{executablePath}\" --startup";

    private static string? ReadConfiguredCommand()
    {
        using var runKey = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: false);
        return runKey?.GetValue(StartupValueName, null, RegistryValueOptions.DoNotExpandEnvironmentNames)
            as string
            ?? runKey?.GetValue(LegacyStartupValueName, null, RegistryValueOptions.DoNotExpandEnvironmentNames)
                as string;
    }

    private static string GetProductVersion()
    {
        var executablePath = GetExecutablePath();
        var version = FileVersionInfo.GetVersionInfo(executablePath).ProductVersion;
        return string.IsNullOrWhiteSpace(version) ? "0.0.0" : version;
    }

    private static string GetBuildConfiguration()
    {
#if DEBUG
        return "DEBUG";
#else
        return "RELEASE";
#endif
    }
}

internal sealed record RuntimeSettingsSnapshot(
    string ProductName,
    string Version,
    string BuildConfiguration,
    string ExecutablePath,
    bool StartupEnabled,
    bool StartupCommandCurrent,
    string? StartupCommand);
