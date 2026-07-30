using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class ShowDesktopSessionPolicyTests
{
    private static readonly ShowDesktopRestoreTarget Target = new(
        Window: new IntPtr(0x1234),
        ProcessId: 42,
        ProcessStartTimeUtcTicks: 1000,
        WasForeground: true);

    [Fact]
    public void NativeWindowMutationRequiresConfirmedCurrentDesktopScope()
    {
        Assert.True(
            ShowDesktopSessionPolicy.IsWithinControlScope(
                VirtualDesktopMembership.Current));
        Assert.False(
            ShowDesktopSessionPolicy.IsWithinControlScope(
                VirtualDesktopMembership.Other));
        Assert.False(
            ShowDesktopSessionPolicy.IsWithinControlScope(
                VirtualDesktopMembership.Unavailable));
    }

    [Fact]
    public void MatchingMinimizedTargetCanBeRestored()
    {
        var state = ShowDesktopSessionPolicy.ClassifyTarget(
            Target,
            windowExists: true,
            currentProcessId: 42,
            currentProcessStartTimeUtcTicks: 1000,
            minimized: true,
            withinCurrentDesktopScope: true);

        Assert.Equal(ShowDesktopTargetState.Minimized, state);
    }

    [Theory]
    [InlineData(false, 42, 1000, true)]
    [InlineData(true, 99, 1000, true)]
    [InlineData(true, 42, 2000, true)]
    [InlineData(true, 42, 1000, false)]
    public void StaleOrOffDesktopTargetsAreNeverRestored(
        bool windowExists,
        uint processId,
        long processStartTimeUtcTicks,
        bool withinCurrentDesktopScope)
    {
        var state = ShowDesktopSessionPolicy.ClassifyTarget(
            Target,
            windowExists,
            processId,
            processStartTimeUtcTicks,
            minimized: true,
            withinCurrentDesktopScope);

        Assert.Equal(ShowDesktopTargetState.Invalid, state);
    }

    [Fact]
    public void ClosedTargetsDoNotPreventRemainingTargetsFromRestoring()
    {
        var decision = ShowDesktopSessionPolicy.Decide(
            [
                ShowDesktopTargetState.Invalid,
                ShowDesktopTargetState.Minimized,
                ShowDesktopTargetState.Minimized
            ],
            hasVisibleEligibleWindow: false);

        Assert.Equal(ShowDesktopSessionAction.Restore, decision.Action);
        Assert.Equal(2, decision.RestorableTargetCount);
    }

    [Fact]
    public void ANewVisibleWindowStartsANewShowDesktopSession()
    {
        var decision = ShowDesktopSessionPolicy.Decide(
            [ShowDesktopTargetState.Minimized],
            hasVisibleEligibleWindow: true);

        Assert.Equal(ShowDesktopSessionAction.BeginNew, decision.Action);
        Assert.Equal(0, decision.RestorableTargetCount);
    }

    [Fact]
    public void EmptyOrInvalidSessionBeginsANewShowDesktopSession()
    {
        var decision = ShowDesktopSessionPolicy.Decide(
            [ShowDesktopTargetState.Invalid],
            hasVisibleEligibleWindow: false);

        Assert.Equal(ShowDesktopSessionAction.BeginNew, decision.Action);
    }
}
