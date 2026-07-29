using System.Runtime.InteropServices;

namespace Jarvis.Host.Services;

internal sealed class WindowTaskbarEventMonitor : IDisposable
{
    private const uint EventSystemForeground = 0x0003;
    private const uint EventSystemMinimizeStart = 0x0016;
    private const uint EventSystemMinimizeEnd = 0x0017;
    private const uint EventObjectCreate = 0x8000;
    private const uint EventObjectHide = 0x8003;
    private const uint EventObjectLocationChange = 0x800B;
    private const uint EventObjectNameChange = 0x800C;
    private const uint EventObjectCloaked = 0x8017;
    private const uint EventObjectUncloaked = 0x8018;
    private const int ObjectIdWindow = 0;
    private const uint WinEventOutOfContext = 0;

    private static readonly (uint Minimum, uint Maximum)[] EventRanges =
    [
        (EventSystemForeground, EventSystemForeground),
        (EventSystemMinimizeStart, EventSystemMinimizeEnd),
        (EventObjectCreate, EventObjectHide),
        (EventObjectLocationChange, EventObjectLocationChange),
        (EventObjectNameChange, EventObjectNameChange),
        (EventObjectCloaked, EventObjectUncloaked)
    ];

    private readonly WinEventCallback _callback;
    private readonly List<IntPtr> _hooks = [];
    private bool _disposed;

    public WindowTaskbarEventMonitor()
    {
        _callback = OnWinEvent;
    }

    public event Action? Changed;

    public static int ExpectedHookCount => EventRanges.Length;

    public int Start()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_hooks.Count > 0)
        {
            return _hooks.Count;
        }

        foreach (var (minimum, maximum) in EventRanges)
        {
            var hook = SetWinEventHook(
                minimum,
                maximum,
                IntPtr.Zero,
                _callback,
                0,
                0,
                WinEventOutOfContext);
            if (hook != IntPtr.Zero)
            {
                _hooks.Add(hook);
            }
        }

        return _hooks.Count;
    }

    private void OnWinEvent(
        IntPtr hook,
        uint eventType,
        IntPtr window,
        int objectId,
        int childId,
        uint eventThread,
        uint eventTime)
    {
        _ = hook;
        _ = eventThread;
        _ = eventTime;
        if (_disposed || window == IntPtr.Zero || childId != 0)
        {
            return;
        }

        if (eventType >= EventObjectCreate && objectId != ObjectIdWindow)
        {
            return;
        }

        Changed?.Invoke();
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Changed = null;
        foreach (var hook in _hooks)
        {
            _ = UnhookWinEvent(hook);
        }

        _hooks.Clear();
    }

    private delegate void WinEventCallback(
        IntPtr hook,
        uint eventType,
        IntPtr window,
        int objectId,
        int childId,
        uint eventThread,
        uint eventTime);

    [DllImport("user32.dll")]
    private static extern IntPtr SetWinEventHook(
        uint eventMinimum,
        uint eventMaximum,
        IntPtr module,
        WinEventCallback callback,
        uint processId,
        uint threadId,
        uint flags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWinEvent(IntPtr hook);
}
