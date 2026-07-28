using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Services;

internal sealed class GlobalQuickSearchHotkey : IDisposable
{
    private const int HotkeyId = 0x4A53;
    private const int WmHotkey = 0x0312;
    private const uint ModAlt = 0x0001;
    private const uint ModControl = 0x0002;
    private const uint ModNoRepeat = 0x4000;
    private const uint VirtualKeyJ = 0x4A;

    private static readonly object StatusGate = new();
    private static GlobalQuickSearchHotkeyStatus _status = new(
        false,
        "The global Quick Search shortcut has not been registered yet.");

    private readonly Window _owner;
    private readonly Action _toggleQuickSearch;
    private HwndSource? _source;
    private IntPtr _windowHandle;
    private bool _disposed;

    public GlobalQuickSearchHotkey(Window owner, Action toggleQuickSearch)
    {
        _owner = owner;
        _toggleQuickSearch = toggleQuickSearch;
    }

    public static GlobalQuickSearchHotkeyStatus CaptureStatus()
    {
        lock (StatusGate)
        {
            return _status;
        }
    }

    public static void ReportUnavailable(string reason)
    {
        SetStatus(
            false,
            string.IsNullOrWhiteSpace(reason)
                ? "The global Quick Search renderer is unavailable."
                : reason.Trim());
    }

    public bool Register()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_windowHandle != IntPtr.Zero)
        {
            return true;
        }

        var windowHandle = new WindowInteropHelper(_owner).Handle;
        var source = HwndSource.FromHwnd(windowHandle);
        if (windowHandle == IntPtr.Zero || source is null)
        {
            SetStatus(false, "The JARVIS window handle is unavailable.");
            HostLog.Warning(
                "Global Ctrl+Alt+J Quick Search was not registered because the host window is unavailable.");
            return false;
        }

        source.AddHook(WindowProcedure);
        if (!RegisterHotKey(
                windowHandle,
                HotkeyId,
                ModControl | ModAlt | ModNoRepeat,
                VirtualKeyJ))
        {
            var error = Marshal.GetLastWin32Error();
            source.RemoveHook(WindowProcedure);
            SetStatus(false, $"RegisterHotKey failed with Win32 error {error}.");
            HostLog.Warning(
                $"Global Ctrl+Alt+J Quick Search is unavailable (Win32 error {error}); " +
                "the desktop Ctrl+Space and taskbar Search entry points remain available.");
            return false;
        }

        _windowHandle = windowHandle;
        _source = source;
        SetStatus(true, null);
        HostLog.Info("Global Ctrl+Alt+J Quick Search registered.");
        return true;
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        var wasRegistered = _windowHandle != IntPtr.Zero;
        if (wasRegistered)
        {
            _ = UnregisterHotKey(_windowHandle, HotkeyId);
        }

        _source?.RemoveHook(WindowProcedure);
        _source = null;
        _windowHandle = IntPtr.Zero;
        if (wasRegistered)
        {
            SetStatus(
                false,
                "The global Quick Search shortcut is not active.");
        }
    }

    private IntPtr WindowProcedure(
        IntPtr window,
        int message,
        IntPtr wordParameter,
        IntPtr longParameter,
        ref bool handled)
    {
        if (message != WmHotkey || wordParameter.ToInt32() != HotkeyId)
        {
            return IntPtr.Zero;
        }

        handled = true;
        HostLog.Info("Global Ctrl+Alt+J Quick Search requested.");
        _toggleQuickSearch();
        return IntPtr.Zero;
    }

    private static void SetStatus(bool registered, string? failureReason)
    {
        lock (StatusGate)
        {
            _status = new GlobalQuickSearchHotkeyStatus(registered, failureReason);
        }
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool RegisterHotKey(
        IntPtr window,
        int identifier,
        uint modifiers,
        uint virtualKey);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnregisterHotKey(IntPtr window, int identifier);
}

internal sealed record GlobalQuickSearchHotkeyStatus(bool Registered, string? FailureReason);
