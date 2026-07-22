using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace Jarvis.Host.Services;

internal sealed class SystemDetailsService
{
    private const int MaximumProcesses = 64;

    public SystemDetailsSnapshot Capture()
    {
        var computer = ReadComputerIdentity();
        var graphics = ReadGraphicsAdapters();
        var drives = ReadDrives();
        var processes = ReadProcesses();

        return new SystemDetailsSnapshot(
            DateTimeOffset.UtcNow,
            computer,
            graphics,
            drives,
            processes,
            new HardwareSensorState(
                false,
                "Temperature, voltage, and fan sensors require a separately audited hardware provider."));
    }

    private static ComputerIdentity ReadComputerIdentity()
    {
        using var cpuKey = Registry.LocalMachine.OpenSubKey(
            @"HARDWARE\DESCRIPTION\System\CentralProcessor\0",
            writable: false);
        using var biosKey = Registry.LocalMachine.OpenSubKey(
            @"HARDWARE\DESCRIPTION\System\BIOS",
            writable: false);

        return new ComputerIdentity(
            Environment.MachineName,
            ReadRegistryText(cpuKey, "ProcessorNameString") ?? "Unknown processor",
            Environment.ProcessorCount,
            ReadRegistryText(biosKey, "SystemManufacturer") ?? "Unknown manufacturer",
            ReadRegistryText(biosKey, "SystemProductName") ?? "Unknown model",
            ReadRegistryText(biosKey, "BIOSVendor") ?? "Unknown BIOS vendor",
            ReadRegistryText(biosKey, "BIOSVersion") ?? "Unknown BIOS version",
            RuntimeInformation.OSDescription,
            Environment.OSVersion.Version.ToString());
    }

    private static IReadOnlyList<GraphicsAdapterInfo> ReadGraphicsAdapters()
    {
        var adapters = new List<GraphicsAdapterInfo>();
        using var videoMap = Registry.LocalMachine.OpenSubKey(
            @"HARDWARE\DEVICEMAP\VIDEO",
            writable: false);
        if (videoMap is null)
        {
            return adapters;
        }

        foreach (var valueName in videoMap.GetValueNames().OrderBy(name => name, StringComparer.Ordinal))
        {
            if (!valueName.StartsWith(@"\Device\Video", StringComparison.OrdinalIgnoreCase) ||
                videoMap.GetValue(valueName) is not string registryPath)
            {
                continue;
            }

            const string machinePrefix = @"\Registry\Machine\";
            if (!registryPath.StartsWith(machinePrefix, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            try
            {
                using var adapterKey = Registry.LocalMachine.OpenSubKey(
                    registryPath[machinePrefix.Length..],
                    writable: false);
                var name = ReadRegistryText(adapterKey, "DriverDesc")
                    ?? ReadRegistryText(adapterKey, "Device Description")
                    ?? valueName;
                var driverVersion = ReadRegistryText(adapterKey, "DriverVersion");
                if (adapters.Any(adapter => adapter.Name.Equals(name, StringComparison.OrdinalIgnoreCase)))
                {
                    continue;
                }

                adapters.Add(new GraphicsAdapterInfo(name, driverVersion));
            }
            catch (Exception ex) when (ex is System.Security.SecurityException or UnauthorizedAccessException)
            {
                // Some display-driver registry branches are protected.
            }
        }

        return adapters.Take(8).ToArray();
    }

    private static IReadOnlyList<DriveDetails> ReadDrives()
    {
        var drives = new List<DriveDetails>();
        foreach (var drive in DriveInfo.GetDrives())
        {
            try
            {
                if (!drive.IsReady)
                {
                    continue;
                }

                drives.Add(new DriveDetails(
                    drive.Name,
                    string.IsNullOrWhiteSpace(drive.VolumeLabel) ? drive.Name : drive.VolumeLabel,
                    drive.DriveType.ToString(),
                    drive.DriveFormat,
                    Math.Max(0, drive.TotalSize),
                    Math.Max(0, drive.AvailableFreeSpace)));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // Removable and network drives can disappear while being inspected.
            }
        }

        return drives.OrderBy(drive => drive.Name, StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private static IReadOnlyList<DetailedProcessSnapshot> ReadProcesses()
    {
        var processes = new List<DetailedProcessSnapshot>();
        foreach (var process in Process.GetProcesses())
        {
            using (process)
            {
                try
                {
                    DateTimeOffset? startedAt = null;
                    try
                    {
                        startedAt = process.StartTime;
                    }
                    catch (Exception ex) when (ex is Win32Exception or InvalidOperationException)
                    {
                        // Protected processes may hide their start time.
                    }

                    processes.Add(new DetailedProcessSnapshot(
                        process.Id,
                        process.ProcessName,
                        Math.Max(0, process.WorkingSet64),
                        Math.Max(0, process.PrivateMemorySize64),
                        Math.Max(0, process.Threads.Count),
                        process.BasePriority,
                        process.SessionId,
                        TryReadResponding(process),
                        startedAt));
                }
                catch (Exception ex) when (ex is Win32Exception or InvalidOperationException)
                {
                    // A protected or exiting process is skipped without failing the panel.
                }
            }
        }

        return processes
            .OrderByDescending(process => process.WorkingSetBytes)
            .ThenBy(process => process.Name, StringComparer.CurrentCultureIgnoreCase)
            .Take(MaximumProcesses)
            .ToArray();
    }

    private static bool? TryReadResponding(Process process)
    {
        try
        {
            return process.MainWindowHandle == IntPtr.Zero ? null : process.Responding;
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }

    private static string? ReadRegistryText(RegistryKey? key, string name)
    {
        var value = key?.GetValue(name)?.ToString()?.Trim();
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }
}

internal sealed record SystemDetailsSnapshot(
    DateTimeOffset CapturedAt,
    ComputerIdentity Computer,
    IReadOnlyList<GraphicsAdapterInfo> GraphicsAdapters,
    IReadOnlyList<DriveDetails> Drives,
    IReadOnlyList<DetailedProcessSnapshot> Processes,
    HardwareSensorState Sensors);

internal sealed record ComputerIdentity(
    string MachineName,
    string ProcessorName,
    int LogicalProcessors,
    string Manufacturer,
    string Model,
    string BiosVendor,
    string BiosVersion,
    string OperatingSystem,
    string OperatingSystemVersion);

internal sealed record GraphicsAdapterInfo(string Name, string? DriverVersion);

internal sealed record DriveDetails(
    string Name,
    string Label,
    string DriveType,
    string FileSystem,
    long TotalBytes,
    long FreeBytes);

internal sealed record DetailedProcessSnapshot(
    int Pid,
    string Name,
    long WorkingSetBytes,
    long PrivateMemoryBytes,
    int ThreadCount,
    int BasePriority,
    int SessionId,
    bool? Responding,
    DateTimeOffset? StartedAt);

internal sealed record HardwareSensorState(bool Available, string Detail);
