using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class QuickSearchPlacementTests
{
    [Fact]
    public void CentersMaximumSurfaceInsidePrimaryWorkArea()
    {
        var success = QuickSearchPlacement.TryCalculate(
            new PixelRect(0, 0, 1920, 1040),
            100,
            out var bounds);

        Assert.True(success);
        Assert.Equal(new PixelRect(480, 170, 1440, 870), bounds);
    }

    [Fact]
    public void PreservesNegativeCoordinatesOnLeftHandMonitor()
    {
        var success = QuickSearchPlacement.TryCalculate(
            new PixelRect(-1920, 24, 0, 1080),
            100,
            out var bounds);

        Assert.True(success);
        Assert.Equal(new PixelRect(-1440, 202, -480, 902), bounds);
    }

    [Fact]
    public void ShrinksWithoutLeavingCompactWorkArea()
    {
        var workArea = new PixelRect(1600, -900, 2400, -300);

        var success = QuickSearchPlacement.TryCalculate(
            workArea,
            100,
            out var bounds);

        Assert.True(success);
        Assert.Equal(new PixelRect(1660, -810, 2340, -390), bounds);
    }

    [Fact]
    public void ScalesLogicalSurfaceForOneHundredFiftyPercentMonitor()
    {
        var success = QuickSearchPlacement.TryCalculate(
            new PixelRect(0, 0, 2560, 1400),
            150,
            out var bounds);

        Assert.True(success);
        Assert.Equal(new PixelRect(560, 175, 2000, 1225), bounds);
    }

    [Fact]
    public void FitsScaledMinimumSurfaceInsideTwoHundredPercentWorkArea()
    {
        var success = QuickSearchPlacement.TryCalculate(
            new PixelRect(0, 0, 1920, 1040),
            200,
            out var bounds);

        Assert.True(success);
        Assert.Equal(new PixelRect(120, 100, 1800, 940), bounds);
    }

    [Theory]
    [InlineData(0, 0, 639, 900)]
    [InlineData(0, 0, 1200, 419)]
    [InlineData(100, 100, 100, 100)]
    [InlineData(100, 100, 50, 50)]
    public void RejectsInvalidOrUnsupportedWorkAreas(
        int left,
        int top,
        int right,
        int bottom)
    {
        var success = QuickSearchPlacement.TryCalculate(
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
        var success = QuickSearchPlacement.TryCalculate(
            new PixelRect(0, 0, 3840, 2160),
            scalePercent,
            out var bounds);

        Assert.False(success);
        Assert.Equal(default, bounds);
    }
}
