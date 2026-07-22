using System.Diagnostics;
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

    public static void SaveSnapshot(
        int ownerProcessId,
        long ownerStartTimeUtcTicks,
        IReadOnlyCollection<NativeWindowRecoveryEntry> entries)
    {
        lock (FileGate)
        {
            if (entries.Count == 0)
            {
                DeleteSnapshotCore();
                return;
            }

            var snapshot = new NativeWindowRecoverySnapshot(
                CurrentSchemaVersion,
                ownerProcessId,
                ownerStartTimeUtcTicks,
                DateTimeOffset.UtcNow,
                entries.ToArray());
            WriteSnapshotCore(snapshot);
        }
    }

    public static NativeWindowRecoveryResult RestoreStaleSnapshot(bool force = false)
    {
        lock (FileGate)
        {
            if (!File.Exists(RecoveryPath))
            {
                return new NativeWindowRecoveryResult(false, 0, 0, null);
            }

            NativeWindowRecoverySnapshot? snapshot;
            try
            {
                snapshot = JsonSerializer.Deserialize<NativeWindowRecoverySnapshot>(
                    File.ReadAllText(RecoveryPath, Encoding.UTF8),
                    JsonOptions);
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException)
            {
                HostLog.Warning($"Native window recovery snapshot could not be read: {exception.Message}");
                return new NativeWindowRecoveryResult(true, 0, 0, exception.Message);
            }

            if (snapshot is null || snapshot.SchemaVersion != CurrentSchemaVersion ||
                snapshot.OwnerProcessId <= 0 || snapshot.OwnerStartTimeUtcTicks <= 0)
            {
                HostLog.Warning("Discarding an invalid native window recovery snapshot.");
                DeleteSnapshotCore();
                return new NativeWindowRecoveryResult(true, 0, 0, "The snapshot was invalid and was discarded.");
            }

            if (!force && IsSameProcessRunning(snapshot.OwnerProcessId, snapshot.OwnerStartTimeUtcTicks))
            {
                return new NativeWindowRecoveryResult(
                    true,
                    0,
                    snapshot.Entries.Count,
                    "The snapshot owner is still running.");
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

            if (unresolved.Count == 0)
            {
                DeleteSnapshotCore();
            }
            else
            {
                WriteSnapshotCore(snapshot with
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
                unresolved.Count == 0 ? null : "Some DWM attributes could not be restored yet.");
        }
    }

    public static void ClearSnapshot()
    {
        lock (FileGate)
        {
            DeleteSnapshotCore();
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

    private static void WriteSnapshotCore(NativeWindowRecoverySnapshot snapshot)
    {
        var temporaryPath = RecoveryPath + ".tmp";
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(RecoveryPath)!);
            var payload = JsonSerializer.Serialize(snapshot, JsonOptions);
            File.WriteAllText(
                temporaryPath,
                payload,
                new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
            File.Move(temporaryPath, RecoveryPath, overwrite: true);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            HostLog.Warning($"Native window recovery snapshot could not be saved: {exception.Message}");
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

    private static void DeleteSnapshotCore()
    {
        try
        {
            File.Delete(RecoveryPath);
            File.Delete(RecoveryPath + ".tmp");
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            HostLog.Warning($"Native window recovery snapshot could not be removed: {exception.Message}");
        }
    }

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
    string? FailureReason);
