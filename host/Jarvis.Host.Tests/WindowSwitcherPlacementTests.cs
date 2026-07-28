using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class WindowSwitcherPlacementTests
{
    [Fact]
    public void CentersMaximumSurfaceInsidePrimaryWorkArea()
    {
        var success = WindowSwitcherPlacement.TryCalculate(
            new PixelRect(0, 0, 2560, 1392),
            100,
            out var bounds);

        Assert.True(success);
        Assert.Equal(new PixelRect(720, 501, 1840, 891), bounds);
    }

    [Fact]
    public void PreservesNegativeCoordinatesOnLeftHandMonitor()
    {
        var success = WindowSwitcherPlacement.TryCalculate(
            new PixelRect(-1920, 24, 0, 1080),
            100,
            out var bounds);

        Assert.True(success);
        Assert.Equal(new PixelRect(-1520, 376, -400, 728), bounds);
    }

    [Fact]
    public void ShrinksWithoutLeavingCompactWorkArea()
    {
        var success = WindowSwitcherPlacement.TryCalculate(
            new PixelRect(0, 0, 800, 600),
            100,
            out var bounds);

        Assert.True(success);
        Assert.Equal(new PixelRect(40, 150, 760, 450), bounds);
    }

    [Fact]
    public void ScalesSurfaceForOneHundredFiftyPercentMonitor()
    {
        var success = WindowSwitcherPlacement.TryCalculate(
            new PixelRect(0, 0, 2560, 1400),
            150,
            out var bounds);

        Assert.True(success);
        Assert.Equal(new PixelRect(440, 467, 2120, 933), bounds);
    }

    [Fact]
    public void FitsScaledMinimumSurfaceInsideTwoHundredPercentWorkArea()
    {
        var success = WindowSwitcherPlacement.TryCalculate(
            new PixelRect(0, 0, 1920, 1040),
            200,
            out var bounds);

        Assert.True(success);
        Assert.Equal(new PixelRect(160, 220, 1760, 820), bounds);
    }

    [Theory]
    [InlineData(0, 0, 719, 900)]
    [InlineData(0, 0, 1200, 299)]
    [InlineData(100, 100, 100, 100)]
    [InlineData(100, 100, 50, 50)]
    public void RejectsInvalidOrUnsupportedWorkAreas(
        int left,
        int top,
        int right,
        int bottom)
    {
        var success = WindowSwitcherPlacement.TryCalculate(
            new PixelRect(left, top, right, bottom),
            100,
            out var bounds);

        Assert.False(success);
        Assert.Equal(default, bounds);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(99)]
    [InlineData(501)]
    public void RejectsUnsupportedScalePercent(int scalePercent)
    {
        var success = WindowSwitcherPlacement.TryCalculate(
            new PixelRect(0, 0, 3840, 2160),
            scalePercent,
            out var bounds);

        Assert.False(success);
        Assert.Equal(default, bounds);
    }

    [Fact]
    public void NewPresentationSupersedesEarlierEpoch()
    {
        var epoch = new WindowSwitcherPresentationEpoch();

        var first = epoch.Begin();
        var second = epoch.Begin();

        Assert.False(epoch.IsCurrent(first));
        Assert.True(epoch.IsCurrent(second));
    }

    [Fact]
    public void DismissalInvalidatesActiveEpoch()
    {
        var epoch = new WindowSwitcherPresentationEpoch();
        var active = epoch.Begin();

        epoch.Invalidate();

        Assert.False(epoch.IsCurrent(active));
    }
}
