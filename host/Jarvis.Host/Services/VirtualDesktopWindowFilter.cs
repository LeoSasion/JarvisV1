using System.Runtime.InteropServices;
using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Services;

internal enum VirtualDesktopMembership
{
    Current,
    Other,
    Unavailable
}

internal static class VirtualDesktopScopePolicy
{
    public static bool ShouldInclude(VirtualDesktopMembership membership) =>
        membership != VirtualDesktopMembership.Other;
}

internal sealed class VirtualDesktopWindowFilter : IDisposable
{
    private static readonly Guid VirtualDesktopManagerClassId =
        new("AA509086-5CA9-4C25-8F95-589D3C07B48A");

    private readonly object _gate = new();
    private IVirtualDesktopManager? _manager;
    private bool _disposed;
    private bool _queryFailureReported;

    public VirtualDesktopWindowFilter()
    {
        _manager = TryCreateManager();
        if (_manager is null)
        {
            HostLog.Warning(
                "Current virtual desktop filtering is unavailable; taskbar enumeration will fail open.");
        }
        else
        {
            HostLog.Info(
                "Current virtual desktop filtering is active through the documented IVirtualDesktopManager API.");
        }
    }

    public bool IsAvailable
    {
        get
        {
            lock (_gate)
            {
                return !_disposed && _manager is not null;
            }
        }
    }

    public VirtualDesktopMembership Query(IntPtr window)
    {
        if (window == IntPtr.Zero)
        {
            return VirtualDesktopMembership.Unavailable;
        }

        lock (_gate)
        {
            if (_disposed || _manager is null)
            {
                return VirtualDesktopMembership.Unavailable;
            }

            try
            {
                var result = _manager.IsWindowOnCurrentVirtualDesktop(
                    window,
                    out var onCurrentDesktop);
                return result >= 0
                    ? onCurrentDesktop
                        ? VirtualDesktopMembership.Current
                        : VirtualDesktopMembership.Other
                    : VirtualDesktopMembership.Unavailable;
            }
            catch (Exception exception) when (
                exception is not OutOfMemoryException)
            {
                if (!_queryFailureReported)
                {
                    _queryFailureReported = true;
                    HostLog.Warning(
                        $"A virtual desktop membership query failed with {exception.GetType().Name}; " +
                        "taskbar enumeration remains fail-open.");
                }

                return VirtualDesktopMembership.Unavailable;
            }
        }
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
            var manager = _manager;
            _manager = null;
            if (manager is not null && Marshal.IsComObject(manager))
            {
                try
                {
                    _ = Marshal.FinalReleaseComObject(manager);
                }
                catch (Exception exception) when (
                    exception is not OutOfMemoryException)
                {
                    HostLog.Warning(
                        $"The virtual desktop COM manager could not be released cleanly: " +
                        $"{exception.GetType().Name}.");
                }
            }
        }
    }

    private static IVirtualDesktopManager? TryCreateManager()
    {
        try
        {
            var type = Type.GetTypeFromCLSID(
                VirtualDesktopManagerClassId,
                throwOnError: false);
            return type is null
                ? null
                : Activator.CreateInstance(type) as IVirtualDesktopManager;
        }
        catch (Exception exception) when (
            exception is not OutOfMemoryException)
        {
            return null;
        }
    }

    [ComImport]
    [Guid("A5CD92FF-29BE-454C-8D04-D82879FB3F1B")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IVirtualDesktopManager
    {
        [PreserveSig]
        int IsWindowOnCurrentVirtualDesktop(
            IntPtr topLevelWindow,
            [MarshalAs(UnmanagedType.Bool)] out bool onCurrentDesktop);

        [PreserveSig]
        int GetWindowDesktopId(IntPtr topLevelWindow, out Guid desktopId);

        [PreserveSig]
        int MoveWindowToDesktop(IntPtr topLevelWindow, in Guid desktopId);
    }
}
