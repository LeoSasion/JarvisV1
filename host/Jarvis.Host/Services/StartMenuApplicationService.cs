using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using Jarvis.Host.Bridge;

namespace Jarvis.Host.Services;

internal sealed class StartMenuApplicationService
{
    private const int MaxApplications = 1_024;
    private static readonly TimeSpan CacheLifetime = TimeSpan.FromMinutes(5);

    private readonly object _gate = new();
    private readonly PackagedApplicationService _packagedApplications = new();
    private readonly Dictionary<string, ApplicationLaunchTarget> _launchTargets = new(StringComparer.Ordinal);
    private StartMenuApplicationCatalog? _cachedCatalog;
    private DateTimeOffset _cachedAtUtc;

    public StartMenuApplicationCatalog ListApplications()
    {
        lock (_gate)
        {
            var now = DateTimeOffset.UtcNow;
            if (_cachedCatalog is not null && now - _cachedAtUtc < CacheLifetime)
            {
                return _cachedCatalog;
            }

            var catalog = BuildCatalog(now);
            _cachedCatalog = catalog;
            _cachedAtUtc = now;
            return catalog;
        }
    }

    public StartMenuApplicationOpenResult OpenApplication(string applicationId)
    {
        if (string.IsNullOrWhiteSpace(applicationId) || applicationId.Length > 64)
        {
            throw new BridgeFaultException(
                "INVALID_APPLICATION_ID",
                "The Start menu application capability is malformed.");
        }

        _ = ListApplications();
        ApplicationLaunchTarget launchTarget;
        lock (_gate)
        {
            if (!_launchTargets.TryGetValue(applicationId, out launchTarget!))
            {
                throw new BridgeFaultException(
                    "APPLICATION_NOT_FOUND",
                    "The selected Start menu application is no longer in the current index.");
            }
        }

        return launchTarget.Kind switch
        {
            ApplicationLaunchKind.Shortcut => OpenShortcut(applicationId, launchTarget.Value),
            ApplicationLaunchKind.Packaged => OpenPackagedApplication(applicationId, launchTarget.Value),
            _ => throw new BridgeFaultException(
                "APPLICATION_NOT_ALLOWED",
                "The selected application capability has an unsupported launch type.")
        };
    }

    private StartMenuApplicationOpenResult OpenShortcut(string applicationId, string shortcutPath)
    {
        if (!IsTrustedShortcut(shortcutPath))
        {
            Invalidate();
            throw new BridgeFaultException(
                "APPLICATION_NOT_ALLOWED",
                "The selected Start menu shortcut is no longer inside an approved application directory.");
        }

        try
        {
            using var process = Process.Start(new ProcessStartInfo
            {
                FileName = shortcutPath,
                UseShellExecute = true,
                Verb = "open",
                WindowStyle = ProcessWindowStyle.Normal
            });

            return new StartMenuApplicationOpenResult(true, applicationId, process?.Id);
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            throw new BridgeFaultException(
                "OPEN_FAILED",
                $"Windows could not open the selected Start menu application: {ex.Message}");
        }
    }

    private StartMenuApplicationOpenResult OpenPackagedApplication(
        string applicationId,
        string appUserModelId)
    {
        if (!PackagedApplicationService.IsValidAppUserModelId(appUserModelId))
        {
            Invalidate();
            throw new BridgeFaultException(
                "APPLICATION_NOT_ALLOWED",
                "The selected Windows application capability is no longer valid.");
        }

        try
        {
            var processId = _packagedApplications.ActivateApplication(appUserModelId);
            return new StartMenuApplicationOpenResult(true, applicationId, processId);
        }
        catch (Exception ex) when (ex is COMException or InvalidCastException or InvalidOperationException or ArgumentException)
        {
            Invalidate();
            throw new BridgeFaultException(
                "OPEN_FAILED",
                $"Windows could not activate the selected packaged application: {ex.Message}");
        }
    }

    private StartMenuApplicationCatalog BuildCatalog(DateTimeOffset indexedAtUtc)
    {
        var roots = GetStartMenuRoots();
        var applications = new List<StartMenuApplication>();
        var applicationLabels = new HashSet<string>(StringComparer.CurrentCultureIgnoreCase);
        var nextTargets = new Dictionary<string, ApplicationLaunchTarget>(StringComparer.Ordinal);
        var truncated = false;
        var packagedSourceAvailable = false;
        var options = new EnumerationOptions
        {
            RecurseSubdirectories = true,
            IgnoreInaccessible = true,
            AttributesToSkip = FileAttributes.Hidden |
                               FileAttributes.System |
                               FileAttributes.ReparsePoint,
            MatchCasing = MatchCasing.CaseInsensitive,
            MaxRecursionDepth = 12
        };

        foreach (var root in roots)
        {
            IEnumerable<string> shortcuts;
            try
            {
                shortcuts = Directory.EnumerateFiles(root.Path, "*.lnk", options);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                continue;
            }

            try
            {
                foreach (var shortcut in shortcuts)
                {
                    if (applications.Count >= MaxApplications)
                    {
                        truncated = true;
                        break;
                    }

                    var fullPath = Path.GetFullPath(shortcut);
                    if (!IsPathInsideRoot(fullPath, root.Path))
                    {
                        continue;
                    }

                    var label = Path.GetFileNameWithoutExtension(fullPath);
                    if (IsExcludedShortcutLabel(label))
                    {
                        continue;
                    }

                    if (!applicationLabels.Add(label))
                    {
                        continue;
                    }

                    var applicationId = ApplicationCapabilityId.FromShortcutPath(fullPath);
                    if (!nextTargets.TryAdd(
                            applicationId,
                            new ApplicationLaunchTarget(ApplicationLaunchKind.Shortcut, fullPath)))
                    {
                        continue;
                    }

                    applications.Add(new StartMenuApplication(
                        applicationId,
                        label,
                        GetCategory(root.Path, fullPath),
                        root.Source,
                        ShortcutProcessIdentityReader.TryReadProcessNames(fullPath),
                        ShellIconReader.TryReadPath(fullPath)));
                }
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // Keep applications collected before a directory changed or became unavailable.
            }

            if (truncated)
            {
                break;
            }
        }

        if (!truncated)
        {
            try
            {
                var packagedApplications = _packagedApplications.ListApplications();
                packagedSourceAvailable = true;
                foreach (var packagedApplication in packagedApplications)
                {
                    if (applications.Count >= MaxApplications)
                    {
                        truncated = true;
                        break;
                    }

                    if (!applicationLabels.Add(packagedApplication.Label))
                    {
                        continue;
                    }

                    var applicationId = ApplicationCapabilityId.FromPackagedAppUserModelId(
                        packagedApplication.AppUserModelId);
                    if (!nextTargets.TryAdd(
                            applicationId,
                            new ApplicationLaunchTarget(
                                ApplicationLaunchKind.Packaged,
                                packagedApplication.AppUserModelId)))
                    {
                        continue;
                    }

                    applications.Add(new StartMenuApplication(
                        applicationId,
                        packagedApplication.Label,
                        "Windows Apps",
                        "packaged",
                        Array.Empty<string>(),
                        packagedApplication.IconDataUrl));
                }
            }
            catch (Exception ex) when (ex is COMException or InvalidCastException or InvalidOperationException)
            {
                // Start Menu shortcuts remain usable if AppsFolder is unavailable.
            }
        }

        applications.Sort((left, right) =>
        {
            var labelComparison = StringComparer.CurrentCultureIgnoreCase.Compare(left.Label, right.Label);
            return labelComparison != 0
                ? labelComparison
                : StringComparer.Ordinal.Compare(left.ApplicationId, right.ApplicationId);
        });

        _launchTargets.Clear();
        foreach (var target in nextTargets)
        {
            _launchTargets[target.Key] = target.Value;
        }

        return new StartMenuApplicationCatalog(
            applications,
            indexedAtUtc,
            roots.Count + (packagedSourceAvailable ? 1 : 0),
            truncated);
    }

    private void Invalidate()
    {
        lock (_gate)
        {
            _cachedCatalog = null;
            _cachedAtUtc = default;
            _launchTargets.Clear();
        }
    }

    private static IReadOnlyList<StartMenuRoot> GetStartMenuRoots()
    {
        var candidates = new[]
        {
            new StartMenuRoot(
                Environment.GetFolderPath(Environment.SpecialFolder.Programs),
                "user"),
            new StartMenuRoot(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms),
                "common")
        };

        return candidates
            .Where(candidate => !string.IsNullOrWhiteSpace(candidate.Path) && Directory.Exists(candidate.Path))
            .Select(candidate => candidate with { Path = NormalizeRoot(candidate.Path) })
            .DistinctBy(candidate => candidate.Path, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static bool IsTrustedShortcut(string shortcutPath)
    {
        if (!File.Exists(shortcutPath) ||
            !Path.GetExtension(shortcutPath).Equals(".lnk", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        FileAttributes attributes;
        try
        {
            attributes = File.GetAttributes(shortcutPath);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return false;
        }

        if (attributes.HasFlag(FileAttributes.Hidden) ||
            attributes.HasFlag(FileAttributes.System) ||
            attributes.HasFlag(FileAttributes.ReparsePoint))
        {
            return false;
        }

        var fullPath = Path.GetFullPath(shortcutPath);
        return GetStartMenuRoots().Any(root => IsPathInsideRoot(fullPath, root.Path));
    }

    private static bool IsExcludedShortcutLabel(string label)
    {
        var normalizedLabel = label.Trim();
        return normalizedLabel.StartsWith("Uninstall", StringComparison.OrdinalIgnoreCase) ||
               normalizedLabel.StartsWith("Remove ", StringComparison.OrdinalIgnoreCase) ||
               normalizedLabel.StartsWith("卸载", StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizeRoot(string path) =>
        Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

    private static bool IsPathInsideRoot(string path, string root)
    {
        var normalizedRoot = NormalizeRoot(root) + Path.DirectorySeparatorChar;
        return path.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase);
    }

    private static string GetCategory(string root, string shortcutPath)
    {
        var relativePath = Path.GetRelativePath(root, shortcutPath);
        var relativeDirectory = Path.GetDirectoryName(relativePath);
        if (string.IsNullOrWhiteSpace(relativeDirectory) || relativeDirectory == ".")
        {
            return "Applications";
        }

        return relativeDirectory
            .Split([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar], StringSplitOptions.RemoveEmptyEntries)
            .FirstOrDefault() ?? "Applications";
    }

    private sealed record StartMenuRoot(string Path, string Source);

    private sealed record ApplicationLaunchTarget(ApplicationLaunchKind Kind, string Value);

    private enum ApplicationLaunchKind
    {
        Shortcut,
        Packaged
    }
}

internal sealed record StartMenuApplication(
    string ApplicationId,
    string Label,
    string Category,
    string Source,
    IReadOnlyList<string> ProcessNames,
    string? IconDataUrl);

internal sealed record StartMenuApplicationCatalog(
    IReadOnlyList<StartMenuApplication> Applications,
    DateTimeOffset IndexedAtUtc,
    int SourceCount,
    bool Truncated);

internal sealed record StartMenuApplicationOpenResult(
    bool Opened,
    string ApplicationId,
    int? ProcessId);
