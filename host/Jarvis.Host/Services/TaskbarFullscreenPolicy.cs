namespace Jarvis.Host.Services;

internal static class TaskbarFullscreenPolicy
{
    internal const int FrameTolerancePixels = 8;

    public static bool ShouldSuppress(
        PixelRect windowBounds,
        DisplayMonitorTarget monitor,
        bool windowVisible,
        bool minimized,
        bool windowMaximized)
    {
        if (!windowVisible ||
            minimized ||
            windowMaximized ||
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

    private static bool IsNear(int value, int target) =>
        Math.Abs((long)value - target) <= FrameTolerancePixels;
}
