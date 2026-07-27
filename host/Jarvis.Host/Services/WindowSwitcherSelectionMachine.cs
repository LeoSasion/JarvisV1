namespace Jarvis.Host.Services;

internal sealed class WindowSwitcherSelectionMachine
{
    internal const int MaximumWindows = 24;

    private IReadOnlyList<TaskbarWindowSnapshot> _windows = Array.Empty<TaskbarWindowSnapshot>();
    private int _selectedIndex = -1;

    public bool Active => _selectedIndex >= 0 && _windows.Count > 0;

    public WindowSwitcherPresentationState? Begin(
        WindowTaskbarSnapshot snapshot,
        bool reverse)
    {
        var uniqueWindowIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        _windows = snapshot.Windows
            .Where(window => uniqueWindowIds.Add(window.WindowId))
            .Take(MaximumWindows)
            .ToArray();
        if (_windows.Count == 0)
        {
            Reset();
            return null;
        }

        var foregroundIndex = FindWindowIndex(snapshot.ForegroundWindowId);
        _selectedIndex = foregroundIndex >= 0
            ? Wrap(foregroundIndex + (reverse ? -1 : 1), _windows.Count)
            : reverse
                ? _windows.Count - 1
                : 0;
        return CreateState(reverse);
    }

    public WindowSwitcherPresentationState? Advance(bool reverse)
    {
        if (!Active)
        {
            return null;
        }

        _selectedIndex = Wrap(_selectedIndex + (reverse ? -1 : 1), _windows.Count);
        return CreateState(reverse);
    }

    public string? Commit()
    {
        if (!Active)
        {
            return null;
        }

        var selectedWindowId = _windows[_selectedIndex].WindowId;
        Reset();
        return selectedWindowId;
    }

    public void Cancel() => Reset();

    private WindowSwitcherPresentationState CreateState(bool reverse) =>
        new(_windows, _selectedIndex, reverse);

    private int FindWindowIndex(string? windowId)
    {
        if (string.IsNullOrWhiteSpace(windowId))
        {
            return -1;
        }

        for (var index = 0; index < _windows.Count; index++)
        {
            if (_windows[index].WindowId.Equals(windowId, StringComparison.OrdinalIgnoreCase))
            {
                return index;
            }
        }

        return -1;
    }

    private void Reset()
    {
        _windows = Array.Empty<TaskbarWindowSnapshot>();
        _selectedIndex = -1;
    }

    private static int Wrap(int value, int count) =>
        ((value % count) + count) % count;
}

internal sealed record WindowSwitcherPresentationState(
    IReadOnlyList<TaskbarWindowSnapshot> Windows,
    int SelectedIndex,
    bool Reverse);
