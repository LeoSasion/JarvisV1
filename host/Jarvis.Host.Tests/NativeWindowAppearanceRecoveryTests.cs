using System.Text.Json;
using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class NativeWindowAppearanceRecoveryTests
{
    [Fact]
    public void SaveSnapshotCommitsVerifiedPayloadAndRemovesTemporaryFile()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var recoveryPath = temporaryDirectory.GetRecoveryPath();
        var entry = CreateEntry();

        var result = NativeWindowAppearanceRecovery.SaveSnapshotAtPath(
            recoveryPath,
            Environment.ProcessId,
            NativeWindowAppearanceRecovery.CurrentProcessStartTimeUtcTicks,
            [entry]);

        Assert.True(result.Succeeded, result.FailureReason);
        Assert.Null(result.FailureReason);
        Assert.True(File.Exists(recoveryPath));
        Assert.False(File.Exists(recoveryPath + ".tmp"));

        var snapshot = JsonSerializer.Deserialize<NativeWindowRecoverySnapshot>(
            File.ReadAllText(recoveryPath),
            new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.NotNull(snapshot);
        Assert.Equal(Environment.ProcessId, snapshot.OwnerProcessId);
        Assert.Single(snapshot.Entries);
        Assert.Equal(entry.WindowHandle, snapshot.Entries[0].WindowHandle);
        Assert.Equal(entry.OriginalValues, snapshot.Entries[0].OriginalValues);
    }

    [Fact]
    public void SaveSnapshotReturnsFailureWhenDestinationCannotBeReplaced()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var recoveryPath = temporaryDirectory.GetRecoveryPath();
        Directory.CreateDirectory(recoveryPath);

        var result = NativeWindowAppearanceRecovery.SaveSnapshotAtPath(
            recoveryPath,
            Environment.ProcessId,
            NativeWindowAppearanceRecovery.CurrentProcessStartTimeUtcTicks,
            [CreateEntry()]);

        Assert.False(result.Succeeded);
        Assert.False(string.IsNullOrWhiteSpace(result.FailureReason));
        Assert.True(Directory.Exists(recoveryPath));
        Assert.False(File.Exists(recoveryPath + ".tmp"));
    }

    [Fact]
    public void EmptySnapshotSucceedsOnlyAfterExistingFilesAreRemoved()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var recoveryPath = temporaryDirectory.GetRecoveryPath();
        var ownerStartTime = NativeWindowAppearanceRecovery.CurrentProcessStartTimeUtcTicks;
        var saved = NativeWindowAppearanceRecovery.SaveSnapshotAtPath(
            recoveryPath,
            Environment.ProcessId,
            ownerStartTime,
            [CreateEntry()]);
        Assert.True(saved.Succeeded, saved.FailureReason);
        File.WriteAllText(recoveryPath + ".tmp", "stale");

        var deleted = NativeWindowAppearanceRecovery.SaveSnapshotAtPath(
            recoveryPath,
            Environment.ProcessId,
            ownerStartTime,
            Array.Empty<NativeWindowRecoveryEntry>());

        Assert.True(deleted.Succeeded, deleted.FailureReason);
        Assert.False(File.Exists(recoveryPath));
        Assert.False(File.Exists(recoveryPath + ".tmp"));
    }

    [Fact]
    public void CorruptJsonRequiresSafeModeAndPreservesEvidence()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var recoveryPath = temporaryDirectory.GetRecoveryPath();
        File.WriteAllText(recoveryPath, "{not-json");

        var result = NativeWindowAppearanceRecovery.RestoreStaleSnapshotAtPath(recoveryPath);

        Assert.True(result.SnapshotFound);
        Assert.True(result.RequiresSafeMode);
        Assert.Equal(0, result.PendingWindows);
        Assert.False(string.IsNullOrWhiteSpace(result.FailureReason));
        Assert.Equal("{not-json", File.ReadAllText(recoveryPath));
    }

    [Fact]
    public void InvalidEnvelopeRequiresSafeModeAndPreservesEvidence()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var recoveryPath = temporaryDirectory.GetRecoveryPath();
        const string invalidSnapshot =
            """
            {
              "schemaVersion": 99,
              "ownerProcessId": 123,
              "ownerStartTimeUtcTicks": 456,
              "createdAtUtc": "2026-08-08T00:00:00+00:00",
              "entries": []
            }
            """;
        File.WriteAllText(recoveryPath, invalidSnapshot);

        var result = NativeWindowAppearanceRecovery.RestoreStaleSnapshotAtPath(recoveryPath);

        Assert.True(result.SnapshotFound);
        Assert.True(result.RequiresSafeMode);
        Assert.Contains("preserved", result.FailureReason, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(invalidSnapshot, File.ReadAllText(recoveryPath));
    }

    [Fact]
    public void MissingSnapshotDoesNotRequireSafeMode()
    {
        using var temporaryDirectory = new TemporaryDirectory();

        var result = NativeWindowAppearanceRecovery.RestoreStaleSnapshotAtPath(
            temporaryDirectory.GetRecoveryPath());

        Assert.False(result.SnapshotFound);
        Assert.False(result.RequiresSafeMode);
        Assert.Null(result.FailureReason);
    }

    [Fact]
    public void SnapshotOwnedByCurrentProcessRequiresSafeModeWithoutRestoring()
    {
        using var temporaryDirectory = new TemporaryDirectory();
        var recoveryPath = temporaryDirectory.GetRecoveryPath();
        var ownerStartTime = NativeWindowAppearanceRecovery.CurrentProcessStartTimeUtcTicks;
        var saved = NativeWindowAppearanceRecovery.SaveSnapshotAtPath(
            recoveryPath,
            Environment.ProcessId,
            ownerStartTime,
            [CreateEntry()]);
        Assert.True(saved.Succeeded, saved.FailureReason);

        var result = NativeWindowAppearanceRecovery.RestoreStaleSnapshotAtPath(recoveryPath);

        Assert.True(result.RequiresSafeMode);
        Assert.Equal(1, result.PendingWindows);
        Assert.Contains("still running", result.FailureReason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void FailedPersistencePreventsGuardedDwmMutation()
    {
        var calls = 0;

        var applied = NativeWindowAppearanceService.ApplyRecoveryGuardedAttributes(
            new NativeWindowSnapshotPersistenceResult(false, "disk unavailable"),
            new Dictionary<uint, int> { [20] = 0 },
            new (uint Attribute, int DesiredValue)[] { (20, 1) },
            (_, _) =>
            {
                calls++;
                return true;
            });

        Assert.Equal(0, applied);
        Assert.Equal(0, calls);
    }

    [Fact]
    public void VerifiedPersistenceAllowsOnlyCapturedAttributesToMutate()
    {
        var appliedAttributes = new List<uint>();

        var applied = NativeWindowAppearanceService.ApplyRecoveryGuardedAttributes(
            new NativeWindowSnapshotPersistenceResult(true, null),
            new Dictionary<uint, int> { [20] = 0 },
            new (uint Attribute, int DesiredValue)[] { (20, 1), (34, 42) },
            (attribute, _) =>
            {
                appliedAttributes.Add(attribute);
                return true;
            });

        Assert.Equal(1, applied);
        Assert.Equal([20u], appliedAttributes);
    }

    private static NativeWindowRecoveryEntry CreateEntry() =>
        new(
            12345,
            987,
            638902944000000000,
            [new NativeDwmAttributeValue(20, 0)]);

    private sealed class TemporaryDirectory : IDisposable
    {
        public TemporaryDirectory()
        {
            Path = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(),
                $"jarvis-native-window-recovery-{Guid.NewGuid():N}");
            Directory.CreateDirectory(Path);
        }

        public string Path { get; }

        public string GetRecoveryPath() =>
            System.IO.Path.Combine(Path, "window-appearance.json");

        public void Dispose()
        {
            if (Directory.Exists(Path))
            {
                Directory.Delete(Path, recursive: true);
            }
        }
    }
}
