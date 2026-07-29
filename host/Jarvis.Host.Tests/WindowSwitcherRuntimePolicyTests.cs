using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class WindowSwitcherRuntimePolicyTests
{
    [Fact]
    public void FullModePrewarmsTheRuntime()
    {
        var decision = WindowSwitcherRuntimePolicy.Evaluate(
            TaskbarMode.Full,
            safeMode: false,
            diagnosticRequested: false);

        Assert.True(decision.ShouldExist);
        Assert.Equal("full taskbar mode requested", decision.Reason);
    }

    [Theory]
    [InlineData("Native")]
    [InlineData("Hybrid")]
    public void ModesUsingTheWindowsSwitcherDoNotCreateTheRuntime(string modeName)
    {
        Assert.True(TaskbarModeService.TryParseMode(modeName, out var mode));
        var decision = WindowSwitcherRuntimePolicy.Evaluate(
            mode,
            safeMode: false,
            diagnosticRequested: false);

        Assert.False(decision.ShouldExist);
        Assert.Contains("uses the Windows switcher", decision.Reason);
    }

    [Fact]
    public void SafetyModeSuppressesAFullModeRuntime()
    {
        var decision = WindowSwitcherRuntimePolicy.Evaluate(
            TaskbarMode.Full,
            safeMode: true,
            diagnosticRequested: false);

        Assert.False(decision.ShouldExist);
        Assert.Equal("native-taskbar safety mode", decision.Reason);
    }

    [Theory]
    [InlineData("Native")]
    [InlineData("Hybrid")]
    [InlineData("Full")]
    public void ExplicitDiagnosticsCanExerciseEveryMode(string modeName)
    {
        Assert.True(TaskbarModeService.TryParseMode(modeName, out var mode));
        var decision = WindowSwitcherRuntimePolicy.Evaluate(
            mode,
            safeMode: true,
            diagnosticRequested: true);

        Assert.True(decision.ShouldExist);
        Assert.Equal("diagnostic override", decision.Reason);
    }

    [Fact]
    public void FullToNativeTransitionChangesFromCreateToRelease()
    {
        var before = WindowSwitcherRuntimePolicy.Evaluate(
            TaskbarMode.Full,
            safeMode: false,
            diagnosticRequested: false);
        var after = WindowSwitcherRuntimePolicy.Evaluate(
            TaskbarMode.Native,
            safeMode: false,
            diagnosticRequested: false);

        Assert.True(before.ShouldExist);
        Assert.False(after.ShouldExist);
    }

    [Fact]
    public void NativeToFullTransitionChangesFromReleaseToCreate()
    {
        var before = WindowSwitcherRuntimePolicy.Evaluate(
            TaskbarMode.Native,
            safeMode: false,
            diagnosticRequested: false);
        var after = WindowSwitcherRuntimePolicy.Evaluate(
            TaskbarMode.Full,
            safeMode: false,
            diagnosticRequested: false);

        Assert.False(before.ShouldExist);
        Assert.True(after.ShouldExist);
    }
}
