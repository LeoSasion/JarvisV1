using Jarvis.Host.Bridge;
using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class SystemSessionActionServiceTests
{
    [Fact]
    public void StateExposesOnlyTheFixedActionSet()
    {
        using var service = new SystemSessionActionService(new RecordingExecutor());

        var state = service.GetState();

        Assert.True(state.Available);
        Assert.Equal(SystemSessionActionService.ConfirmationTimeoutSeconds, state.ConfirmationTimeoutSeconds);
        Assert.Equal(
            ["lock", "sign-out", "restart", "shut-down"],
            state.Actions.Select(action => action.Id));
    }

    [Fact]
    public void CommitRequiresTheMatchingSingleUseChallenge()
    {
        var executor = new RecordingExecutor();
        using var service = new SystemSessionActionService(executor);
        var challenge = service.Prepare("restart");

        Assert.Matches("^[a-f0-9]{64}$", challenge.Token);
        var result = service.Commit(challenge.ActionId, challenge.Token);

        Assert.True(result.Accepted);
        Assert.Equal(SystemSessionAction.Restart, Assert.Single(executor.Actions));
        var replay = Assert.Throws<BridgeFaultException>(
            () => service.Commit(challenge.ActionId, challenge.Token));
        Assert.Equal("SESSION_CONFIRMATION_EXPIRED", replay.Code);
    }

    [Fact]
    public void PreparingAnotherActionInvalidatesThePreviousChallenge()
    {
        using var service = new SystemSessionActionService(new RecordingExecutor());
        var stale = service.Prepare("lock");
        var current = service.Prepare("sign-out");

        var mismatch = Assert.Throws<BridgeFaultException>(
            () => service.Commit(stale.ActionId, stale.Token));

        Assert.Equal("SESSION_CONFIRMATION_EXPIRED", mismatch.Code);
        var consumed = Assert.Throws<BridgeFaultException>(
            () => service.Commit(current.ActionId, current.Token));
        Assert.Equal("SESSION_CONFIRMATION_EXPIRED", consumed.Code);
    }

    [Fact]
    public void ExpiredAndCancelledChallengesCannotExecute()
    {
        var now = new DateTimeOffset(2026, 7, 30, 8, 0, 0, TimeSpan.Zero);
        var executor = new RecordingExecutor();
        using var service = new SystemSessionActionService(executor, () => now);
        var expired = service.Prepare("shut-down");
        now = now.AddSeconds(SystemSessionActionService.ConfirmationTimeoutSeconds);

        var timeout = Assert.Throws<BridgeFaultException>(
            () => service.Commit(expired.ActionId, expired.Token));

        Assert.Equal("SESSION_CONFIRMATION_EXPIRED", timeout.Code);
        var cancelled = service.Prepare("lock");
        Assert.True(service.Cancel().Cancelled);
        Assert.Throws<BridgeFaultException>(
            () => service.Commit(cancelled.ActionId, cancelled.Token));
        Assert.Empty(executor.Actions);
    }

    [Theory]
    [InlineData("")]
    [InlineData("sleep")]
    [InlineData("shutdown.exe /s")]
    public void UnknownActionsAreRejected(string actionId)
    {
        using var service = new SystemSessionActionService(new RecordingExecutor());

        var error = Assert.Throws<BridgeFaultException>(
            () => service.Prepare(actionId));

        Assert.Equal("SESSION_ACTION_NOT_ALLOWED", error.Code);
    }

    private sealed class RecordingExecutor : ISystemSessionActionExecutor
    {
        public List<SystemSessionAction> Actions { get; } = [];

        public void Execute(SystemSessionAction action) => Actions.Add(action);
    }
}
