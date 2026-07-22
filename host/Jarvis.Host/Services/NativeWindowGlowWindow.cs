using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;

namespace Jarvis.Host.Services;

/// <summary>
/// Renders the active-window aura as four narrow layered windows instead of one
/// full-window transparent surface. PixelRect values are native screen pixels;
/// visual extents are authored in DIPs and converted using the target monitor DPI.
/// </summary>
internal sealed class NativeWindowGlowWindow : AuraEdgeWindow
{
    private const double OuterExtentDip = 14;
    private const double InnerOverlapDip = 2;
    private const uint MonitorDefaultToNearest = 0x00000002;
    private const int DefaultDpi = 96;

    private static readonly IntPtr HwndTop = IntPtr.Zero;

    private readonly AuraEdgeWindow[] _edges;

    private bool _closed;

    public NativeWindowGlowWindow()
        : base(AuraEdge.Top)
    {
        // Keep this type as a Window for the service's existing HWND/recovery
        // contract; the primary window is simply the top strip now.
        _edges =
        [
            this,
            new AuraEdgeWindow(AuraEdge.Right),
            new AuraEdgeWindow(AuraEdge.Bottom),
            new AuraEdgeWindow(AuraEdge.Left)
        ];
    }

    public void ShowAround(PixelRect bounds)
    {
        ObjectDisposedException.ThrowIf(_closed, this);

        var targetWidth = (long)bounds.Right - bounds.Left;
        var targetHeight = (long)bounds.Bottom - bounds.Top;
        if (targetWidth <= 0 || targetHeight <= 0 ||
            targetWidth > int.MaxValue || targetHeight > int.MaxValue)
        {
            HideAura();
            return;
        }

        var targetWindow = FindLikelyTargetWindow(bounds);
        var dpi = GetTargetDpi(targetWindow, bounds);
        var outerExtent = Math.Max(1, DipToPixels(OuterExtentDip, dpi));
        var innerOverlap = Math.Max(1, DipToPixels(InnerOverlapDip, dpi));

        if (!TryCreateEdgeRects(bounds, outerExtent, innerOverlap, out var edgeRects))
        {
            HideAura();
            return;
        }

        foreach (var edge in _edges)
        {
            edge.EnsureEdgeVisible();
        }

        // The aura sits immediately behind the active target whenever possible.
        // This preserves the target's glow without creating a permanent topmost
        // surface that can float above an unrelated window after focus changes.
        var insertAfter = targetWindow != IntPtr.Zero ? targetWindow : HwndTop;
        for (var index = _edges.Length - 1; index >= 0; index--)
        {
            if (!_edges[index].Position(edgeRects[index], insertAfter))
            {
                HideAura();
                return;
            }
        }
    }

    public void HideAura()
    {
        foreach (var edge in _edges)
        {
            edge.HideEdge();
        }
    }

    /// <summary>
    /// Best-effort non-dispatcher escape hatch for process-exit and safety-hotkey
    /// paths. This intentionally touches only cached HWND values and Win32.
    /// </summary>
    public void EmergencyHide()
    {
        foreach (var edge in _edges)
        {
            edge.EmergencyHideEdge();
        }
    }

    public NativeWindowGlowDiagnostic CaptureDiagnostics()
    {
        var createdEdges = 0;
        var clickThroughEdges = 0;
        foreach (var edge in _edges)
        {
            var status = edge.CaptureNativeStyleStatus();
            if (!status.Created)
            {
                continue;
            }

            createdEdges++;
            if (status.ClickThroughAndNonActivating)
            {
                clickThroughEdges++;
            }
        }

        return new NativeWindowGlowDiagnostic(createdEdges, clickThroughEdges);
    }

    protected override void OnClosed(EventArgs e)
    {
        if (_closed)
        {
            base.OnClosed(e);
            return;
        }

        _closed = true;
        for (var index = 1; index < _edges.Length; index++)
        {
            _edges[index].Close();
        }

        base.OnClosed(e);
    }

    private static IntPtr FindLikelyTargetWindow(PixelRect bounds)
    {
        var foreground = GetForegroundWindow();
        if (foreground == IntPtr.Zero || !IsWindow(foreground) ||
            !GetWindowRect(foreground, out var windowRect))
        {
            return IntPtr.Zero;
        }

        // The service passes DWM extended frame bounds, while GetWindowRect may
        // include a small invisible resize border. Requiring at least half of
        // both dimensions rejects a foreground race without requiring exact edges.
        var intersectionWidth = Math.Min((long)bounds.Right, windowRect.Right) -
                                Math.Max((long)bounds.Left, windowRect.Left);
        var intersectionHeight = Math.Min((long)bounds.Bottom, windowRect.Bottom) -
                                 Math.Max((long)bounds.Top, windowRect.Top);
        var targetWidth = (long)bounds.Right - bounds.Left;
        var targetHeight = (long)bounds.Bottom - bounds.Top;
        var foregroundWidth = (long)windowRect.Right - windowRect.Left;
        var foregroundHeight = (long)windowRect.Bottom - windowRect.Top;
        return intersectionWidth >= Math.Min(targetWidth, foregroundWidth) / 2 &&
               intersectionHeight >= Math.Min(targetHeight, foregroundHeight) / 2
            ? foreground
            : IntPtr.Zero;
    }

    private static uint GetTargetDpi(IntPtr targetWindow, PixelRect bounds)
    {
        if (targetWindow != IntPtr.Zero)
        {
            try
            {
                var windowDpi = GetDpiForWindow(targetWindow);
                if (windowDpi > 0)
                {
                    return windowDpi;
                }
            }
            catch (EntryPointNotFoundException)
            {
                // Windows 10 1607+ exposes GetDpiForWindow. Retain the monitor
                // fallback for older-compatible hosts and unusual environments.
            }
        }

        try
        {
            var nativeRect = new NativeRect(bounds.Left, bounds.Top, bounds.Right, bounds.Bottom);
            var monitor = MonitorFromRect(ref nativeRect, MonitorDefaultToNearest);
            if (monitor != IntPtr.Zero &&
                GetDpiForMonitor(monitor, MonitorDpiType.Effective, out var dpiX, out _) == 0 &&
                dpiX > 0)
            {
                return dpiX;
            }
        }
        catch (DllNotFoundException)
        {
            // SHCore exists on all supported Windows 10+ systems; use 96 DPI if
            // the host is nevertheless running in a reduced compatibility layer.
        }
        catch (EntryPointNotFoundException)
        {
            // See compatibility fallback above.
        }

        return DefaultDpi;
    }

    private static int DipToPixels(double dips, uint dpi) =>
        checked((int)Math.Ceiling(dips * dpi / DefaultDpi));

    private static bool TryCreateEdgeRects(
        PixelRect bounds,
        int outerExtent,
        int innerOverlap,
        out NativeRect[] edgeRects)
    {
        edgeRects = [];
        try
        {
            var targetWidth = checked((int)((long)bounds.Right - bounds.Left));
            var targetHeight = checked((int)((long)bounds.Bottom - bounds.Top));
            var horizontalWidth = checked(targetWidth + (outerExtent * 2));
            var horizontalDepth = checked(outerExtent + innerOverlap);
            var verticalHeight = targetHeight;
            var verticalDepth = horizontalDepth;

            edgeRects =
            [
                NativeRect.FromPositionAndSize(
                    checked(bounds.Left - outerExtent),
                    checked(bounds.Top - outerExtent),
                    horizontalWidth,
                    horizontalDepth),
                NativeRect.FromPositionAndSize(
                    checked(bounds.Right - innerOverlap),
                    bounds.Top,
                    verticalDepth,
                    verticalHeight),
                NativeRect.FromPositionAndSize(
                    checked(bounds.Left - outerExtent),
                    checked(bounds.Bottom - innerOverlap),
                    horizontalWidth,
                    horizontalDepth),
                NativeRect.FromPositionAndSize(
                    checked(bounds.Left - outerExtent),
                    bounds.Top,
                    verticalDepth,
                    verticalHeight)
            ];
            return true;
        }
        catch (OverflowException)
        {
            return false;
        }
    }

    private enum MonitorDpiType
    {
        Effective = 0
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;

        public NativeRect(int left, int top, int right, int bottom)
        {
            Left = left;
            Top = top;
            Right = right;
            Bottom = bottom;
        }

        public readonly int Width => checked(Right - Left);
        public readonly int Height => checked(Bottom - Top);

        public static NativeRect FromPositionAndSize(int left, int top, int width, int height) =>
            new(left, top, checked(left + width), checked(top + height));
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr window, out NativeRect rectangle);

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromRect(ref NativeRect rectangle, uint flags);

    [DllImport("shcore.dll")]
    private static extern int GetDpiForMonitor(
        IntPtr monitor,
        MonitorDpiType dpiType,
        out uint dpiX,
        out uint dpiY);
}

internal enum AuraEdge
{
    Top,
    Right,
    Bottom,
    Left
}

internal class AuraEdgeWindow : Window
{
    private const int GwlExStyle = -20;
    private const long WsExTransparent = 0x00000020L;
    private const long WsExToolWindow = 0x00000080L;
    private const long WsExNoActivate = 0x08000000L;
    private const int WmMouseActivate = 0x0021;
    private const int WmNcHitTest = 0x0084;
    private const int MaNoActivate = 3;
    private const int HtTransparent = -1;
    private const int SwHide = 0;
    private const uint SwpNoActivate = 0x0010;
    private const uint SwpShowWindow = 0x0040;

    private HwndSource? _source;
    private IntPtr _handle;

    public AuraEdgeWindow(AuraEdge edge)
    {
        Title = "JARVIS Window Aura";
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        ShowInTaskbar = false;
        ShowActivated = false;
        Focusable = false;
        IsHitTestVisible = false;
        Topmost = false;
        Left = -32000;
        Top = -32000;
        Width = 1;
        Height = 1;
        UseLayoutRounding = true;
        SnapsToDevicePixels = true;
        Content = BuildAura(edge);
        SourceInitialized += OnSourceInitialized;
    }

    public void EnsureEdgeVisible()
    {
        if (!IsVisible)
        {
            Show();
        }
    }

    public bool Position(NativeWindowGlowWindow.NativeRect rectangle, IntPtr insertAfter)
    {
        var handle = new WindowInteropHelper(this).Handle;
        return handle != IntPtr.Zero && SetWindowPos(
            handle,
            insertAfter,
            rectangle.Left,
            rectangle.Top,
            rectangle.Width,
            rectangle.Height,
            SwpNoActivate | SwpShowWindow);
    }

    public void HideEdge()
    {
        if (IsVisible)
        {
            Hide();
        }
    }

    public void EmergencyHideEdge()
    {
        var handle = Interlocked.CompareExchange(ref _handle, IntPtr.Zero, IntPtr.Zero);
        if (handle != IntPtr.Zero && IsWindow(handle))
        {
            _ = ShowWindowAsync(handle, SwHide);
        }
    }

    public AuraEdgeNativeStyleStatus CaptureNativeStyleStatus()
    {
        var handle = Interlocked.CompareExchange(ref _handle, IntPtr.Zero, IntPtr.Zero);
        if (handle == IntPtr.Zero || !IsWindow(handle))
        {
            return new AuraEdgeNativeStyleStatus(false, false);
        }

        var extendedStyle = GetWindowLongPtr(handle, GwlExStyle).ToInt64();
        var requiredStyles = WsExTransparent | WsExToolWindow | WsExNoActivate;
        return new AuraEdgeNativeStyleStatus(
            true,
            (extendedStyle & requiredStyles) == requiredStyles);
    }

    protected override void OnClosed(EventArgs e)
    {
        _source?.RemoveHook(WindowProcedure);
        _source = null;
        _ = Interlocked.Exchange(ref _handle, IntPtr.Zero);
        base.OnClosed(e);
    }

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        var handle = new WindowInteropHelper(this).Handle;
        _ = Interlocked.Exchange(ref _handle, handle);
        var extendedStyle = GetWindowLongPtr(handle, GwlExStyle).ToInt64();
        _ = SetWindowLongPtr(
            handle,
            GwlExStyle,
            new IntPtr(extendedStyle | WsExTransparent | WsExToolWindow | WsExNoActivate));
        _source = HwndSource.FromHwnd(handle);
        _source?.AddHook(WindowProcedure);
    }

    private static Grid BuildAura(AuraEdge edge)
    {
        var grid = new Grid
        {
            IsHitTestVisible = false,
            SnapsToDevicePixels = true,
            Background = CreateGlowBrush(edge)
        };

        var highlight = new SolidColorBrush(Color.FromArgb(225, 117, 211, 255));
        highlight.Freeze();
        grid.Children.Add(new Border
        {
            BorderThickness = edge switch
            {
                AuraEdge.Top => new Thickness(0, 0, 0, 1),
                AuraEdge.Right => new Thickness(1, 0, 0, 0),
                AuraEdge.Bottom => new Thickness(0, 1, 0, 0),
                AuraEdge.Left => new Thickness(0, 0, 1, 0),
                _ => new Thickness(0)
            },
            BorderBrush = highlight,
            SnapsToDevicePixels = true
        });
        return grid;
    }

    private static LinearGradientBrush CreateGlowBrush(AuraEdge edge)
    {
        var inwardAtEnd = edge is AuraEdge.Top or AuraEdge.Left;
        var brush = new LinearGradientBrush
        {
            StartPoint = edge is AuraEdge.Top or AuraEdge.Bottom
                ? new Point(0.5, 0)
                : new Point(0, 0.5),
            EndPoint = edge is AuraEdge.Top or AuraEdge.Bottom
                ? new Point(0.5, 1)
                : new Point(1, 0.5),
            MappingMode = BrushMappingMode.RelativeToBoundingBox
        };

        var transparent = Color.FromArgb(0, 14, 106, 204);
        var outerGlow = Color.FromArgb(22, 27, 139, 235);
        var midGlow = Color.FromArgb(76, 33, 162, 255);
        var innerGlow = Color.FromArgb(168, 45, 181, 255);
        if (inwardAtEnd)
        {
            brush.GradientStops.Add(new GradientStop(transparent, 0));
            brush.GradientStops.Add(new GradientStop(outerGlow, 0.38));
            brush.GradientStops.Add(new GradientStop(midGlow, 0.72));
            brush.GradientStops.Add(new GradientStop(innerGlow, 1));
        }
        else
        {
            brush.GradientStops.Add(new GradientStop(innerGlow, 0));
            brush.GradientStops.Add(new GradientStop(midGlow, 0.28));
            brush.GradientStops.Add(new GradientStop(outerGlow, 0.62));
            brush.GradientStops.Add(new GradientStop(transparent, 1));
        }

        brush.Freeze();
        return brush;
    }

    private static IntPtr WindowProcedure(
        IntPtr window,
        int message,
        IntPtr wordParameter,
        IntPtr longParameter,
        ref bool handled)
    {
        if (message == WmMouseActivate)
        {
            handled = true;
            return new IntPtr(MaNoActivate);
        }

        if (message == WmNcHitTest)
        {
            handled = true;
            return new IntPtr(HtTransparent);
        }

        return IntPtr.Zero;
    }

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr64(IntPtr window, int index);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern IntPtr GetWindowLong32(IntPtr window, int index);

    private static IntPtr GetWindowLongPtr(IntPtr window, int index) =>
        IntPtr.Size == 8 ? GetWindowLongPtr64(window, index) : GetWindowLong32(window, index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr64(IntPtr window, int index, IntPtr newValue);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
    private static extern IntPtr SetWindowLong32(IntPtr window, int index, IntPtr newValue);

    private static IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr newValue) =>
        IntPtr.Size == 8
            ? SetWindowLongPtr64(window, index, newValue)
            : SetWindowLong32(window, index, newValue);

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

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindowAsync(IntPtr window, int command);
}

internal sealed record NativeWindowGlowDiagnostic(int CreatedEdges, int ClickThroughEdges)
{
    public bool Ready => CreatedEdges == 0 || CreatedEdges == ClickThroughEdges;
}

internal readonly record struct AuraEdgeNativeStyleStatus(
    bool Created,
    bool ClickThroughAndNonActivating);
