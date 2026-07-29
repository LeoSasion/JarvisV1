using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class WindowTaskbarEventMonitorTests
{
    [Fact]
    public void FullscreenLocationObservationKeepsAllSixEventRanges()
    {
        Assert.Equal(6, WindowTaskbarEventMonitor.ExpectedHookCount);
    }
}
