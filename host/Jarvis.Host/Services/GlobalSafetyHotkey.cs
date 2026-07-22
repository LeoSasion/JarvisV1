using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Services;

internal sealed class GlobalSafetyHotkey : IDisposable
{
    private const int HotkeyId = 0x4A52;
    private const int WmHotkey = 0x0312;
    private const uint ModControl = 0x0002;
    private const uint ModShift = 0x0004;
    private const uint ModNoRepeat = 0x4000;
    private const uint VirtualKeyQ = 0x51;

    private static readonly object StatusGate = new();
    private static GlobalSafetyHotkeyStatus _status = new(
        false,
        "The global safety hotkey has not been registered yet.");

    private readonly Window _owner;
    private readonly Action _requestSafeExit;
    private HwndSource? _source;
    private IntPtr _windowHandle;
    private bool _disposed;

    public GlobalSafetyHotkey(Window owner, Action requestSafeExit)
    {
        _owner = owner;
        _requestSafeExit = requestSafeExit;
    }

    public static GlobalSafetyHotkeyStatus CaptureStatus()
    {
        lock (StatusGate)
        {
            return _status;
        }
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
            HostLog.Warning("Global Ctrl+Shift+Q safety hotkey was not registered because the host window is unavailable.");
            return false;
        }

        source.AddHook(WindowProcedure);
        if (!RegisterHotKey(
                windowHandle,
                HotkeyId,
                ModControl | ModShift | ModNoRepeat,
                VirtualKeyQ))
        {
            var error = Marshal.GetLastWin32Error();
            source.RemoveHook(WindowProcedure);
            SetStatus(false, $"RegisterHotKey failed with Win32 error {error}.");
            HostLog.Warning(
                $"Global Ctrl+Shift+Q safety hotkey is unavailable (Win32 error {error}); " +
                "the in-window shortcut and settings exit action remain available.");
            return false;
        }

        _windowHandle = windowHandle;
        _source = source;
        SetStatus(true, null);
        HostLog.Info("Global Ctrl+Shift+Q safety hotkey registered.");
        return true;
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (_windowHandle != IntPtr.Zero)
        {
            _ = UnregisterHotKey(_windowHandle, HotkeyId);
        }

        _source?.RemoveHook(WindowProcedure);
        _source = null;
        _windowHandle = IntPtr.Zero;
        SetStatus(false, "The global safety hotkey is not active because JARVIS is shutting down.");
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
        HostLog.Info("Global Ctrl+Shift+Q safety exit requested.");
        _requestSafeExit();
        return IntPtr.Zero;
    }

    private static void SetStatus(bool registered, string? failureReason)
    {
        lock (StatusGate)
        {
            _status = new GlobalSafetyHotkeyStatus(registered, failureReason);
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

internal sealed record GlobalSafetyHotkeyStatus(bool Registered, string? FailureReason);
