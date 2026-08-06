using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Jarvis.Host.Agents;

internal sealed class WindowsProcessJob : IDisposable
{
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;

    private readonly SafeFileHandle _handle;

    private WindowsProcessJob(SafeFileHandle handle)
    {
        _handle = handle;
    }

    public static WindowsProcessJob CreateKillOnClose()
    {
        var handle = NativeMethods.CreateJobObject(IntPtr.Zero, null);
        if (handle.IsInvalid)
        {
            var error = Marshal.GetLastWin32Error();
            handle.Dispose();
            throw new Win32Exception(error, "Could not create the Pi Agent process job.");
        }

        try
        {
            var information = new JobObjectExtendedLimitInformation
            {
                BasicLimitInformation = new JobObjectBasicLimitInformation
                {
                    LimitFlags = JobObjectLimitKillOnJobClose
                }
            };
            if (!NativeMethods.SetInformationJobObject(
                    handle,
                    JobObjectInformationClass.ExtendedLimitInformation,
                    ref information,
                    checked((uint)Marshal.SizeOf<JobObjectExtendedLimitInformation>())))
            {
                throw new Win32Exception(
                    Marshal.GetLastWin32Error(),
                    "Could not configure the Pi Agent process job.");
            }

            return new WindowsProcessJob(handle);
        }
        catch
        {
            handle.Dispose();
            throw;
        }
    }

    public void Assign(Process process)
    {
        ArgumentNullException.ThrowIfNull(process);
        Assign(process.SafeHandle);
    }

    public void Assign(SafeProcessHandle process)
    {
        ArgumentNullException.ThrowIfNull(process);
        if (!NativeMethods.AssignProcessToJobObject(_handle, process))
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error(),
                "Could not contain the Pi Agent process in its shutdown job.");
        }
    }

    public void Dispose()
    {
        _handle.Dispose();
    }

    private enum JobObjectInformationClass
    {
        ExtendedLimitInformation = 9
    }

#pragma warning disable CS0649 // Native layout fields are initialized through default marshalling values.
    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectExtendedLimitInformation
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }
#pragma warning restore CS0649

    private static class NativeMethods
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        public static extern SafeFileHandle CreateJobObject(IntPtr jobAttributes, string? name);

        [DllImport("kernel32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetInformationJobObject(
            SafeFileHandle job,
            JobObjectInformationClass informationClass,
            ref JobObjectExtendedLimitInformation information,
            uint informationLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool AssignProcessToJobObject(
            SafeFileHandle job,
            SafeProcessHandle process);
    }
}
