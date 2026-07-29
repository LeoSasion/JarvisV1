using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class VirtualDesktopScopePolicyTests
{
    [Fact]
    public void CurrentDesktopWindowsRemainVisible()
    {
        Assert.True(VirtualDesktopScopePolicy.ShouldInclude(
            VirtualDesktopMembership.Current));
    }

    [Fact]
    public void OtherDesktopWindowsAreExcluded()
    {
        Assert.False(VirtualDesktopScopePolicy.ShouldInclude(
            VirtualDesktopMembership.Other));
    }

    [Fact]
    public void UnavailableApiFailsOpen()
    {
        Assert.True(VirtualDesktopScopePolicy.ShouldInclude(
            VirtualDesktopMembership.Unavailable));
    }
}
