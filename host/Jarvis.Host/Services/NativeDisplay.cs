using System.Runtime.InteropServices;
using System.Windows.Interop;

namespace Jarvis.Host.Services;

internal static class NativeDisplay
{
    private const uint MonitorDefaultToPrimary = 1;
    private const uint SwpNoActivate = 0x0010;
    private const uint SwpNoZOrder = 0x0004;

    public static bool TryGetPrimaryMonitorBounds(out PixelRect bounds)
    {
        var monitor = MonitorFromPoint(default, MonitorDefaultToPrimary);
        if (monitor == IntPtr.Zero)
        {
            bounds = default;
            return false;
        }

        var info = MonitorInfo.Create();
        if (!GetMonitorInfo(monitor, ref info))
        {
            bounds = default;
            return false;
        }

        bounds = new PixelRect(
            info.Monitor.Left,
            info.Monitor.Top,
            info.Monitor.Right,
            info.Monitor.Bottom);
        return bounds.Width > 0 && bounds.Height > 0;
    }

    public static bool PositionWindow(System.Windows.Window window, PixelRect bounds)
    {
        var handle = new WindowInteropHelper(window).Handle;
        return handle != IntPtr.Zero && SetWindowPos(
            handle,
            IntPtr.Zero,
            bounds.Left,
            bounds.Top,
            bounds.Width,
            bounds.Height,
            SwpNoActivate | SwpNoZOrder);
    }

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromPoint(NativePoint point, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(
        IntPtr window,
        IntPtr insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags);

    [StructLayout(LayoutKind.Sequential)]
    private readonly struct NativePoint
    {
        public readonly int X;
        public readonly int Y;
    }

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

internal readonly record struct PixelRect(int Left, int Top, int Right, int Bottom)
{
    public int Width => Math.Max(0, Right - Left);
    public int Height => Math.Max(0, Bottom - Top);
}
