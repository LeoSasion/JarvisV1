using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Services;

internal static class NativeWindowAppearanceRecovery
{
    private const int CurrentSchemaVersion = 1;
    private static readonly object FileGate = new();
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private static readonly string RecoveryPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "JARVIS",
        "Recovery",
        "window-appearance.json");

    public static bool HasPendingSnapshot
    {
        get
        {
            lock (FileGate)
            {
                return File.Exists(RecoveryPath);
            }
        }
    }

    public static long CurrentProcessStartTimeUtcTicks
    {
        get
        {
            using var process = Process.GetCurrentProcess();
            return process.StartTime.ToUniversalTime().Ticks;
        }
    }

    public static bool TryGetProcessStartTimeUtcTicks(uint processId, out long startTimeUtcTicks)
    {
        startTimeUtcTicks = 0;
        try
        {
            using var process = Process.GetProcessById(checked((int)processId));
            startTimeUtcTicks = process.StartTime.ToUniversalTime().Ticks;
            return startTimeUtcTicks > 0;
        }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or
                                           System.ComponentModel.Win32Exception or OverflowException)
        {
            return false;
        }
    }

    public static NativeWindowSnapshotPersistenceResult SaveSnapshot(
        int ownerProcessId,
        long ownerStartTimeUtcTicks,
        IReadOnlyCollection<NativeWindowRecoveryEntry> entries)
        => SaveSnapshotAtPath(
            RecoveryPath,
            ownerProcessId,
            ownerStartTimeUtcTicks,
            entries);

    internal static NativeWindowSnapshotPersistenceResult SaveSnapshotAtPath(
        string recoveryPath,
        int ownerProcessId,
        long ownerStartTimeUtcTicks,
        IReadOnlyCollection<NativeWindowRecoveryEntry> entries)
    {
        lock (FileGate)
        {
            if (entries.Count == 0)
            {
                return DeleteSnapshotCore(recoveryPath);
            }

            var snapshot = new NativeWindowRecoverySnapshot(
                CurrentSchemaVersion,
                ownerProcessId,
                ownerStartTimeUtcTicks,
                DateTimeOffset.UtcNow,
                entries.ToArray());
            return WriteSnapshotCore(recoveryPath, snapshot);
        }
    }

    public static NativeWindowRecoveryResult RestoreStaleSnapshot(bool force = false)
        => RestoreStaleSnapshotAtPath(RecoveryPath, force);

    internal static NativeWindowRecoveryResult RestoreStaleSnapshotAtPath(
        string recoveryPath,
        bool force = false)
    {
        lock (FileGate)
        {
            if (!File.Exists(recoveryPath))
            {
                return new NativeWindowRecoveryResult(false, 0, 0, null, false);
            }

            NativeWindowRecoverySnapshot? snapshot;
            try
            {
                snapshot = JsonSerializer.Deserialize<NativeWindowRecoverySnapshot>(
                    File.ReadAllText(recoveryPath, Encoding.UTF8),
                    JsonOptions);
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException)
            {
                HostLog.Warning($"Native window recovery snapshot could not be read: {exception.Message}");
                return new NativeWindowRecoveryResult(true, 0, 0, exception.Message, true);
            }

            if (!IsValidSnapshot(snapshot))
            {
                const string reason =
                    "The snapshot was invalid and was preserved for diagnosis; native appearance is disabled.";
                HostLog.Warning(reason);
                return new NativeWindowRecoveryResult(true, 0, 0, reason, true);
            }

            if (!force && IsSameProcessRunning(snapshot.OwnerProcessId, snapshot.OwnerStartTimeUtcTicks))
            {
                return new NativeWindowRecoveryResult(
                    true,
                    0,
                    snapshot.Entries.Count,
                    "The snapshot owner is still running.",
                    true);
            }

            var restored = 0;
            var unresolved = new List<NativeWindowRecoveryEntry>();
            foreach (var entry in snapshot.Entries)
            {
                if (!TryRestoreEntry(entry, out var targetStillValid))
                {
                    if (targetStillValid)
                    {
                        unresolved.Add(entry);
                    }

                    continue;
                }

                restored++;
            }

            NativeWindowSnapshotPersistenceResult persistence;
            if (unresolved.Count == 0)
            {
                persistence = DeleteSnapshotCore(recoveryPath);
            }
            else
            {
                persistence = WriteSnapshotCore(recoveryPath, snapshot with
                {
                    CreatedAtUtc = DateTimeOffset.UtcNow,
                    Entries = unresolved
                });
            }

            if (restored > 0 || unresolved.Count > 0)
            {
                HostLog.Info(
                    $"Native window recovery restored {restored} window(s); " +
                    $"{unresolved.Count} valid target(s) remain pending.");
            }

            return new NativeWindowRecoveryResult(
                true,
                restored,
                unresolved.Count,
                persistence.Succeeded
                    ? unresolved.Count == 0
                        ? null
                        : "Some DWM attributes could not be restored yet."
                    : persistence.FailureReason,
                unresolved.Count > 0 || !persistence.Succeeded);
        }
    }

    public static NativeWindowSnapshotPersistenceResult ClearSnapshot()
    {
        lock (FileGate)
        {
            return DeleteSnapshotCore(RecoveryPath);
        }
    }

    private static bool TryRestoreEntry(NativeWindowRecoveryEntry entry, out bool targetStillValid)
    {
        targetStillValid = false;
        var window = new IntPtr(entry.WindowHandle);
        if (window == IntPtr.Zero || !IsWindow(window))
        {
            return false;
        }

        _ = GetWindowThreadProcessId(window, out var processId);
        if (processId == 0 || processId != entry.ProcessId ||
            !TryGetProcessStartTimeUtcTicks(processId, out var startTimeUtcTicks) ||
            startTimeUtcTicks != entry.ProcessStartTimeUtcTicks)
        {
            return false;
        }

        targetStillValid = true;
        var success = true;
        foreach (var attribute in entry.OriginalValues)
        {
            var value = attribute.Value;
            if (DwmSetWindowAttribute(window, attribute.Attribute, ref value, sizeof(int)) != 0)
            {
                success = false;
            }
        }

        return success;
    }

    private static bool IsSameProcessRunning(int processId, long startTimeUtcTicks)
    {
        try
        {
            using var process = Process.GetProcessById(processId);
            return !process.HasExited && process.StartTime.ToUniversalTime().Ticks == startTimeUtcTicks;
        }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or
                                           System.ComponentModel.Win32Exception)
        {
            return false;
        }
    }

    private static NativeWindowSnapshotPersistenceResult WriteSnapshotCore(
        string recoveryPath,
        NativeWindowRecoverySnapshot snapshot)
    {
        var temporaryPath = recoveryPath + ".tmp";
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(recoveryPath)!);
            var payload = JsonSerializer.SerializeToUtf8Bytes(snapshot, JsonOptions);
            using (var stream = new FileStream(
                       temporaryPath,
                       FileMode.Create,
                       FileAccess.Write,
                       FileShare.None,
                       bufferSize: 4096,
                       FileOptions.WriteThrough))
            {
                stream.Write(payload);
                stream.Flush(flushToDisk: true);
            }

            File.Move(temporaryPath, recoveryPath, overwrite: true);
            var readback = File.ReadAllBytes(recoveryPath);
            if (!payload.AsSpan().SequenceEqual(readback))
            {
                const string reason = "Native window recovery snapshot readback did not match the committed payload.";
                HostLog.Warning(reason);
                return new NativeWindowSnapshotPersistenceResult(false, reason);
            }

            var verifiedSnapshot = JsonSerializer.Deserialize<NativeWindowRecoverySnapshot>(
                readback,
                JsonOptions);
            if (!IsValidSnapshot(verifiedSnapshot))
            {
                const string reason = "Native window recovery snapshot failed validation after readback.";
                HostLog.Warning(reason);
                return new NativeWindowSnapshotPersistenceResult(false, reason);
            }

            return new NativeWindowSnapshotPersistenceResult(true, null);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException)
        {
            HostLog.Warning($"Native window recovery snapshot could not be saved: {exception.Message}");
            return new NativeWindowSnapshotPersistenceResult(false, exception.Message);
        }
        finally
        {
            try
            {
                File.Delete(temporaryPath);
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
                HostLog.Warning($"Temporary native window recovery snapshot could not be removed: {exception.Message}");
            }
        }
    }

    private static NativeWindowSnapshotPersistenceResult DeleteSnapshotCore(string recoveryPath)
    {
        try
        {
            File.Delete(recoveryPath);
            File.Delete(recoveryPath + ".tmp");
            if (File.Exists(recoveryPath) || File.Exists(recoveryPath + ".tmp"))
            {
                const string reason = "Native window recovery snapshot deletion could not be verified.";
                HostLog.Warning(reason);
                return new NativeWindowSnapshotPersistenceResult(false, reason);
            }

            return new NativeWindowSnapshotPersistenceResult(true, null);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            HostLog.Warning($"Native window recovery snapshot could not be removed: {exception.Message}");
            return new NativeWindowSnapshotPersistenceResult(false, exception.Message);
        }
    }

    private static bool IsValidSnapshot(
        [NotNullWhen(true)] NativeWindowRecoverySnapshot? snapshot) =>
        snapshot is
        {
            SchemaVersion: CurrentSchemaVersion,
            OwnerProcessId: > 0,
            OwnerStartTimeUtcTicks: > 0,
            Entries: not null
        } &&
        snapshot.Entries.All(entry => entry is
        {
            WindowHandle: not 0,
            ProcessId: > 0,
            ProcessStartTimeUtcTicks: > 0,
            OriginalValues.Count: > 0
        });

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(
        IntPtr window,
        uint attribute,
        ref int value,
        int valueSize);
}

internal sealed record NativeWindowRecoverySnapshot(
    int SchemaVersion,
    int OwnerProcessId,
    long OwnerStartTimeUtcTicks,
    DateTimeOffset CreatedAtUtc,
    IReadOnlyList<NativeWindowRecoveryEntry> Entries);

internal sealed record NativeWindowRecoveryEntry(
    long WindowHandle,
    uint ProcessId,
    long ProcessStartTimeUtcTicks,
    IReadOnlyList<NativeDwmAttributeValue> OriginalValues);

internal sealed record NativeDwmAttributeValue(uint Attribute, int Value);

internal sealed record NativeWindowRecoveryResult(
    bool SnapshotFound,
    int RestoredWindows,
    int PendingWindows,
    string? FailureReason,
    bool RequiresSafeMode);

internal sealed record NativeWindowSnapshotPersistenceResult(
    bool Succeeded,
    string? FailureReason);
