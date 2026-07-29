using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class TaskbarLifecycleTests
{
    [Fact]
    public void ExpectedReplacementLifecycleIsAccepted()
    {
        var machine = new TaskbarLifecycleMachine();

        Assert.Equal(
            TaskbarLifecycleState.Rebinding,
            machine.Transition(TaskbarLifecycleState.Rebinding, "test").State);
        Assert.Equal(
            TaskbarLifecycleState.Preparing,
            machine.Transition(TaskbarLifecycleState.Preparing, "test").State);
        Assert.Equal(
            TaskbarLifecycleState.ReplacementActive,
            machine.Transition(TaskbarLifecycleState.ReplacementActive, "test").State);
    }

    [Fact]
    public void UnsafeTransitionForcesNativeFallback()
    {
        var machine = new TaskbarLifecycleMachine();

        var transition = machine.Transition(
            TaskbarLifecycleState.ReplacementActive,
            "renderer skipped preparation");

        Assert.True(transition.ForcedFallback);
        Assert.Equal(TaskbarLifecycleState.NativeFallback, transition.State);
    }

    [Theory]
    [InlineData("native", "Native")]
    [InlineData("HYBRID", "Hybrid")]
    [InlineData(" full ", "Full")]
    public void TaskbarModeParserAcceptsOnlyNamedModes(
        string value,
        string expected)
    {
        Assert.True(TaskbarModeService.TryParseMode(value, out var actual));
        Assert.Equal(expected, actual.ToString());
    }

    [Theory]
    [InlineData("1")]
    [InlineData("immersive")]
    [InlineData("")]
    public void TaskbarModeParserRejectsUnknownOrNumericModes(string value)
    {
        Assert.False(TaskbarModeService.TryParseMode(value, out var actual));
        Assert.Equal(TaskbarMode.Native, actual);
    }

    [Fact]
    public void InitialTaskbarModeDefaultsToFullAndFailsClosedForInvalidSettings()
    {
        Assert.Equal(
            TaskbarMode.Full,
            TaskbarModeService.ResolveInitialMode(null, settingsFileExists: false));
        Assert.Equal(
            TaskbarMode.Native,
            TaskbarModeService.ResolveInitialMode(null, settingsFileExists: true));
        Assert.Equal(
            TaskbarMode.Full,
            TaskbarModeService.ResolveInitialMode(
                TaskbarMode.Full,
                settingsFileExists: true));
    }

    [Theory]
    [InlineData("Full", "Full", null, false, "Settled")]
    [InlineData("Full", "Native", "renderer failed", false, "Fallback")]
    [InlineData("Hybrid", "Native", null, false, "Fallback")]
    [InlineData("Native", "Native", null, true, "Settled")]
    [InlineData("Full", "Native", "watchdog failed", true, "Cooldown")]
    public void TaskbarTransitionStatusReflectsVerifiedOutcome(
        string requestedModeName,
        string effectiveModeName,
        string? fallbackReason,
        bool cooldown,
        string expectedStatusName)
    {
        Assert.True(TaskbarModeService.TryParseMode(requestedModeName, out var requestedMode));
        Assert.True(TaskbarModeService.TryParseMode(effectiveModeName, out var effectiveMode));
        Assert.True(Enum.TryParse(expectedStatusName, out TaskbarTransitionStatus expected));
        var recovery = new TaskbarRecoveryCircuitSnapshot(
            cooldown ? TaskbarRecoveryCircuit.FailureThreshold : 0,
            cooldown ? DateTimeOffset.UtcNow.AddMinutes(1) : null);

        var actual = TaskbarModeService.ResolveTransitionStatus(
            requestedMode,
            effectiveMode,
            fallbackReason,
            recovery);

        Assert.Equal(expected, actual);
    }

    [Fact]
    public void StaleTaskbarOutcomeCannotOverwriteOwnedTransition()
    {
        var service = new TaskbarModeService();
        var recovery = new TaskbarRecoveryCircuitSnapshot(0, null);
        _ = service.BeginTransition(2, "new transition", recovery);

        var state = service.ReportEffectiveMode(
            generation: 1,
            effectiveMode: TaskbarMode.Native,
            hybridAvailable: false,
            fallbackReason: "stale failure",
            transitionReason: "stale completion",
            recovery: recovery);

        Assert.Equal("applying", state.TransitionStatus);
        Assert.Equal(2, state.TransitionGeneration);
        Assert.Equal("new transition", state.TransitionReason);
    }

    [Fact]
    public void DuplicateBeginCannotRegressTerminalGenerationToApplying()
    {
        var service = new TaskbarModeService();
        var recovery = new TaskbarRecoveryCircuitSnapshot(0, null);
        _ = service.BeginTransition(1, "owned transition", recovery);
        var terminal = service.ReportEffectiveMode(
            generation: 1,
            effectiveMode: service.RequestedMode,
            hybridAvailable: false,
            fallbackReason: null,
            transitionReason: "owned terminal outcome",
            recovery: recovery);

        var duplicate = service.BeginTransition(1, "late begin", recovery);

        Assert.Equal(terminal.TransitionStatus, duplicate.TransitionStatus);
        Assert.NotEqual("applying", duplicate.TransitionStatus);
        Assert.Equal("owned terminal outcome", duplicate.TransitionReason);
    }
}
