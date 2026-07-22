using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;

namespace Jarvis.Host.Services;

internal sealed class SystemSnapshotService
{
    private static readonly long ProcessRefreshTicks = Stopwatch.Frequency * 5;

    private readonly object _gate = new();

    private CpuTimes _previousCpu;
    private long _previousNetworkTimestamp;
    private ulong _previousReceivedBytes;
    private ulong _previousSentBytes;
    private IReadOnlyList<ProcessSnapshot> _cachedProcesses = Array.Empty<ProcessSnapshot>();
    private DateTimeOffset _processSampleTimestamp;
    private long _nextProcessRefreshTimestamp;

    public SystemSnapshotService()
    {
        _previousCpu = ReadCpuTimes();
        var network = ReadNetworkTotals();
        _previousReceivedBytes = network.Received;
        _previousSentBytes = network.Sent;
        _previousNetworkTimestamp = Stopwatch.GetTimestamp();
    }

    public SystemSnapshot Capture()
    {
        lock (_gate)
        {
            var cpu = CaptureCpu();
            var memory = CaptureMemory();
            var network = CaptureNetwork();
            var power = CapturePower();
            var processes = CaptureProcessesWhenDue();
            var uptimeSeconds = Math.Max(0, Environment.TickCount64 / 1000);

            return new SystemSnapshot(
                DateTimeOffset.UtcNow,
                new OperatingSystemSnapshot(
                    Environment.OSVersion.Version.ToString(),
                    RuntimeInformation.OSDescription,
                    Environment.MachineName,
                    uptimeSeconds),
                cpu,
                memory,
                network,
                power,
                processes,
                _processSampleTimestamp);
        }
    }

    private IReadOnlyList<ProcessSnapshot> CaptureProcessesWhenDue()
    {
        var now = Stopwatch.GetTimestamp();
        if (_nextProcessRefreshTimestamp != 0 && now < _nextProcessRefreshTimestamp)
        {
            return _cachedProcesses;
        }

        _cachedProcesses = CaptureProcesses();
        _processSampleTimestamp = DateTimeOffset.UtcNow;
        _nextProcessRefreshTimestamp = now + ProcessRefreshTicks;
        return _cachedProcesses;
    }

    private CpuSnapshot CaptureCpu()
    {
        var current = ReadCpuTimes();
        var idleDelta = SubtractNoUnderflow(current.Idle, _previousCpu.Idle);
        var kernelDelta = SubtractNoUnderflow(current.Kernel, _previousCpu.Kernel);
        var userDelta = SubtractNoUnderflow(current.User, _previousCpu.User);
        var totalDelta = kernelDelta + userDelta;
        _previousCpu = current;

        var usage = totalDelta == 0
            ? 0
            : 100d * Math.Clamp(1d - (double)idleDelta / totalDelta, 0d, 1d);

        return new CpuSnapshot(Math.Round(usage, 1), Environment.ProcessorCount);
    }

    private static MemorySnapshot CaptureMemory()
    {
        var status = new MemoryStatusEx();
        if (!GlobalMemoryStatusEx(ref status))
        {
            throw new InvalidOperationException(
                $"GlobalMemoryStatusEx failed with Win32 error {Marshal.GetLastWin32Error()}.");
        }

        var total = status.TotalPhysical;
        var available = Math.Min(total, status.AvailablePhysical);
        var used = total - available;
        var usage = total == 0 ? 0 : 100d * used / total;
        return new MemorySnapshot(total, available, used, Math.Round(usage, 1));
    }

    private NetworkSnapshot CaptureNetwork()
    {
        var totals = ReadNetworkTotals();
        var now = Stopwatch.GetTimestamp();
        var elapsedSeconds = (double)(now - _previousNetworkTimestamp) / Stopwatch.Frequency;
        var receivedDelta = SubtractNoUnderflow(totals.Received, _previousReceivedBytes);
        var sentDelta = SubtractNoUnderflow(totals.Sent, _previousSentBytes);

        _previousReceivedBytes = totals.Received;
        _previousSentBytes = totals.Sent;
        _previousNetworkTimestamp = now;

        var receivedPerSecond = elapsedSeconds <= 0 ? 0 : receivedDelta / elapsedSeconds;
        var sentPerSecond = elapsedSeconds <= 0 ? 0 : sentDelta / elapsedSeconds;

        return new NetworkSnapshot(
            totals.IsAvailable,
            totals.InterfaceName,
            totals.InterfaceType,
            Math.Round(receivedPerSecond),
            Math.Round(sentPerSecond),
            totals.Received,
            totals.Sent);
    }

    private static IReadOnlyList<ProcessSnapshot> CaptureProcesses()
    {
        var processes = new List<ProcessSnapshot>();
        foreach (var process in Process.GetProcesses())
        {
            using (process)
            {
                try
                {
                    processes.Add(new ProcessSnapshot(
                        process.Id,
                        process.ProcessName,
                        Math.Max(0, process.WorkingSet64),
                        Math.Max(0, process.TotalProcessorTime.TotalMilliseconds)));
                }
                catch (InvalidOperationException)
                {
                    // The process ended while the snapshot was being captured.
                }
                catch (System.ComponentModel.Win32Exception)
                {
                    // Protected processes can reject individual property reads.
                }
            }
        }

        return processes
            .OrderByDescending(process => process.WorkingSetBytes)
            .Take(12)
            .ToArray();
    }

    private static NetworkTotals ReadNetworkTotals()
    {
        ulong received = 0;
        ulong sent = 0;
        NetworkInterface? primaryInterface = null;

        foreach (var networkInterface in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (networkInterface.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel ||
                networkInterface.OperationalStatus != OperationalStatus.Up)
            {
                continue;
            }

            try
            {
                var statistics = networkInterface.GetIPStatistics();
                received += (ulong)Math.Max(0, statistics.BytesReceived);
                sent += (ulong)Math.Max(0, statistics.BytesSent);
                if (primaryInterface is null || networkInterface.Speed > primaryInterface.Speed)
                {
                    primaryInterface = networkInterface;
                }
            }
            catch (NetworkInformationException)
            {
                // Interfaces can disappear during Wi-Fi/VPN transitions.
            }
        }

        return new NetworkTotals(
            received,
            sent,
            primaryInterface is not null,
            primaryInterface?.Name,
            primaryInterface?.NetworkInterfaceType.ToString());
    }

    private static PowerSnapshot CapturePower()
    {
        if (!GetSystemPowerStatus(out var status))
        {
            return new PowerSnapshot(false, null, false, false);
        }

        var batteryPresent = status.BatteryFlag != byte.MaxValue &&
                             (status.BatteryFlag & 128) == 0 &&
                             status.BatteryLifePercent != byte.MaxValue;
        int? percentage = batteryPresent ? Math.Clamp((int)status.BatteryLifePercent, 0, 100) : null;
        return new PowerSnapshot(
            batteryPresent,
            percentage,
            (status.BatteryFlag & 8) != 0,
            status.ACLineStatus == 1);
    }

    private static CpuTimes ReadCpuTimes()
    {
        if (!GetSystemTimes(out var idle, out var kernel, out var user))
        {
            throw new InvalidOperationException(
                $"GetSystemTimes failed with Win32 error {Marshal.GetLastWin32Error()}.");
        }

        return new CpuTimes(idle.ToUInt64(), kernel.ToUInt64(), user.ToUInt64());
    }

    private static ulong SubtractNoUnderflow(ulong value, ulong previous) =>
        value >= previous ? value - previous : 0;

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetSystemTimes(
        out NativeFileTime idleTime,
        out NativeFileTime kernelTime,
        out NativeFileTime userTime);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx buffer);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetSystemPowerStatus(out SystemPowerStatus status);

    private readonly record struct CpuTimes(ulong Idle, ulong Kernel, ulong User);

    private readonly record struct NetworkTotals(
        ulong Received,
        ulong Sent,
        bool IsAvailable,
        string? InterfaceName,
        string? InterfaceType);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeFileTime
    {
        public uint LowDateTime;
        public uint HighDateTime;

        public readonly ulong ToUInt64() => ((ulong)HighDateTime << 32) | LowDateTime;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct MemoryStatusEx
    {
        public uint Length;
        public uint MemoryLoad;
        public ulong TotalPhysical;
        public ulong AvailablePhysical;
        public ulong TotalPageFile;
        public ulong AvailablePageFile;
        public ulong TotalVirtual;
        public ulong AvailableVirtual;
        public ulong AvailableExtendedVirtual;

        public MemoryStatusEx()
        {
            Length = (uint)Marshal.SizeOf<MemoryStatusEx>();
            MemoryLoad = 0;
            TotalPhysical = 0;
            AvailablePhysical = 0;
            TotalPageFile = 0;
            AvailablePageFile = 0;
            TotalVirtual = 0;
            AvailableVirtual = 0;
            AvailableExtendedVirtual = 0;
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SystemPowerStatus
    {
        public byte ACLineStatus;
        public byte BatteryFlag;
        public byte BatteryLifePercent;
        public byte SystemStatusFlag;
        public uint BatteryLifeTime;
        public uint BatteryFullLifeTime;
    }
}

internal sealed record SystemSnapshot(
    DateTimeOffset Timestamp,
    OperatingSystemSnapshot Os,
    CpuSnapshot Cpu,
    MemorySnapshot Memory,
    NetworkSnapshot Network,
    PowerSnapshot Power,
    IReadOnlyList<ProcessSnapshot> Processes,
    DateTimeOffset ProcessSampleTimestamp);

internal sealed record OperatingSystemSnapshot(
    string Version,
    string Description,
    string MachineName,
    long UptimeSeconds);

internal sealed record CpuSnapshot(double UsagePercent, int LogicalProcessors);

internal sealed record MemorySnapshot(
    ulong TotalBytes,
    ulong AvailableBytes,
    ulong UsedBytes,
    double UsagePercent);

internal sealed record NetworkSnapshot(
    bool IsAvailable,
    string? InterfaceName,
    string? InterfaceType,
    double ReceivedBytesPerSecond,
    double SentBytesPerSecond,
    ulong TotalReceivedBytes,
    ulong TotalSentBytes);

internal sealed record PowerSnapshot(
    bool BatteryPresent,
    int? Percentage,
    bool Charging,
    bool AcConnected);

internal sealed record ProcessSnapshot(
    int Pid,
    string Name,
    long WorkingSetBytes,
    double TotalProcessorTimeMs);
