using System.Runtime.InteropServices;
using System.Windows.Interop;

namespace Jarvis.Host.Services;

internal static class NativeDisplay
{
    private const uint MonitorInfoPrimary = 1;
    private const uint MonitorDefaultToPrimary = 1;
    private const uint MonitorDefaultToNearest = 2;
    private const uint SwpNoActivate = 0x0010;
    private const uint SwpNoZOrder = 0x0004;

    public static bool TryGetPrimaryMonitorBounds(out PixelRect bounds)
    {
        if (!TryGetPrimaryMonitor(out var target))
        {
            bounds = default;
            return false;
        }

        bounds = target.Bounds;
        return true;
    }

    public static bool TryGetPrimaryMonitor(out DisplayMonitorTarget target)
    {
        var monitor = MonitorFromPoint(default, MonitorDefaultToPrimary);
        return TryGetMonitorTarget(monitor, out target);
    }

    public static bool TryGetMonitorForWindow(
        IntPtr window,
        out DisplayMonitorTarget target)
    {
        if (window == IntPtr.Zero)
        {
            target = default!;
            return false;
        }

        var monitor = MonitorFromWindow(window, MonitorDefaultToNearest);
        return TryGetMonitorTarget(monitor, out target);
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

    public static DisplayTopologySnapshot CaptureTopology()
    {
        var monitors = new List<DisplayMonitorSnapshot>();
        EnumDisplayMonitors(
            IntPtr.Zero,
            IntPtr.Zero,
            (monitor, _, _, _) =>
            {
                var info = MonitorInfoEx.Create();
                if (!GetMonitorInfoEx(monitor, ref info))
                {
                    return true;
                }

                var dpi = GetMonitorDpi(monitor);
                var bounds = new PixelRect(
                    info.Monitor.Left,
                    info.Monitor.Top,
                    info.Monitor.Right,
                    info.Monitor.Bottom);
                var workArea = new PixelRect(
                    info.WorkArea.Left,
                    info.WorkArea.Top,
                    info.WorkArea.Right,
                    info.WorkArea.Bottom);
                monitors.Add(new DisplayMonitorSnapshot(
                    string.IsNullOrWhiteSpace(info.DeviceName)
                        ? $"DISPLAY-{monitors.Count + 1}"
                        : info.DeviceName,
                    string.IsNullOrWhiteSpace(info.DeviceName)
                        ? $"DISPLAY-{monitors.Count + 1}"
                        : info.DeviceName,
                    (info.Flags & MonitorInfoPrimary) != 0,
                    bounds,
                    workArea,
                    dpi,
                    dpi,
                    (int)Math.Round(dpi / 96d * 100)));
                return true;
            },
            IntPtr.Zero);

        var ordered = monitors
            .OrderByDescending(monitor => monitor.IsPrimary)
            .ThenBy(monitor => monitor.Bounds.Left)
            .ThenBy(monitor => monitor.Bounds.Top)
            .ToArray();
        var virtualBounds = ordered.Length == 0
            ? default
            : new PixelRect(
                ordered.Min(monitor => monitor.Bounds.Left),
                ordered.Min(monitor => monitor.Bounds.Top),
                ordered.Max(monitor => monitor.Bounds.Right),
                ordered.Max(monitor => monitor.Bounds.Bottom));
        var osBuild = Environment.OSVersion.Version.Build;

        return new DisplayTopologySnapshot(
            ordered,
            virtualBounds,
            ordered.FirstOrDefault(monitor => monitor.IsPrimary)?.Id,
            osBuild,
            osBuild >= 17763,
            "primary-only",
            SecondaryTaskbarsPreserved: true,
            CapturedAtUtc: DateTimeOffset.UtcNow);
    }

    private static uint GetMonitorDpi(IntPtr monitor)
    {
        try
        {
            return GetDpiForMonitor(monitor, 0, out var dpiX, out _) == 0 && dpiX > 0
                ? dpiX
                : 96;
        }
        catch (Exception exception) when (
            exception is DllNotFoundException or EntryPointNotFoundException)
        {
            return 96;
        }
    }

    private static bool TryGetMonitorTarget(
        IntPtr monitor,
        out DisplayMonitorTarget target)
    {
        if (monitor == IntPtr.Zero)
        {
            target = default!;
            return false;
        }

        var info = MonitorInfoEx.Create();
        if (!GetMonitorInfoEx(monitor, ref info))
        {
            target = default!;
            return false;
        }

        var bounds = new PixelRect(
            info.Monitor.Left,
            info.Monitor.Top,
            info.Monitor.Right,
            info.Monitor.Bottom);
        var workArea = new PixelRect(
            info.WorkArea.Left,
            info.WorkArea.Top,
            info.WorkArea.Right,
            info.WorkArea.Bottom);
        if (bounds.Width <= 0 ||
            bounds.Height <= 0 ||
            workArea.Width <= 0 ||
            workArea.Height <= 0)
        {
            target = default!;
            return false;
        }

        var dpi = GetMonitorDpi(monitor);
        var deviceName = string.IsNullOrWhiteSpace(info.DeviceName)
            ? "DISPLAY"
            : info.DeviceName;
        target = new DisplayMonitorTarget(
            deviceName,
            (info.Flags & MonitorInfoPrimary) != 0,
            bounds,
            workArea,
            (int)Math.Round(dpi / 96d * 100));
        return true;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromPoint(NativePoint point, uint flags);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "GetMonitorInfoW")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMonitorInfoEx(IntPtr monitor, ref MonitorInfoEx info);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumDisplayMonitors(
        IntPtr deviceContext,
        IntPtr clipRect,
        MonitorEnumProc callback,
        IntPtr data);

    [DllImport("shcore.dll")]
    private static extern int GetDpiForMonitor(
        IntPtr monitor,
        int dpiType,
        out uint dpiX,
        out uint dpiY);

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

    private delegate bool MonitorEnumProc(
        IntPtr monitor,
        IntPtr deviceContext,
        IntPtr monitorRect,
        IntPtr data);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MonitorInfoEx
    {
        public uint Size;
        public NativeRect Monitor;
        public NativeRect WorkArea;
        public uint Flags;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string DeviceName;

        public static MonitorInfoEx Create() => new()
        {
            Size = (uint)Marshal.SizeOf<MonitorInfoEx>(),
            DeviceName = string.Empty
        };
    }
}

internal readonly record struct PixelRect(int Left, int Top, int Right, int Bottom)
{
    public int Width => Math.Max(0, Right - Left);
    public int Height => Math.Max(0, Bottom - Top);
}

internal sealed record DisplayMonitorSnapshot(
    string Id,
    string DeviceName,
    bool IsPrimary,
    PixelRect Bounds,
    PixelRect WorkArea,
    uint DpiX,
    uint DpiY,
    int ScalePercent);

internal sealed record DisplayMonitorTarget(
    string DeviceName,
    bool IsPrimary,
    PixelRect Bounds,
    PixelRect WorkArea,
    int ScalePercent);

internal sealed record DisplayTopologySnapshot(
    IReadOnlyList<DisplayMonitorSnapshot> Monitors,
    PixelRect VirtualBounds,
    string? PrimaryMonitorId,
    int OsBuild,
    bool Windows10Compatible,
    string DesktopSurfacePolicy,
    bool SecondaryTaskbarsPreserved,
    DateTimeOffset CapturedAtUtc);
