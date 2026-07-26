using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows;
using System.Windows.Interop;
using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Services;

internal static class NativeShellSurfaceService
{
    private const int RgnDiff = 4;

    public static bool TryCapture(out NativeShellSurfaceSnapshot snapshot, out string? failureReason)
    {
        snapshot = default;
        failureReason = null;

        if (!NativeTaskbarController.TryGetVisiblePrimary(out var taskbarHandle, out var taskbarBounds))
        {
            failureReason = "The visible bottom-aligned primary Windows taskbar is unavailable.";
            return false;
        }

        _ = GetWindowThreadProcessId(taskbarHandle, out var taskbarProcessId);
        if (!IsExplorerProcess(taskbarProcessId))
        {
            failureReason = "The primary taskbar is not owned by the current Explorer process.";
            return false;
        }

        var notificationHandle = FindVisibleDescendant(taskbarHandle, "TrayNotifyWnd");
        if (notificationHandle == IntPtr.Zero ||
            !GetWindowRect(notificationHandle, out var notificationRect))
        {
            failureReason = "Explorer's native notification area could not be located.";
            return false;
        }

        var rawNotificationBounds = new PixelRect(
            notificationRect.Left,
            notificationRect.Top,
            notificationRect.Right,
            notificationRect.Bottom);
        if (!IsValidNotificationArea(taskbarBounds, rawNotificationBounds))
        {
            failureReason = "Explorer's notification area geometry failed the safety contract.";
            return false;
        }

        var exclusionBounds = new PixelRect(
            Math.Clamp(rawNotificationBounds.Left, taskbarBounds.Left, taskbarBounds.Right),
            taskbarBounds.Top,
            taskbarBounds.Right,
            taskbarBounds.Bottom);
        snapshot = new NativeShellSurfaceSnapshot(
            taskbarHandle,
            notificationHandle,
            checked((int)taskbarProcessId),
            taskbarBounds,
            exclusionBounds);
        return true;
    }

    public static bool ApplyNotificationAreaExclusion(
        Window window,
        PixelRect windowBounds,
        PixelRect notificationAreaBounds)
    {
        var handle = new WindowInteropHelper(window).Handle;
        if (handle == IntPtr.Zero)
        {
            return false;
        }

        var relativeLeft = Math.Clamp(
            notificationAreaBounds.Left - windowBounds.Left,
            0,
            windowBounds.Width);
        var relativeTop = Math.Clamp(
            notificationAreaBounds.Top - windowBounds.Top,
            0,
            windowBounds.Height);
        var relativeRight = Math.Clamp(
            notificationAreaBounds.Right - windowBounds.Left,
            relativeLeft,
            windowBounds.Width);
        var relativeBottom = Math.Clamp(
            notificationAreaBounds.Bottom - windowBounds.Top,
            relativeTop,
            windowBounds.Height);
        if (relativeRight <= relativeLeft || relativeBottom <= relativeTop)
        {
            return false;
        }

        var fullRegion = CreateRectRgn(0, 0, windowBounds.Width, windowBounds.Height);
        var exclusionRegion = CreateRectRgn(
            relativeLeft,
            relativeTop,
            relativeRight,
            relativeBottom);
        if (fullRegion == IntPtr.Zero || exclusionRegion == IntPtr.Zero)
        {
            if (fullRegion != IntPtr.Zero)
            {
                _ = DeleteObject(fullRegion);
            }
            if (exclusionRegion != IntPtr.Zero)
            {
                _ = DeleteObject(exclusionRegion);
            }
            return false;
        }

        try
        {
            if (CombineRgn(fullRegion, fullRegion, exclusionRegion, RgnDiff) == 0)
            {
                return false;
            }

            if (SetWindowRgn(handle, fullRegion, redraw: true) == 0)
            {
                return false;
            }

            // Ownership transfers to Windows after a successful SetWindowRgn call.
            fullRegion = IntPtr.Zero;
            return true;
        }
        finally
        {
            if (fullRegion != IntPtr.Zero)
            {
                _ = DeleteObject(fullRegion);
            }
            _ = DeleteObject(exclusionRegion);
        }
    }

    public static void ClearWindowRegion(Window window)
    {
        var handle = new WindowInteropHelper(window).Handle;
        if (handle != IntPtr.Zero)
        {
            _ = SetWindowRgn(handle, IntPtr.Zero, redraw: true);
        }
    }

    private static bool IsExplorerProcess(uint processId)
    {
        if (processId == 0)
        {
            return false;
        }

        try
        {
            using var process = Process.GetProcessById(checked((int)processId));
            return process.ProcessName.Equals("explorer", StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception ex) when (
            ex is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            return false;
        }
    }

    private static bool IsValidNotificationArea(PixelRect taskbar, PixelRect notificationArea)
    {
        var insideTaskbar = notificationArea.Left >= taskbar.Left &&
                            notificationArea.Right <= taskbar.Right + 2 &&
                            notificationArea.Top >= taskbar.Top - 2 &&
                            notificationArea.Bottom <= taskbar.Bottom + 2;
        var plausibleWidth = notificationArea.Width >= 80 &&
                             notificationArea.Width <= taskbar.Width / 2;
        var plausibleHeight = notificationArea.Height >= Math.Min(20, taskbar.Height) &&
                              notificationArea.Height <= taskbar.Height + 4;
        var attachedToRight = Math.Abs(notificationArea.Right - taskbar.Right) <= 48;
        return insideTaskbar && plausibleWidth && plausibleHeight && attachedToRight;
    }

    private static IntPtr FindVisibleDescendant(IntPtr parent, string className)
    {
        var match = IntPtr.Zero;
        _ = EnumChildWindows(
            parent,
            (window, _) =>
            {
                if (!IsWindowVisible(window))
                {
                    return true;
                }

                var buffer = new StringBuilder(128);
                _ = GetClassName(window, buffer, buffer.Capacity);
                if (!buffer.ToString().Equals(className, StringComparison.Ordinal))
                {
                    return true;
                }

                match = window;
                return false;
            },
            IntPtr.Zero);
        return match;
    }

    private delegate bool EnumChildWindowsCallback(IntPtr window, IntPtr state);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumChildWindows(
        IntPtr parent,
        EnumChildWindowsCallback callback,
        IntPtr state);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, StringBuilder className, int maximumCount);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr window, out NativeRect rectangle);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);

    [DllImport("gdi32.dll")]
    private static extern int CombineRgn(
        IntPtr destination,
        IntPtr sourceOne,
        IntPtr sourceTwo,
        int combineMode);

    [DllImport("user32.dll")]
    private static extern int SetWindowRgn(IntPtr window, IntPtr region, bool redraw);

    [DllImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeleteObject(IntPtr value);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}

internal readonly record struct NativeShellSurfaceSnapshot(
    IntPtr TaskbarHandle,
    IntPtr NotificationAreaHandle,
    int ExplorerProcessId,
    PixelRect TaskbarBounds,
    PixelRect NotificationAreaBounds);
