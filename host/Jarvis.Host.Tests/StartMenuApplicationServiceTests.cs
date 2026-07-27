using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class StartMenuApplicationServiceTests
{
    [Fact]
    public void CatalogSnapshotsAreCachedVersionedAndManuallyRefreshable()
    {
        using var temporaryRoot = new TemporaryDirectory();
        File.WriteAllText(Path.Combine(temporaryRoot.Path, "Alpha.lnk"), string.Empty);
        using var service = CreateService(temporaryRoot.Path);

        var initial = service.ListApplications();
        var cached = service.ListApplications();
        var refreshed = service.RefreshApplications();

        Assert.Same(initial, cached);
        Assert.Single(initial.Applications);
        Assert.Equal(1, initial.Revision);
        Assert.Equal("initial", initial.RefreshReason);
        Assert.True(initial.Watching);
        Assert.Equal(1, initial.WatchRootCount);
        Assert.Equal(2, refreshed.Revision);
        Assert.Equal("manual", refreshed.RefreshReason);
    }

    [Fact]
    public async Task ShortcutChangesPublishADebouncedCatalogSnapshot()
    {
        using var temporaryRoot = new TemporaryDirectory();
        using var service = CreateService(temporaryRoot.Path);
        var initial = service.ListApplications();
        var completion = new TaskCompletionSource<StartMenuApplicationCatalog>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        service.CatalogChanged += (_, catalog) =>
        {
            if (catalog.Applications.Any(application => application.Label == "Bravo"))
            {
                completion.TrySetResult(catalog);
            }
        };

        File.WriteAllText(Path.Combine(temporaryRoot.Path, "Bravo.lnk"), string.Empty);
        var changed = await completion.Task.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.True(changed.Revision > initial.Revision);
        Assert.Equal("filesystem-change", changed.RefreshReason);
        Assert.Contains(changed.Applications, application => application.Label == "Bravo");
    }

    private static StartMenuApplicationService CreateService(string root) =>
        new(
            [new StartMenuRoot(root, "test")],
            packagedApplicationProvider: static () => [],
            watchDebounce: TimeSpan.FromMilliseconds(75));

    private sealed class TemporaryDirectory : IDisposable
    {
        public TemporaryDirectory()
        {
            Path = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(),
                $"jarvis-start-menu-{Guid.NewGuid():N}");
            Directory.CreateDirectory(Path);
        }

        public string Path { get; }

        public void Dispose()
        {
            try
            {
                Directory.Delete(Path, recursive: true);
            }
            catch (IOException)
            {
                // A closing FileSystemWatcher can briefly retain the directory.
            }
            catch (UnauthorizedAccessException)
            {
                // Test cleanup must not hide the catalog assertion.
            }
        }
    }
}
