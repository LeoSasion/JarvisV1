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
            windowMaximized: false));
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
            windowMaximized: false));
    }

    [Fact]
    public void MaximizedWorkAreaDoesNotCountAsFullscreen()
    {
        Assert.False(TaskbarFullscreenPolicy.ShouldSuppress(
            PrimaryMonitor.WorkArea,
            PrimaryMonitor,
            windowVisible: true,
            minimized: false,
            windowMaximized: false));
    }

    [Fact]
    public void StandardMaximizedWindowDoesNotCountAsFullscreenEvenIfItCoversTheMonitor()
    {
        Assert.False(TaskbarFullscreenPolicy.ShouldSuppress(
            PrimaryMonitor.Bounds,
            PrimaryMonitor,
            windowVisible: true,
            minimized: false,
            windowMaximized: true));
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
            windowMaximized: false));
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
            windowMaximized: false));
    }

    [Fact]
    public void InvalidGeometryFailsClosed()
    {
        Assert.False(TaskbarFullscreenPolicy.ShouldSuppress(
            new PixelRect(0, 0, 0, 0),
            PrimaryMonitor,
            windowVisible: true,
            minimized: false,
            windowMaximized: false));
    }
}
