namespace Jarvis.Host.Services;

internal enum TaskbarLifecycleState
{
    NativeVisible,
    Preparing,
    ReplacementActive,
    Rebinding,
    Recovering,
    NativeFallback
}

internal sealed class TaskbarLifecycleMachine
{
    private readonly object _gate = new();
    private TaskbarLifecycleState _state = TaskbarLifecycleState.NativeVisible;

    public TaskbarLifecycleState State
    {
        get
        {
            lock (_gate)
            {
                return _state;
            }
        }
    }

    public TaskbarLifecycleTransition Transition(
        TaskbarLifecycleState requestedState,
        string reason)
    {
        lock (_gate)
        {
            var previous = _state;
            if (previous == requestedState)
            {
                return new(previous, previous, reason, Changed: false, ForcedFallback: false);
            }

            if (IsAllowed(previous, requestedState))
            {
                _state = requestedState;
                return new(previous, requestedState, reason, Changed: true, ForcedFallback: false);
            }

            _state = TaskbarLifecycleState.NativeFallback;
            return new(
                previous,
                TaskbarLifecycleState.NativeFallback,
                $"Rejected unsafe transition to {requestedState}: {reason}",
                Changed: previous != TaskbarLifecycleState.NativeFallback,
                ForcedFallback: true);
        }
    }

    private static bool IsAllowed(
        TaskbarLifecycleState current,
        TaskbarLifecycleState next) =>
        next switch
        {
            TaskbarLifecycleState.Rebinding =>
                current is TaskbarLifecycleState.NativeVisible or
                    TaskbarLifecycleState.ReplacementActive or
                    TaskbarLifecycleState.NativeFallback or
                    TaskbarLifecycleState.Preparing,
            TaskbarLifecycleState.Preparing =>
                current == TaskbarLifecycleState.Rebinding,
            TaskbarLifecycleState.ReplacementActive =>
                current == TaskbarLifecycleState.Preparing,
            TaskbarLifecycleState.Recovering =>
                current is not TaskbarLifecycleState.Recovering,
            TaskbarLifecycleState.NativeVisible =>
                current is TaskbarLifecycleState.Recovering or
                    TaskbarLifecycleState.Rebinding or
                    TaskbarLifecycleState.NativeFallback,
            TaskbarLifecycleState.NativeFallback =>
                current is not TaskbarLifecycleState.NativeFallback,
            _ => false
        };
}

internal sealed record TaskbarLifecycleTransition(
    TaskbarLifecycleState PreviousState,
    TaskbarLifecycleState State,
    string Reason,
    bool Changed,
    bool ForcedFallback);

internal sealed record TaskbarLifecycleSnapshot(
    string State,
    long Generation,
    bool SurfaceVisible,
    bool NativeTaskbarVisible);
