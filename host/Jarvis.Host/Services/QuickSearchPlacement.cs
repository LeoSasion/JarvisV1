namespace Jarvis.Host.Services;

internal static class QuickSearchPlacement
{
    private const int LogicalHorizontalMargin = 120;
    private const int LogicalVerticalMargin = 180;
    private const int LogicalMinimumWidth = 640;
    private const int LogicalMinimumHeight = 420;
    private const int LogicalMaximumWidth = 960;
    private const int LogicalMaximumHeight = 700;
    private const int MinimumScalePercent = 100;
    private const int MaximumScalePercent = 500;

    public static bool TryCalculate(
        PixelRect workArea,
        int scalePercent,
        out PixelRect windowBounds)
    {
        if (scalePercent is < MinimumScalePercent or > MaximumScalePercent)
        {
            windowBounds = default;
            return false;
        }

        var horizontalMargin = Scale(LogicalHorizontalMargin, scalePercent);
        var verticalMargin = Scale(LogicalVerticalMargin, scalePercent);
        var minimumWidth = Scale(LogicalMinimumWidth, scalePercent);
        var minimumHeight = Scale(LogicalMinimumHeight, scalePercent);
        var maximumWidth = Scale(LogicalMaximumWidth, scalePercent);
        var maximumHeight = Scale(LogicalMaximumHeight, scalePercent);
        if (workArea.Width < minimumWidth ||
            workArea.Height < minimumHeight)
        {
            windowBounds = default;
            return false;
        }

        var width = Math.Clamp(
            workArea.Width - horizontalMargin,
            minimumWidth,
            Math.Min(maximumWidth, workArea.Width));
        var height = Math.Clamp(
            workArea.Height - verticalMargin,
            minimumHeight,
            Math.Min(maximumHeight, workArea.Height));
        var left = workArea.Left + (workArea.Width - width) / 2;
        var top = workArea.Top + (workArea.Height - height) / 2;
        windowBounds = new PixelRect(
            left,
            top,
            left + width,
            top + height);
        return windowBounds.Width > 0 &&
               windowBounds.Height > 0 &&
               windowBounds.Left >= workArea.Left &&
               windowBounds.Top >= workArea.Top &&
               windowBounds.Right <= workArea.Right &&
               windowBounds.Bottom <= workArea.Bottom;
    }

    private static int Scale(int logicalPixels, int scalePercent) =>
        (int)Math.Round(
            logicalPixels * scalePercent / 100d,
            MidpointRounding.AwayFromZero);
}
