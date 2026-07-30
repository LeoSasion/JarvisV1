using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class TaskbarFullscreenPolicyTests
{
    private static readonly DisplayMonitorTarget PrimaryMonitor = new(
        DeviceName: @"\\.\DISPLAY1",
        IsPrimary: true,
        Bounds: new PixelRect(0, 0, 2560, 1440),
        WorkArea: new PixelRect(0, 0, 2560, 1392),
        ScalePercent: 150);

    [Fact]
    public void ExactPrimaryMonitorCoverageSuppressesTheTaskbar()
    {
        Assert.True(TaskbarFullscreenPolicy.ShouldSuppress(
            PrimaryMonitor.Bounds,
            PrimaryMonitor,
            windowVisible: true,
            minimized: false,
            standardMaximizedWindow: false));
    }

    [Fact]
    public void DwmFrameToleranceStillCountsAsFullscreen()
    {
        var bounds = new PixelRect(-8, -8, 2568, 1448);

        Assert.True(TaskbarFullscreenPolicy.ShouldSuppress(
            bounds,
            PrimaryMonitor,
            windowVisible: true,
            minimized: false,
            standardMaximizedWindow: false));
    }

    [Fact]
    public void MaximizedWorkAreaDoesNotCountAsFullscreen()
    {
        Assert.False(TaskbarFullscreenPolicy.ShouldSuppress(
            PrimaryMonitor.WorkArea,
            PrimaryMonitor,
            windowVisible: true,
            minimized: false,
            standardMaximizedWindow: false));
    }

    [Fact]
    public void ObservedF11WorkAreaCoverageSuppressesTheReplacementTaskbar()
    {
        var visualBounds = new PixelRect(0, 0, 2560, 1400);

        Assert.True(TaskbarFullscreenPolicy.ShouldSuppress(
            visualBounds,
            PrimaryMonitor,
            windowVisible: true,
            minimized: false,
            standardMaximizedWindow: true,
            workAreaConstrainedFullscreen: true));
    }

    [Fact]
    public void StandardMaximizedWindowDoesNotCountAsFullscreenEvenIfItCoversTheMonitor()
    {
        Assert.False(TaskbarFullscreenPolicy.ShouldSuppress(
            PrimaryMonitor.Bounds,
            PrimaryMonitor,
            windowVisible: true,
            minimized: false,
            standardMaximizedWindow: true));
    }

    [Fact]
    public void SecondaryMonitorFullscreenDoesNotSuppressThePrimaryTaskbar()
    {
        var secondary = PrimaryMonitor with
        {
            DeviceName = @"\\.\DISPLAY2",
            IsPrimary = false,
            Bounds = new PixelRect(2560, 0, 4480, 1080),
            WorkArea = new PixelRect(2560, 0, 4480, 1032)
        };

        Assert.False(TaskbarFullscreenPolicy.ShouldSuppress(
            secondary.Bounds,
            secondary,
            windowVisible: true,
            minimized: false,
            standardMaximizedWindow: false));
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, true)]
    public void InvisibleOrMinimizedWindowsNeverSuppress(
        bool windowVisible,
        bool minimized)
    {
        Assert.False(TaskbarFullscreenPolicy.ShouldSuppress(
            PrimaryMonitor.Bounds,
            PrimaryMonitor,
            windowVisible,
            minimized,
            standardMaximizedWindow: false));
    }

    [Fact]
    public void InvalidGeometryFailsClosed()
    {
        Assert.False(TaskbarFullscreenPolicy.ShouldSuppress(
            new PixelRect(0, 0, 0, 0),
            PrimaryMonitor,
            windowVisible: true,
            minimized: false,
            standardMaximizedWindow: false));
    }

    [Theory]
    [InlineData(true, TaskbarFullscreenPolicy.CaptionStyle | TaskbarFullscreenPolicy.ThickFrameStyle)]
    [InlineData(false, TaskbarFullscreenPolicy.MaximizedStyle | TaskbarFullscreenPolicy.CaptionStyle | TaskbarFullscreenPolicy.ThickFrameStyle)]
    public void StandardFramedMaximizedWindowsAreExcluded(
        bool isZoomed,
        long style)
    {
        Assert.True(TaskbarFullscreenPolicy.IsStandardMaximizedWindow(
            isZoomed,
            style));
    }

    [Theory]
    [InlineData(true, 0)]
    [InlineData(true, TaskbarFullscreenPolicy.ThickFrameStyle)]
    [InlineData(false, TaskbarFullscreenPolicy.MaximizedStyle)]
    public void BorderlessF11WindowsAreNotExcludedWhenMaximizedStateIsRetained(
        bool isZoomed,
        long style)
    {
        Assert.False(TaskbarFullscreenPolicy.IsStandardMaximizedWindow(
            isZoomed,
            style));
    }
}
