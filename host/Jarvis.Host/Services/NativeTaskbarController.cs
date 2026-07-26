using System.Runtime.InteropServices;
using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Services;

internal static class NativeTaskbarController
{
    private const int SwHide = 0;
    private const int SwShowNoActivate = 8;
    private const uint MonitorDefaultToNull = 0;
    private const uint MonitorInfoPrimary = 1;
    private static int _ownsVisibilityLease;

    public static bool OwnsVisibilityLease => Volatile.Read(ref _ownsVisibilityLease) == 1;

    public static void AcquireVisibilityLease()
    {
        Interlocked.Exchange(ref _ownsVisibilityLease, 1);
    }

    public static bool TryGetVisiblePrimaryBounds(out PixelRect bounds)
    {
        return TryGetVisiblePrimary(out _, out bounds);
    }

    public static bool TryGetVisiblePrimary(out IntPtr taskbar, out PixelRect bounds)
    {
        taskbar = FindPrimaryTaskbar();
        if (taskbar == IntPtr.Zero || !IsWindowVisible(taskbar) || !GetWindowRect(taskbar, out var rect))
        {
            bounds = default;
            return false;
        }

        bounds = new PixelRect(rect.Left, rect.Top, rect.Right, rect.Bottom);
        return NativeDisplay.TryGetPrimaryMonitorBounds(out var monitorBounds) &&
               IsSupportedHorizontalTaskbar(bounds, monitorBounds);
    }

    public static bool IsPrimaryVisible()
    {
        var taskbar = FindPrimaryTaskbar();
        return taskbar != IntPtr.Zero && IsWindowVisible(taskbar);
    }

    public static bool HidePrimary()
    {
        var taskbar = FindPrimaryTaskbar();
        if (taskbar == IntPtr.Zero || !IsWindowVisible(taskbar))
        {
            return false;
        }

        _ = ShowWindowAsync(taskbar, SwHide);
        return true;
    }

    public static void HideReplacementWindow(IntPtr window, int expectedProcessId)
    {
        if (window == IntPtr.Zero || !IsWindow(window))
        {
            return;
        }

        _ = GetWindowThreadProcessId(window, out var processId);
        if (processId == checked((uint)expectedProcessId))
        {
            _ = ShowWindowAsync(window, SwHide);
        }
    }

    public static void RestorePrimary()
    {
        try
        {
            var taskbar = FindPrimaryTaskbar();
            if (taskbar != IntPtr.Zero && !IsWindowVisible(taskbar))
            {
                _ = ShowWindowAsync(taskbar, SwShowNoActivate);
            }
        }
        catch (Exception ex)
        {
            HostLog.Error("Failed to restore the primary Windows taskbar.", ex);
        }
    }

    public static void RestoreOwnedPrimary()
    {
        if (Interlocked.Exchange(ref _ownsVisibilityLease, 0) == 1)
        {
            RestorePrimary();
        }
    }

    private static IntPtr FindPrimaryTaskbar()
    {
        var taskbar = FindWindow("Shell_TrayWnd", null);
        if (taskbar == IntPtr.Zero)
        {
            return IntPtr.Zero;
        }

        var monitor = MonitorFromWindow(taskbar, MonitorDefaultToNull);
        if (monitor == IntPtr.Zero)
        {
            return IntPtr.Zero;
        }

        var monitorInfo = MonitorInfo.Create();
        return GetMonitorInfo(monitor, ref monitorInfo) &&
               (monitorInfo.Flags & MonitorInfoPrimary) != 0
            ? taskbar
            : IntPtr.Zero;
    }

    private static bool IsSupportedHorizontalTaskbar(PixelRect bounds, PixelRect monitorBounds)
    {
        var horizontal = bounds.Width >= 480 && bounds.Width > bounds.Height * 4 && bounds.Height >= 24;
        var spansMonitor = bounds.Left <= monitorBounds.Left + 2 &&
                           bounds.Right >= monitorBounds.Right - 2;
        var attachedToBottom = Math.Abs(bounds.Bottom - monitorBounds.Bottom) <= 2;
        return horizontal && spansMonitor && attachedToBottom;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr FindWindow(string? className, string? windowName);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr window, out NativeRect rect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindowAsync(IntPtr window, int command);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MonitorInfo
    {
        public uint Size;
        public NativeRect Monitor;
        public NativeRect WorkArea;
        public uint Flags;

        public static MonitorInfo Create() => new()
        {
            Size = (uint)Marshal.SizeOf<MonitorInfo>()
        };
    }
}
