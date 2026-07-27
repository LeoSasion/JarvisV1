using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class WindowsIntegrationReadinessTests
{
    [Fact]
    public void NotificationHistoryProbeNeverClaimsHistoryWithoutAnAdapter()
    {
        var state = new WindowsNotificationHistoryService().GetState();

        Assert.False(state.HistoryAvailable);
        Assert.Empty(state.Items);
        Assert.True(state.MinimumBuild >= 14393);
        Assert.NotEmpty(state.AccessStatus);
        Assert.NotEmpty(state.Reason);
    }

    [Fact]
    public void NotificationAccessRequestRemainsFeasibilityGated()
    {
        var state = new WindowsNotificationHistoryService().RequestAccess();

        Assert.False(state.HistoryAvailable);
        Assert.Contains(
            state.AccessStatus,
            new[]
            {
                "unsupported",
                "requires-package-identity",
                "adapter-not-enabled"
            });
    }
}
