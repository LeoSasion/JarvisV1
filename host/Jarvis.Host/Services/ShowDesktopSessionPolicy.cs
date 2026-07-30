namespace Jarvis.Host.Services;

internal enum ShowDesktopTargetState
{
    Invalid,
    Minimized,
    Visible
}

internal enum ShowDesktopSessionAction
{
    BeginNew,
    Restore
}

internal sealed record ShowDesktopRestoreTarget(
    IntPtr Window,
    uint ProcessId,
    long ProcessStartTimeUtcTicks,
    bool WasForeground);

internal sealed record ShowDesktopSessionDecision(
    ShowDesktopSessionAction Action,
    int RestorableTargetCount);

internal static class ShowDesktopSessionPolicy
{
    public static bool IsWithinControlScope(
        VirtualDesktopMembership membership) =>
        membership == VirtualDesktopMembership.Current;

    public static ShowDesktopTargetState ClassifyTarget(
        ShowDesktopRestoreTarget target,
        bool windowExists,
        uint currentProcessId,
        long currentProcessStartTimeUtcTicks,
        bool minimized,
        bool withinCurrentDesktopScope)
    {
        if (!windowExists ||
            target.Window == IntPtr.Zero ||
            currentProcessId != target.ProcessId ||
            currentProcessStartTimeUtcTicks != target.ProcessStartTimeUtcTicks ||
            !withinCurrentDesktopScope)
        {
            return ShowDesktopTargetState.Invalid;
        }

        return minimized
            ? ShowDesktopTargetState.Minimized
            : ShowDesktopTargetState.Visible;
    }

    public static ShowDesktopSessionDecision Decide(
        IReadOnlyList<ShowDesktopTargetState> targetStates,
        bool hasVisibleEligibleWindow)
    {
        if (hasVisibleEligibleWindow)
        {
            return new ShowDesktopSessionDecision(
                ShowDesktopSessionAction.BeginNew,
                RestorableTargetCount: 0);
        }

        var restorableTargetCount = targetStates.Count(
            state => state == ShowDesktopTargetState.Minimized);
        return restorableTargetCount > 0
            ? new ShowDesktopSessionDecision(
                ShowDesktopSessionAction.Restore,
                restorableTargetCount)
            : new ShowDesktopSessionDecision(
                ShowDesktopSessionAction.BeginNew,
                RestorableTargetCount: 0);
    }
}
