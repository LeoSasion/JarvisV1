namespace Jarvis.Host.Services;

internal static class TaskbarFullscreenPolicy
{
    internal const int FrameTolerancePixels = 8;
    internal const long CaptionStyle = 0x00C00000L;
    internal const long ThickFrameStyle = 0x00040000L;
    internal const long MaximizedStyle = 0x01000000L;

    public static bool ShouldSuppress(
        PixelRect windowBounds,
        DisplayMonitorTarget monitor,
        bool windowVisible,
        bool minimized,
        bool standardMaximizedWindow)
    {
        if (!windowVisible ||
            minimized ||
            standardMaximizedWindow ||
            !monitor.IsPrimary ||
            windowBounds.Width <= 0 ||
            windowBounds.Height <= 0 ||
            monitor.Bounds.Width <= 0 ||
            monitor.Bounds.Height <= 0)
        {
            return false;
        }

        return IsNear(windowBounds.Left, monitor.Bounds.Left) &&
               IsNear(windowBounds.Top, monitor.Bounds.Top) &&
               IsNear(windowBounds.Right, monitor.Bounds.Right) &&
               IsNear(windowBounds.Bottom, monitor.Bounds.Bottom);
    }

    internal static bool IsStandardMaximizedWindow(bool isZoomed, long style)
    {
        var maximized = isZoomed ||
                        (style & MaximizedStyle) == MaximizedStyle;
        var hasStandardFrame =
            (style & CaptionStyle) == CaptionStyle &&
            (style & ThickFrameStyle) == ThickFrameStyle;

        return maximized && hasStandardFrame;
    }

    private static bool IsNear(int value, int target) =>
        Math.Abs((long)value - target) <= FrameTolerancePixels;
}
