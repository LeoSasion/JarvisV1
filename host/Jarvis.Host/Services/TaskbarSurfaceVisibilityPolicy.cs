namespace Jarvis.Host.Services;

internal static class TaskbarSurfaceVisibilityPolicy
{
    public static bool ShouldShow(
        bool lifecycleActivated,
        bool fullscreenSuppressed) =>
        lifecycleActivated && !fullscreenSuppressed;
}
