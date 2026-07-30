namespace Jarvis.Host.Services;

internal static class TaskbarFlyoutPointerPolicy
{
    public static bool ShouldKeepOpen(
        PixelRect flyoutBounds,
        PixelRect taskbarBounds,
        int anchorScreenX,
        int anchorHalfWidth,
        int cursorX,
        int cursorY)
    {
        if (Contains(flyoutBounds, cursorX, cursorY))
        {
            return true;
        }

        if (!Contains(taskbarBounds, cursorX, cursorY))
        {
            return false;
        }

        var safeHalfWidth = Math.Max(1, anchorHalfWidth);
        var distance = Math.Abs((long)cursorX - anchorScreenX);
        return distance <= safeHalfWidth;
    }

    private static bool Contains(PixelRect rect, int x, int y) =>
        x >= rect.Left &&
        x < rect.Right &&
        y >= rect.Top &&
        y < rect.Bottom;
}
