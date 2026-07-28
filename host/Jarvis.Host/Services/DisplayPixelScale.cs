namespace Jarvis.Host.Services;

internal static class DisplayPixelScale
{
    private const int MinimumPercent = 100;
    private const int MaximumPercent = 500;

    public static bool IsSupported(int scalePercent) =>
        scalePercent is >= MinimumPercent and <= MaximumPercent;

    public static int LogicalToPhysical(
        int logicalPixels,
        int scalePercent) =>
        (int)Math.Round(
            logicalPixels * scalePercent / 100d,
            MidpointRounding.AwayFromZero);
}
