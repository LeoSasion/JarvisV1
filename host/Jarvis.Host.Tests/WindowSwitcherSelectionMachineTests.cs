using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class WindowSwitcherSelectionMachineTests
{
    [Fact]
    public void ForwardSelectionStartsAfterForegroundAndWraps()
    {
        var machine = new WindowSwitcherSelectionMachine();
        var snapshot = CreateSnapshot("0x2", "0x1", "0x2", "0x3");

        var first = machine.Begin(snapshot, reverse: false);
        var wrapped = machine.Advance(reverse: false);

        Assert.NotNull(first);
        Assert.Equal(2, first.SelectedIndex);
        Assert.Equal("0x3", first.Windows[first.SelectedIndex].WindowId);
        Assert.NotNull(wrapped);
        Assert.Equal(0, wrapped.SelectedIndex);
        Assert.Equal("0x1", machine.Commit());
        Assert.False(machine.Active);
    }

    [Fact]
    public void ReverseSelectionStartsBeforeForegroundAndWraps()
    {
        var machine = new WindowSwitcherSelectionMachine();
        var snapshot = CreateSnapshot("0x1", "0x1", "0x2", "0x3");

        var first = machine.Begin(snapshot, reverse: true);

        Assert.NotNull(first);
        Assert.Equal(2, first.SelectedIndex);
        Assert.True(first.Reverse);
        Assert.Equal("0x3", machine.Commit());
    }

    [Fact]
    public void MissingForegroundUsesFirstOrLastEntry()
    {
        var snapshot = CreateSnapshot("0x99", "0x1", "0x2", "0x3");

        var forward = new WindowSwitcherSelectionMachine().Begin(snapshot, reverse: false);
        var reverse = new WindowSwitcherSelectionMachine().Begin(snapshot, reverse: true);

        Assert.Equal(0, forward?.SelectedIndex);
        Assert.Equal(2, reverse?.SelectedIndex);
    }

    [Fact]
    public void EmptySnapshotFallsThroughAndCancelClearsSelection()
    {
        var machine = new WindowSwitcherSelectionMachine();

        Assert.Null(machine.Begin(
            new WindowTaskbarSnapshot(Array.Empty<TaskbarWindowSnapshot>(), null),
            reverse: false));
        Assert.False(machine.Active);

        _ = machine.Begin(CreateSnapshot("0x1", "0x1", "0x2"), reverse: false);
        machine.Cancel();
        Assert.False(machine.Active);
        Assert.Null(machine.Commit());
    }

    [Fact]
    public void SnapshotIsBoundedAndDuplicateWindowIdsAreRemoved()
    {
        var windows = Enumerable.Range(0, WindowSwitcherSelectionMachine.MaximumWindows + 8)
            .Select(index => CreateWindow($"0x{index:X}"))
            .Prepend(CreateWindow("0x0"))
            .ToArray();
        var machine = new WindowSwitcherSelectionMachine();

        var state = machine.Begin(
            new WindowTaskbarSnapshot(windows, ForegroundWindowId: null),
            reverse: false);

        Assert.NotNull(state);
        Assert.Equal(WindowSwitcherSelectionMachine.MaximumWindows, state.Windows.Count);
        Assert.Equal(
            state.Windows.Count,
            state.Windows.Select(window => window.WindowId).Distinct(StringComparer.OrdinalIgnoreCase).Count());
    }

    private static WindowTaskbarSnapshot CreateSnapshot(
        string foregroundWindowId,
        params string[] windowIds) =>
        new(
            windowIds.Select(CreateWindow).ToArray(),
            foregroundWindowId);

    private static TaskbarWindowSnapshot CreateWindow(string windowId) =>
        new(
            windowId,
            $"Window {windowId}",
            "test-app",
            100,
            Minimized: false,
            Active: false,
            ApplicationId: null,
            IconDataUrl: null);
}
