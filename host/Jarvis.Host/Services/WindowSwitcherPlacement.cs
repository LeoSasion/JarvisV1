namespace Jarvis.Host.Services;

internal static class WindowSwitcherPlacement
{
    private const int LogicalHorizontalMargin = 160;
    private const int LogicalMinimumWidth = 720;
    private const int LogicalMinimumHeight = 300;
    private const int LogicalMaximumWidth = 1120;
    private const int LogicalMaximumHeight = 390;

    public static bool TryCalculate(
        PixelRect workArea,
        int scalePercent,
        out PixelRect windowBounds)
    {
        if (!DisplayPixelScale.IsSupported(scalePercent))
        {
            windowBounds = default;
            return false;
        }

        var horizontalMargin = DisplayPixelScale.LogicalToPhysical(
            LogicalHorizontalMargin,
            scalePercent);
        var minimumWidth = DisplayPixelScale.LogicalToPhysical(
            LogicalMinimumWidth,
            scalePercent);
        var minimumHeight = DisplayPixelScale.LogicalToPhysical(
            LogicalMinimumHeight,
            scalePercent);
        var maximumWidth = DisplayPixelScale.LogicalToPhysical(
            LogicalMaximumWidth,
            scalePercent);
        var maximumHeight = DisplayPixelScale.LogicalToPhysical(
            LogicalMaximumHeight,
            scalePercent);
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
            workArea.Height / 3,
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
}

internal readonly record struct WindowSwitcherPlacementDiagnostic(
    string DeviceName,
    bool UsedPrimaryFallback,
    int ScalePercent,
    PixelRect WorkArea,
    PixelRect WindowBounds);
