using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using Jarvis.Host.Bridge;

namespace Jarvis.Host.Services;

internal sealed partial class ShellService : IDisposable
{
    private const int MaxTargetLength = 2048;

    private static readonly IReadOnlyDictionary<string, string> AllowedApplications =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["calc.exe"] = "calc.exe",
        ["code"] = "Code.exe",
        ["code.exe"] = "Code.exe",
        ["control.exe"] = "control.exe",
        ["explorer.exe"] = "explorer.exe",
        ["mspaint.exe"] = "mspaint.exe",
        ["notepad.exe"] = "notepad.exe",
        ["powershell.exe"] = "powershell.exe",
        ["pwsh.exe"] = "pwsh.exe",
        ["taskmgr.exe"] = "taskmgr.exe",
        ["wt.exe"] = "wt.exe"
    };

    private readonly DesktopService _desktopService;
    private readonly StartMenuApplicationService _startMenuApplications = new();

    public ShellService(DesktopService desktopService)
    {
        _desktopService = desktopService;
    }

    public StartMenuApplicationCatalog ListApplications() =>
        _startMenuApplications.ListApplications();

    public StartMenuApplicationCatalog RefreshApplications() =>
        _startMenuApplications.RefreshApplications();

    public event EventHandler<StartMenuApplicationCatalog> ApplicationCatalogChanged
    {
        add => _startMenuApplications.CatalogChanged += value;
        remove => _startMenuApplications.CatalogChanged -= value;
    }

    public StartMenuApplicationOpenResult OpenApplication(string applicationId) =>
        _startMenuApplications.OpenApplication(applicationId);

    public ShellOpenResult Open(string target)
    {
        var safeTarget = NormalizeTarget(target);
        try
        {
            using var process = Process.Start(new ProcessStartInfo
            {
                FileName = safeTarget,
                UseShellExecute = true,
                Verb = "open",
                WindowStyle = ProcessWindowStyle.Normal
            });

            return new ShellOpenResult(true, safeTarget, process?.Id);
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            throw new BridgeFaultException("OPEN_FAILED", $"Windows could not open the requested target: {ex.Message}");
        }
    }

    private string NormalizeTarget(string target)
    {
        var trimmed = target.Trim();
        if (trimmed.Length == 0 || trimmed.Length > MaxTargetLength ||
            trimmed.IndexOfAny(['\0', '\r', '\n']) >= 0)
        {
            throw new BridgeFaultException("INVALID_TARGET", "The shell target is empty or malformed.");
        }

        if (Path.IsPathRooted(trimmed))
        {
            var fullPath = Path.GetFullPath(trimmed);
            if (fullPath.StartsWith(@"\\", StringComparison.Ordinal))
            {
                throw new BridgeFaultException(
                    "TARGET_NOT_ALLOWED",
                    "Network shares and Windows device paths cannot be opened from JARVIS.");
            }

            if (!File.Exists(fullPath) && !Directory.Exists(fullPath))
            {
                throw new BridgeFaultException("TARGET_NOT_FOUND", "The requested path does not exist.");
            }

            if (!_desktopService.IsListedEntry(fullPath))
            {
                throw new BridgeFaultException(
                    "TARGET_NOT_ALLOWED",
                    "Only items currently listed by the JARVIS desktop can be opened by path.");
            }

            var attributes = File.GetAttributes(fullPath);
            if (attributes.HasFlag(FileAttributes.ReparsePoint))
            {
                throw new BridgeFaultException(
                    "TARGET_NOT_ALLOWED",
                    "Linked file-system paths cannot be opened from JARVIS.");
            }

            if (!attributes.HasFlag(FileAttributes.Directory) &&
                !SafeFileTypes.IsOpenable(Path.GetExtension(fullPath)))
            {
                throw new BridgeFaultException(
                    "TARGET_NOT_ALLOWED",
                    "Only approved document, media, and archive types can be opened from the JARVIS desktop; applications and active content require an explicit capability.");
            }

            return fullPath;
        }

        if (AllowedApplications.TryGetValue(trimmed, out var application))
        {
            return application;
        }

        if (TryNormalizeAllowedUri(trimmed, out var uri))
        {
            return uri;
        }

        throw new BridgeFaultException(
            "TARGET_NOT_ALLOWED",
            "Only listed desktop items, approved Windows applications, HTTPS links, and ms-settings links can be opened.");
    }

    private static bool TryNormalizeAllowedUri(string target, out string normalized)
    {
        normalized = string.Empty;

        if (target.StartsWith("ms-settings:", StringComparison.OrdinalIgnoreCase))
        {
            if (!MsSettingsUriPattern().IsMatch(target))
            {
                return false;
            }

            normalized = target;
            return true;
        }

        if (!Uri.TryCreate(target, UriKind.Absolute, out var uri) ||
            !uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        normalized = uri.AbsoluteUri;
        return true;
    }

    [GeneratedRegex(@"\Ams-settings:[A-Za-z0-9?&=._%:/-]*\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex MsSettingsUriPattern();

    public void Dispose() => _startMenuApplications.Dispose();
}

internal sealed record ShellOpenResult(bool Opened, string Target, int? ProcessId);
