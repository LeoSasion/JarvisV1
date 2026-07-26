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
    public void InitialTaskbarModeUsesNativeFallbackForInvalidPersistedSettings()
    {
        Assert.Equal(
            TaskbarMode.Hybrid,
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
}
