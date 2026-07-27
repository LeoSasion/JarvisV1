using System.IO;

namespace Jarvis.Host.Services;

internal sealed class DesktopService : IDisposable
{
    private static readonly TimeSpan WatchDebounce = TimeSpan.FromMilliseconds(280);

    private readonly object _gate = new();
    private readonly List<FileSystemWatcher> _watchers = [];
    private readonly Timer _watchTimer;
    private long _revision = 1;
    private DateTimeOffset _changedAtUtc = DateTimeOffset.UtcNow;
    private bool _disposed;

    public DesktopService()
    {
        _watchTimer = new Timer(_ => PublishChanges(), null, Timeout.InfiniteTimeSpan, Timeout.InfiniteTimeSpan);
        ConfigureWatchers();
    }

    public event EventHandler<DesktopEntriesResult>? EntriesChanged;

    public bool IsListedEntry(string fullPath)
    {
        return ListEntries().Entries.Any(
            entry => entry.Path.Equals(fullPath, StringComparison.OrdinalIgnoreCase));
    }

    public DesktopEntriesResult ListEntries()
    {
        long revision;
        DateTimeOffset changedAtUtc;
        int watchRootCount;
        lock (_gate)
        {
            revision = Interlocked.Read(ref _revision);
            changedAtUtc = _changedAtUtc;
            watchRootCount = _watchers.Count;
        }

        var userDesktopPath = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        var publicDesktopPath = Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory);
        var entries = new List<DesktopEntry>();

        AddEntries(entries, userDesktopPath, "user");
        if (!publicDesktopPath.Equals(userDesktopPath, StringComparison.OrdinalIgnoreCase))
        {
            AddEntries(entries, publicDesktopPath, "public");
        }

        return new DesktopEntriesResult(
            entries
                .DistinctBy(entry => entry.Path, StringComparer.OrdinalIgnoreCase)
                .OrderBy(entry => entry.Source.Equals("user", StringComparison.Ordinal) ? 0 : 1)
                .ThenBy(entry => entry.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToArray(),
            userDesktopPath,
            publicDesktopPath,
            revision,
            changedAtUtc,
            watchRootCount > 0,
            watchRootCount);
    }

    private void ConfigureWatchers()
    {
        var roots = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory)
        }
        .Where(path => !string.IsNullOrWhiteSpace(path) && Directory.Exists(path))
        .Distinct(StringComparer.OrdinalIgnoreCase);

        foreach (var root in roots)
        {
            try
            {
                var watcher = new FileSystemWatcher(root)
                {
                    IncludeSubdirectories = false,
                    NotifyFilter =
                        NotifyFilters.FileName |
                        NotifyFilters.DirectoryName |
                        NotifyFilters.Attributes |
                        NotifyFilters.LastWrite,
                    EnableRaisingEvents = true
                };
                watcher.Created += OnDesktopChanged;
                watcher.Deleted += OnDesktopChanged;
                watcher.Changed += OnDesktopChanged;
                watcher.Renamed += OnDesktopRenamed;
                watcher.Error += OnWatcherError;
                _watchers.Add(watcher);
            }
            catch (Exception exception) when (
                exception is IOException or UnauthorizedAccessException or ArgumentException)
            {
                // A redirected or protected desktop remains available through explicit refresh.
            }
        }
    }

    private void OnDesktopChanged(object sender, FileSystemEventArgs e) => ScheduleRefresh();

    private void OnDesktopRenamed(object sender, RenamedEventArgs e) => ScheduleRefresh();

    private void OnWatcherError(object sender, ErrorEventArgs e) => ScheduleRefresh();

    private void ScheduleRefresh()
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _watchTimer.Change(WatchDebounce, Timeout.InfiniteTimeSpan);
        }
    }

    private void PublishChanges()
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _changedAtUtc = DateTimeOffset.UtcNow;
            Interlocked.Increment(ref _revision);
        }

        EntriesChanged?.Invoke(this, ListEntries());
    }

    private static void AddEntries(List<DesktopEntry> entries, string desktopPath, string source)
    {
        if (string.IsNullOrWhiteSpace(desktopPath) || !Directory.Exists(desktopPath))
        {
            return;
        }

        try
        {
            foreach (var path in Directory.EnumerateFileSystemEntries(desktopPath, "*", SearchOption.TopDirectoryOnly))
            {
                try
                {
                    var attributes = File.GetAttributes(path);
                    if (attributes.HasFlag(FileAttributes.Hidden) || attributes.HasFlag(FileAttributes.System))
                    {
                        continue;
                    }

                    var isDirectory = attributes.HasFlag(FileAttributes.Directory);
                    var extension = isDirectory ? string.Empty : Path.GetExtension(path);
                    var kind = GetKind(isDirectory, extension);
                    var name = kind is "shortcut" or "url"
                        ? Path.GetFileNameWithoutExtension(path)
                        : Path.GetFileName(path);

                    entries.Add(new DesktopEntry(
                        name,
                        Path.GetFullPath(path),
                        source,
                        kind,
                        extension));
                }
                catch (IOException)
                {
                    // A desktop item can disappear during enumeration.
                }
                catch (UnauthorizedAccessException)
                {
                    // Skip an individual item rather than failing the desktop.
                }
            }
        }
        catch (IOException)
        {
            // The desktop folder can be redirected or temporarily unavailable.
        }
        catch (UnauthorizedAccessException)
        {
            // Return any entries that could be read from the other desktop scope.
        }
    }

    private static string GetKind(bool isDirectory, string extension)
    {
        if (isDirectory)
        {
            return "directory";
        }

        if (extension.Equals(".lnk", StringComparison.OrdinalIgnoreCase))
        {
            return "shortcut";
        }

        return extension.Equals(".url", StringComparison.OrdinalIgnoreCase) ? "url" : "file";
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
        }

        foreach (var watcher in _watchers)
        {
            watcher.EnableRaisingEvents = false;
            watcher.Created -= OnDesktopChanged;
            watcher.Deleted -= OnDesktopChanged;
            watcher.Changed -= OnDesktopChanged;
            watcher.Renamed -= OnDesktopRenamed;
            watcher.Error -= OnWatcherError;
            watcher.Dispose();
        }
        _watchers.Clear();
        _watchTimer.Dispose();
    }
}

internal sealed record DesktopEntriesResult(
    IReadOnlyList<DesktopEntry> Entries,
    string UserDesktopPath,
    string PublicDesktopPath,
    long Revision,
    DateTimeOffset ChangedAtUtc,
    bool Watching,
    int WatchRootCount);

internal sealed record DesktopEntry(
    string Name,
    string Path,
    string Source,
    string Kind,
    string Extension);
