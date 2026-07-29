using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class DesktopSurfacePlacementPolicyTests
{
    private static readonly DisplayMonitorTarget Monitor = new(
        DeviceName: @"\\.\DISPLAY1",
        IsPrimary: true,
        Bounds: new PixelRect(0, 0, 2560, 1440),
        WorkArea: new PixelRect(0, 0, 2560, 1392),
        ScalePercent: 100);

    [Fact]
    public void EffectiveFullModeUsesTheWholeMonitorWhenReplacingTheTaskbar()
    {
        var actual = DesktopSurfacePlacementPolicy.Resolve(
            Monitor,
            TaskbarMode.Full,
            keepNativeTaskbar: false);

        Assert.Equal(Monitor.Bounds, actual);
    }

    [Fact]
    public void NativeAndHybridModesReserveTheWindowsTaskbarWorkArea()
    {
        var native = DesktopSurfacePlacementPolicy.Resolve(
            Monitor,
            TaskbarMode.Native,
            keepNativeTaskbar: false);
        var hybrid = DesktopSurfacePlacementPolicy.Resolve(
            Monitor,
            TaskbarMode.Hybrid,
            keepNativeTaskbar: false);

        Assert.Equal(Monitor.WorkArea, native);
        Assert.Equal(Monitor.WorkArea, hybrid);
    }

    [Fact]
    public void SafetyModeKeepsTheWindowsTaskbarWorkAreaForEffectiveFullMode()
    {
        var actual = DesktopSurfacePlacementPolicy.Resolve(
            Monitor,
            TaskbarMode.Full,
            keepNativeTaskbar: true);

        Assert.Equal(Monitor.WorkArea, actual);
    }
}
