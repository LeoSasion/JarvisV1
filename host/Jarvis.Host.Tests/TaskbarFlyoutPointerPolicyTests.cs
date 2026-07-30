using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class TaskbarFlyoutPointerPolicyTests
{
    private static readonly PixelRect Flyout = new(800, 900, 1200, 1120);
    private static readonly PixelRect Taskbar = new(0, 1128, 2560, 1200);

    [Fact]
    public void CursorInsideFlyoutKeepsPreviewOpen()
    {
        Assert.True(TaskbarFlyoutPointerPolicy.ShouldKeepOpen(
            Flyout,
            Taskbar,
            anchorScreenX: 1000,
            anchorHalfWidth: 48,
            cursorX: 900,
            cursorY: 1000));
    }

    [Theory]
    [InlineData(952)]
    [InlineData(1000)]
    [InlineData(1048)]
    public void CursorNearTaskbarAnchorKeepsPreviewOpen(int cursorX)
    {
        Assert.True(TaskbarFlyoutPointerPolicy.ShouldKeepOpen(
            Flyout,
            Taskbar,
            anchorScreenX: 1000,
            anchorHalfWidth: 48,
            cursorX,
            cursorY: 1160));
    }

    [Theory]
    [InlineData(1200, 1160)]
    [InlineData(2000, 1160)]
    [InlineData(1000, 850)]
    public void CursorOutsideFlyoutAndAnchorAllowsDismissal(int cursorX, int cursorY)
    {
        Assert.False(TaskbarFlyoutPointerPolicy.ShouldKeepOpen(
            Flyout,
            Taskbar,
            anchorScreenX: 1000,
            anchorHalfWidth: 48,
            cursorX,
            cursorY));
    }

    [Fact]
    public void NegativeMonitorCoordinatesRemainBounded()
    {
        var taskbar = new PixelRect(-1920, 1008, 0, 1080);
        var flyout = new PixelRect(-1500, 780, -1100, 1000);

        Assert.True(TaskbarFlyoutPointerPolicy.ShouldKeepOpen(
            flyout,
            taskbar,
            anchorScreenX: -1300,
            anchorHalfWidth: 72,
            cursorX: -1368,
            cursorY: 1040));
        Assert.False(TaskbarFlyoutPointerPolicy.ShouldKeepOpen(
            flyout,
            taskbar,
            anchorScreenX: -1300,
            anchorHalfWidth: 72,
            cursorX: -1700,
            cursorY: 1040));
    }
}
