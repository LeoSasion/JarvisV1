using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using Jarvis.Host.Bridge;
using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Services;

internal sealed class StartMenuApplicationService : IDisposable
{
    private const int MaxApplications = 1_024;
    private static readonly TimeSpan CacheLifetime = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan WatchDebounce = TimeSpan.FromMilliseconds(350);

    private readonly object _gate = new();
    private readonly PackagedApplicationService _packagedApplications = new();
    private readonly Func<IReadOnlyList<PackagedApplication>> _packagedApplicationProvider;
    private readonly IReadOnlyList<StartMenuRoot> _roots;
    private readonly Dictionary<string, ApplicationLaunchTarget> _launchTargets = new(StringComparer.Ordinal);
    private readonly List<FileSystemWatcher> _watchers = [];
    private readonly Timer _watchTimer;
    private StartMenuApplicationCatalog? _cachedCatalog;
    private DateTimeOffset _cachedAtUtc;
    private long _revision;
    private bool _cacheDirty = true;
    private bool _disposed;

    public StartMenuApplicationService()
        : this(GetStartMenuRoots(), packagedApplicationProvider: null, WatchDebounce)
    {
    }

    internal StartMenuApplicationService(
        IReadOnlyList<StartMenuRoot> roots,
        Func<IReadOnlyList<PackagedApplication>>? packagedApplicationProvider,
        TimeSpan watchDebounce)
    {
        _roots = roots
            .Where(root => !string.IsNullOrWhiteSpace(root.Path) && Directory.Exists(root.Path))
            .Select(root => root with { Path = NormalizeRoot(root.Path) })
            .DistinctBy(root => root.Path, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        _packagedApplicationProvider = packagedApplicationProvider ?? _packagedApplications.ListApplications;
        _watchTimer = new Timer(OnWatchTimerElapsed);
        StartWatching();
    }

    public event EventHandler<StartMenuApplicationCatalog>? CatalogChanged;

    public StartMenuApplicationCatalog ListApplications()
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            var now = DateTimeOffset.UtcNow;
            if (_cachedCatalog is not null &&
                !_cacheDirty &&
                now - _cachedAtUtc < CacheLifetime)
            {
                return _cachedCatalog;
            }

            return RebuildCatalogUnsafe(
                now,
                _cachedCatalog is null ? "initial" : _cacheDirty ? "filesystem-change" : "cache-expired");
        }
    }

    public StartMenuApplicationCatalog RefreshApplications()
    {
        StartMenuApplicationCatalog catalog;
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            catalog = RebuildCatalogUnsafe(DateTimeOffset.UtcNow, "manual");
        }

        Publish(catalog);
        return catalog;
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

        foreach (var root in _roots)
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
                var packagedApplications = _packagedApplicationProvider();
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
            _roots.Count + (packagedSourceAvailable ? 1 : 0),
            truncated,
            _revision + 1,
            "pending",
            _watchers.Count > 0,
            _watchers.Count);
    }

    private void Invalidate()
    {
        lock (_gate)
        {
            _cacheDirty = true;
        }
    }

    private StartMenuApplicationCatalog RebuildCatalogUnsafe(
        DateTimeOffset indexedAtUtc,
        string refreshReason)
    {
        var catalog = BuildCatalog(indexedAtUtc);
        _revision = catalog.Revision;
        catalog = catalog with { RefreshReason = refreshReason };
        _cachedCatalog = catalog;
        _cachedAtUtc = indexedAtUtc;
        _cacheDirty = false;
        return catalog;
    }

    private void StartWatching()
    {
        foreach (var root in _roots)
        {
            try
            {
                var watcher = new FileSystemWatcher(root.Path)
                {
                    IncludeSubdirectories = true,
                    NotifyFilter = NotifyFilters.FileName |
                                   NotifyFilters.DirectoryName |
                                   NotifyFilters.LastWrite |
                                   NotifyFilters.CreationTime,
                    Filter = "*",
                    EnableRaisingEvents = true
                };
                watcher.Created += OnWatchedRootChanged;
                watcher.Changed += OnWatchedRootChanged;
                watcher.Deleted += OnWatchedRootChanged;
                watcher.Renamed += OnWatchedRootChanged;
                watcher.Error += OnWatcherError;
                _watchers.Add(watcher);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
            {
                HostLog.Warning($"Start menu root watcher could not monitor {root.Path}: {ex.Message}");
            }
        }
    }

    private void OnWatchedRootChanged(object sender, FileSystemEventArgs args)
    {
        if (!ShouldRefreshForPath(args.FullPath))
        {
            return;
        }

        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _cacheDirty = true;
            _watchTimer.Change(WatchDebounce, Timeout.InfiniteTimeSpan);
        }
    }

    private void OnWatcherError(object sender, ErrorEventArgs args)
    {
        HostLog.Warning($"Start menu root watcher reported an error: {args.GetException().Message}");
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _cacheDirty = true;
            _watchTimer.Change(WatchDebounce, Timeout.InfiniteTimeSpan);
        }
    }

    private void OnWatchTimerElapsed(object? state)
    {
        StartMenuApplicationCatalog? catalog = null;
        try
        {
            lock (_gate)
            {
                if (_disposed || !_cacheDirty)
                {
                    return;
                }

                catalog = RebuildCatalogUnsafe(DateTimeOffset.UtcNow, "filesystem-change");
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or COMException)
        {
            HostLog.Warning($"Start menu catalog refresh failed; the previous snapshot remains active: {ex.Message}");
        }

        if (catalog is not null)
        {
            Publish(catalog);
        }
    }

    private void Publish(StartMenuApplicationCatalog catalog)
    {
        var subscribers = CatalogChanged;
        if (subscribers is null)
        {
            return;
        }

        foreach (EventHandler<StartMenuApplicationCatalog> subscriber in subscribers.GetInvocationList())
        {
            try
            {
                subscriber(this, catalog);
            }
            catch (Exception ex)
            {
                HostLog.Error("A Start menu catalog subscriber rejected a snapshot.", ex);
            }
        }
    }

    private static bool ShouldRefreshForPath(string path)
    {
        var extension = Path.GetExtension(path);
        return string.IsNullOrEmpty(extension) ||
               extension.Equals(".lnk", StringComparison.OrdinalIgnoreCase);
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

    private sealed record ApplicationLaunchTarget(ApplicationLaunchKind Kind, string Value);

    private enum ApplicationLaunchKind
    {
        Shortcut,
        Packaged
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
            _watchTimer.Change(Timeout.InfiniteTimeSpan, Timeout.InfiniteTimeSpan);
            foreach (var watcher in _watchers)
            {
                watcher.EnableRaisingEvents = false;
                watcher.Created -= OnWatchedRootChanged;
                watcher.Changed -= OnWatchedRootChanged;
                watcher.Deleted -= OnWatchedRootChanged;
                watcher.Renamed -= OnWatchedRootChanged;
                watcher.Error -= OnWatcherError;
                watcher.Dispose();
            }

            _watchers.Clear();
            _launchTargets.Clear();
            _cachedCatalog = null;
        }

        _watchTimer.Dispose();
    }
}

internal sealed record StartMenuRoot(string Path, string Source);

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
    bool Truncated,
    long Revision,
    string RefreshReason,
    bool Watching,
    int WatchRootCount);

internal sealed record StartMenuApplicationOpenResult(
    bool Opened,
    string ApplicationId,
    int? ProcessId);
