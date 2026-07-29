namespace Jarvis.Host.Services;

internal static class WindowSwitcherRuntimePolicy
{
    public static WindowSwitcherRuntimeDecision Evaluate(
        TaskbarMode requestedMode,
        bool safeMode,
        bool diagnosticRequested)
    {
        if (diagnosticRequested)
        {
            return new WindowSwitcherRuntimeDecision(
                ShouldExist: true,
                Reason: "diagnostic override");
        }

        if (safeMode)
        {
            return new WindowSwitcherRuntimeDecision(
                ShouldExist: false,
                Reason: "native-taskbar safety mode");
        }

        return requestedMode == TaskbarMode.Full
            ? new WindowSwitcherRuntimeDecision(
                ShouldExist: true,
                Reason: "full taskbar mode requested")
            : new WindowSwitcherRuntimeDecision(
                ShouldExist: false,
                Reason: $"{TaskbarModeService.ToWireValue(requestedMode)} mode uses the Windows switcher");
    }
}

internal readonly record struct WindowSwitcherRuntimeDecision(
    bool ShouldExist,
    string Reason);
