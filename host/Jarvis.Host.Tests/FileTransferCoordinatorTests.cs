using Jarvis.Host.Bridge;
using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class FileTransferCoordinatorTests : IDisposable
{
    private readonly string _root = Path.Combine(
        Path.GetTempPath(),
        $"jarvis-transfer-tests-{Guid.NewGuid():N}");

    public FileTransferCoordinatorTests()
    {
        Directory.CreateDirectory(_root);
    }

    [Fact]
    public void PreflightReportsConflictsAndBlocksSelfReplacement()
    {
        var source = Path.Combine(_root, "source");
        Directory.CreateDirectory(source);
        var file = Path.Combine(source, "alpha.txt");
        File.WriteAllText(file, "alpha");

        using var coordinator = new FileTransferCoordinator();
        var preflight = coordinator.Preflight([file], source, "copy");

        var conflict = Assert.Single(preflight.Conflicts);
        Assert.Equal(file, conflict.Source);
        Assert.Equal(file, conflict.Target);
        Assert.False(preflight.CrossesVolumes);
    }

    [Fact]
    public async Task RenamePolicyKeepsBothAndPublishesTerminalResult()
    {
        var source = Path.Combine(_root, "source");
        var destination = Path.Combine(_root, "destination");
        Directory.CreateDirectory(source);
        Directory.CreateDirectory(destination);
        var sourceFile = Path.Combine(source, "report.txt");
        var existingFile = Path.Combine(destination, "report.txt");
        await File.WriteAllTextAsync(sourceFile, "new report");
        await File.WriteAllTextAsync(existingFile, "existing report");

        using var coordinator = new FileTransferCoordinator();
        var started = coordinator.Start([sourceFile], destination, "copy", "rename");
        var completed = await WaitForTerminalAsync(coordinator, started.JobId);

        Assert.Equal("completed", completed.Status);
        var item = Assert.Single(completed.Result.Items);
        Assert.NotEqual(existingFile, item.Target);
        Assert.Equal("existing report", await File.ReadAllTextAsync(existingFile));
        Assert.Equal("new report", await File.ReadAllTextAsync(item.Target));
    }

    [Fact]
    public async Task ReplacePolicyCommitsNewTargetAfterRollbackWindow()
    {
        var source = Path.Combine(_root, "source");
        var destination = Path.Combine(_root, "destination");
        Directory.CreateDirectory(source);
        Directory.CreateDirectory(destination);
        var sourceFile = Path.Combine(source, "settings.json");
        var targetFile = Path.Combine(destination, "settings.json");
        await File.WriteAllTextAsync(sourceFile, """{"version":2}""");
        await File.WriteAllTextAsync(targetFile, """{"version":1}""");

        using var coordinator = new FileTransferCoordinator();
        var started = coordinator.Start([sourceFile], destination, "copy", "replace");
        var completed = await WaitForTerminalAsync(coordinator, started.JobId);

        Assert.Equal("completed", completed.Status);
        Assert.Equal("""{"version":2}""", await File.ReadAllTextAsync(targetFile));
        Assert.Empty(Directory.EnumerateFileSystemEntries(destination, ".jarvis-rollback-*"));
    }

    [Fact]
    public void PreflightRejectsReparsePointSourcesWhenWindowsAllowsTestLinks()
    {
        var source = Path.Combine(_root, "source");
        var destination = Path.Combine(_root, "destination");
        var link = Path.Combine(_root, "linked-source");
        Directory.CreateDirectory(source);
        Directory.CreateDirectory(destination);
        File.WriteAllText(Path.Combine(source, "payload.txt"), "linked payload");
        try
        {
            Directory.CreateSymbolicLink(link, source);
        }
        catch (Exception exception) when (
            exception is UnauthorizedAccessException or IOException or PlatformNotSupportedException)
        {
            return;
        }

        using var coordinator = new FileTransferCoordinator();
        var error = Assert.Throws<BridgeFaultException>(
            () => coordinator.Preflight(
                [Path.Combine(link, "payload.txt")],
                destination,
                "copy"));

        Assert.Equal("TARGET_NOT_ALLOWED", error.Code);
    }

    [Fact]
    public async Task ImmediateCancellationLeavesSourceAndRemovesPartialDestination()
    {
        var source = Path.Combine(_root, "source");
        var destination = Path.Combine(_root, "destination");
        Directory.CreateDirectory(source);
        Directory.CreateDirectory(destination);
        var sourceFile = Path.Combine(source, "large.bin");
        await using (var stream = new FileStream(sourceFile, FileMode.CreateNew, FileAccess.Write))
        {
            stream.SetLength(256L * 1024 * 1024);
        }

        using var coordinator = new FileTransferCoordinator();
        var started = coordinator.Start([sourceFile], destination, "copy", "rename");
        coordinator.Cancel(started.JobId);
        var cancelled = await WaitForTerminalAsync(coordinator, started.JobId);

        Assert.Equal("cancelled", cancelled.Status);
        Assert.True(File.Exists(sourceFile));
        Assert.False(File.Exists(Path.Combine(destination, "large.bin")));
    }

    [Fact]
    public void BrowseAcceptsLongLocalPathsDeclaredByTheHostManifest()
    {
        var current = _root;
        while (current.Length < 300)
        {
            current = Path.Combine(current, $"segment-{Guid.NewGuid():N}"[..24]);
            Directory.CreateDirectory(current);
        }

        var service = new FileExplorerService();
        var snapshot = service.Browse(current);

        Assert.Equal(current, snapshot.CurrentPath);
        Assert.True(snapshot.CurrentPath.Length > 260);
    }

    [Fact]
    public async Task CrossVolumeMoveCopiesThenRemovesSourceWhenAnotherFixedDriveIsAvailable()
    {
        var sourceRoot = Path.GetPathRoot(_root);
        var destinationDrive = DriveInfo.GetDrives().FirstOrDefault(drive =>
            drive.IsReady &&
            drive.DriveType == DriveType.Fixed &&
            !drive.RootDirectory.FullName.Equals(sourceRoot, StringComparison.OrdinalIgnoreCase));
        if (destinationDrive is null)
        {
            return;
        }

        var destination = Path.Combine(
            destinationDrive.RootDirectory.FullName,
            $".jarvis-transfer-tests-{Guid.NewGuid():N}");
        try
        {
            Directory.CreateDirectory(destination);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            return;
        }

        try
        {
            var sourceFile = Path.Combine(_root, "cross-volume.txt");
            await File.WriteAllTextAsync(sourceFile, "verified cross-volume payload");
            using var coordinator = new FileTransferCoordinator();
            var preflight = coordinator.Preflight([sourceFile], destination, "move");
            Assert.True(preflight.CrossesVolumes);

            var started = coordinator.Start([sourceFile], destination, "move", "rename");
            var completed = await WaitForTerminalAsync(coordinator, started.JobId);

            Assert.Equal("completed", completed.Status);
            var target = Assert.Single(completed.Result.Items).Target;
            Assert.False(File.Exists(sourceFile));
            Assert.Equal("verified cross-volume payload", await File.ReadAllTextAsync(target));
        }
        finally
        {
            try
            {
                Directory.Delete(destination, recursive: true);
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
                // Cleanup remains bounded to the unique test directory.
            }
        }
    }

    private static async Task<ExplorerTransferSnapshot> WaitForTerminalAsync(
        FileTransferCoordinator coordinator,
        string jobId)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        while (!timeout.IsCancellationRequested)
        {
            var snapshot = coordinator.GetTransfers().Jobs
                .First(job => job.JobId == jobId);
            if (snapshot.Status is "completed" or "completed-with-errors" or "cancelled" or "failed")
            {
                return snapshot;
            }

            await Task.Delay(20, timeout.Token);
        }

        throw new TimeoutException("The transfer did not reach a terminal state.");
    }

    public void Dispose()
    {
        try
        {
            Directory.Delete(_root, recursive: true);
        }
        catch (IOException)
        {
            // Windows can retain a file handle briefly after a cancelled async copy.
        }
        catch (UnauthorizedAccessException)
        {
            // Test cleanup is best effort and never touches data outside the unique temp root.
        }
    }
}
