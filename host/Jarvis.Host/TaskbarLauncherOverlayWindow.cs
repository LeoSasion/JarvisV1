using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Effects;
using Jarvis.Host.Infrastructure;
using Jarvis.Host.Services;

namespace Jarvis.Host;

internal abstract class TaskbarOverlayWindow : Window
{
    private const int GwlExStyle = -20;
    private const long WsExTransparent = 0x00000020L;
    private const long WsExToolWindow = 0x00000080L;
    private const long WsExNoActivate = 0x08000000L;

    protected TaskbarOverlayWindow(string title, UIElement content)
    {
        Title = title;
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        WindowStartupLocation = WindowStartupLocation.Manual;
        ShowInTaskbar = false;
        ShowActivated = false;
        Topmost = true;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        IsHitTestVisible = false;
        Focusable = false;
        Left = -32000;
        Top = -32000;
        Width = 1;
        Height = 1;

        Content = content;
        SourceInitialized += OnSourceInitialized;
    }

    public bool ShowAt(PixelRect bounds, IntPtr owner)
    {
        if (!IsVisible)
        {
            if (owner != IntPtr.Zero)
            {
                new WindowInteropHelper(this).Owner = owner;
            }

            Show();
        }

        return NativeDisplay.PositionWindow(this, bounds);
    }

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        var handle = new WindowInteropHelper(this).Handle;
        if (handle == IntPtr.Zero)
        {
            return;
        }

        var extendedStyle = GetWindowLongPtr(handle, GwlExStyle).ToInt64();
        _ = SetWindowLongPtr(
            handle,
            GwlExStyle,
            new IntPtr(extendedStyle | WsExTransparent | WsExToolWindow | WsExNoActivate));
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
}

internal sealed class TaskbarEdgeOverlayWindow : TaskbarOverlayWindow
{
    public TaskbarEdgeOverlayWindow()
        : base("JARVIS Taskbar Edge Overlay", CreateEdge())
    {
    }

    private static UIElement CreateEdge()
    {
        var brush = new SolidColorBrush(Color.FromArgb(
            176,
            NativeVisualPalette.AccentColor.R,
            NativeVisualPalette.AccentColor.G,
            NativeVisualPalette.AccentColor.B));
        brush.Freeze();

        return new Border
        {
            Height = 1,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Center,
            Background = brush,
            SnapsToDevicePixels = true,
            IsHitTestVisible = false,
            Effect = new DropShadowEffect
            {
                BlurRadius = 4,
                Color = NativeVisualPalette.AccentColor,
                Direction = 0,
                Opacity = 0.56,
                ShadowDepth = 0,
            },
        };
    }
}
