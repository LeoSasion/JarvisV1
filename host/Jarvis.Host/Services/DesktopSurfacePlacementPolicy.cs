namespace Jarvis.Host.Services;

internal static class DesktopSurfacePlacementPolicy
{
    public static PixelRect Resolve(
        DisplayMonitorTarget monitor,
        TaskbarMode effectiveMode,
        bool keepNativeTaskbar)
    {
        return effectiveMode == TaskbarMode.Full && !keepNativeTaskbar
            ? monitor.Bounds
            : monitor.WorkArea;
    }
}
