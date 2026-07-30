using System.ComponentModel;
using System.Runtime.InteropServices;
using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Services;

internal sealed class GlobalWindowSwitcherHook : IDisposable
{
    private const int WhKeyboardLl = 13;
    private const uint WmKeyDown = 0x0100;
    private const uint WmKeyUp = 0x0101;
    private const uint WmSysKeyDown = 0x0104;
    private const uint WmSysKeyUp = 0x0105;
    private const uint WmQuit = 0x0012;
    private const uint VkTab = 0x09;
    private const uint VkEscape = 0x1B;
    private const uint VkShift = 0x10;
    private const uint VkControl = 0x11;
    private const uint VkMenu = 0x12;
    private const uint VkF11 = 0x7A;
    private const uint VkLeftMenu = 0xA4;
    private const uint VkRightMenu = 0xA5;
    private const uint LlkhfInjected = 0x00000010;
    private const uint LlkhfAltDown = 0x00000020;

    private readonly Func<bool, bool> _beginOrAdvance;
    private readonly Action _commit;
    private readonly Action _cancel;
    private readonly Action _fullscreenToggle;
    private readonly Action _fullscreenExit;
    private readonly ManualResetEventSlim _startupCompleted = new(false);
    private readonly LowLevelKeyboardProcedure _procedure;

    private Thread? _thread;
    private IntPtr _hook;
    private uint _threadId;
    private bool _enabled;
    private bool _sessionActive;
    private bool _suppressTabKeyUp;
    private bool _suppressEscapeKeyUp;
    private bool _f11Down;
    private bool _disposed;
    private Exception? _startupFailure;

    public GlobalWindowSwitcherHook(
        Func<bool, bool> beginOrAdvance,
        Action commit,
        Action cancel,
        Action fullscreenToggle,
        Action fullscreenExit)
    {
        _beginOrAdvance = beginOrAdvance;
        _commit = commit;
        _cancel = cancel;
        _fullscreenToggle = fullscreenToggle;
        _fullscreenExit = fullscreenExit;
        _procedure = KeyboardProcedure;
    }

    public bool Registered => _hook != IntPtr.Zero && _startupFailure is null;

    public bool Register()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_thread is not null)
        {
            return Registered;
        }

        _thread = new Thread(RunMessageLoop)
        {
            IsBackground = true,
            Name = "JARVIS Alt+Tab hook"
        };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
        if (!_startupCompleted.Wait(TimeSpan.FromSeconds(2)))
        {
            HostLog.Warning("The JARVIS window-switcher hook did not start within two seconds.");
            return false;
        }

        if (_startupFailure is not null)
        {
            HostLog.Error("The JARVIS window-switcher hook could not be registered.", _startupFailure);
            return false;
        }

        HostLog.Info("JARVIS Alt+Tab hook registered on its dedicated message-loop thread.");
        return Registered;
    }

    public void SetEnabled(bool enabled)
    {
        if (_disposed)
        {
            return;
        }

        Volatile.Write(ref _enabled, enabled);
        if (!enabled)
        {
            _f11Down = false;
            CancelActiveSession();
        }
    }

    private void RunMessageLoop()
    {
        try
        {
            _threadId = GetCurrentThreadId();
            var module = GetModuleHandle(null);
            _hook = SetWindowsHookEx(WhKeyboardLl, _procedure, module, 0);
            if (_hook == IntPtr.Zero)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }

            _startupCompleted.Set();
            while (true)
            {
                var result = GetMessage(out var message, IntPtr.Zero, 0, 0);
                if (result == 0)
                {
                    break;
                }

                if (result == -1)
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                }

                _ = TranslateMessage(ref message);
                _ = DispatchMessage(ref message);
            }
        }
        catch (Exception ex) when (ex is Win32Exception or InvalidOperationException)
        {
            _startupFailure = ex;
            _startupCompleted.Set();
        }
        finally
        {
            if (_hook != IntPtr.Zero)
            {
                _ = UnhookWindowsHookEx(_hook);
                _hook = IntPtr.Zero;
            }
        }
    }

    private IntPtr KeyboardProcedure(
        int code,
        IntPtr wordParameter,
        IntPtr longParameter)
    {
        if (code < 0)
        {
            return CallNextHookEx(_hook, code, wordParameter, longParameter);
        }

        try
        {
            var input = Marshal.PtrToStructure<LowLevelKeyboardInput>(longParameter);
            var message = unchecked((uint)wordParameter.ToInt64());
            var keyDown = message is WmKeyDown or WmSysKeyDown;
            var keyUp = message is WmKeyUp or WmSysKeyUp;
            if (!keyDown && !keyUp)
            {
                return CallNextHookEx(_hook, code, wordParameter, longParameter);
            }

            // Observe F11 before filtering injected input. Accessibility and UI
            // automation still cause the foreground app to enter fullscreen, so
            // the replacement taskbar must follow the same state transition.
            if (input.VirtualKey == VkF11)
            {
                if (keyDown && !_f11Down && Volatile.Read(ref _enabled))
                {
                    _f11Down = true;
                    _fullscreenToggle();
                }
                else if (keyUp)
                {
                    _f11Down = false;
                }
            }

            if (input.VirtualKey == VkEscape && keyDown && Volatile.Read(ref _enabled))
            {
                _fullscreenExit();
            }

            if ((input.Flags & LlkhfInjected) != 0)
            {
                return CallNextHookEx(_hook, code, wordParameter, longParameter);
            }

            if (input.VirtualKey == VkTab)
            {
                if (keyUp && _suppressTabKeyUp)
                {
                    _suppressTabKeyUp = false;
                    return new IntPtr(1);
                }

                if (!keyDown)
                {
                    return CallNextHookEx(_hook, code, wordParameter, longParameter);
                }

                var altDown = (input.Flags & LlkhfAltDown) != 0;
                var controlDown = IsKeyDown(VkControl);
                if (!altDown || controlDown || !Volatile.Read(ref _enabled))
                {
                    if (_sessionActive)
                    {
                        CancelActiveSession();
                    }
                    return CallNextHookEx(_hook, code, wordParameter, longParameter);
                }

                var reverse = IsKeyDown(VkShift);
                if (!_beginOrAdvance(reverse))
                {
                    if (_sessionActive)
                    {
                        CancelActiveSession();
                    }
                    return CallNextHookEx(_hook, code, wordParameter, longParameter);
                }

                _sessionActive = true;
                _suppressTabKeyUp = true;
                return new IntPtr(1);
            }

            if (IsAltKey(input.VirtualKey) && keyUp && _sessionActive)
            {
                _sessionActive = false;
                _suppressTabKeyUp = false;
                _commit();
                // The foreground application already observed the Alt key-down.
                // Forward key-up so its keyboard state cannot become stuck.
                return CallNextHookEx(_hook, code, wordParameter, longParameter);
            }

            if (input.VirtualKey == VkEscape)
            {
                if (keyUp && _suppressEscapeKeyUp)
                {
                    _suppressEscapeKeyUp = false;
                    return new IntPtr(1);
                }

                if (keyDown && _sessionActive)
                {
                    CancelActiveSession();
                    _suppressEscapeKeyUp = true;
                    return new IntPtr(1);
                }
            }

            if (keyDown && _sessionActive && !IsAltKey(input.VirtualKey))
            {
                CancelActiveSession();
            }
        }
        catch (Exception ex)
        {
            HostLog.Error("The JARVIS Alt+Tab hook rejected an input event.", ex);
            CancelActiveSession();
        }

        return CallNextHookEx(_hook, code, wordParameter, longParameter);
    }

    private void CancelActiveSession()
    {
        if (!_sessionActive)
        {
            return;
        }

        _sessionActive = false;
        _suppressTabKeyUp = false;
        _cancel();
    }

    private static bool IsAltKey(uint virtualKey) =>
        virtualKey is VkMenu or VkLeftMenu or VkRightMenu;

    private static bool IsKeyDown(uint virtualKey) =>
        (GetAsyncKeyState(checked((int)virtualKey)) & 0x8000) != 0;

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Volatile.Write(ref _enabled, false);
        CancelActiveSession();
        if (_threadId != 0)
        {
            _ = PostThreadMessage(_threadId, WmQuit, IntPtr.Zero, IntPtr.Zero);
        }

        if (_thread is not null && _thread.IsAlive && !_thread.Join(TimeSpan.FromSeconds(2)))
        {
            HostLog.Warning("The JARVIS Alt+Tab hook thread did not stop within two seconds.");
        }

        _startupCompleted.Dispose();
    }

    private delegate IntPtr LowLevelKeyboardProcedure(
        int code,
        IntPtr wordParameter,
        IntPtr longParameter);

    [StructLayout(LayoutKind.Sequential)]
    private struct LowLevelKeyboardInput
    {
        public uint VirtualKey;
        public uint ScanCode;
        public uint Flags;
        public uint Time;
        public nuint ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeMessage
    {
        public IntPtr Window;
        public uint Message;
        public nuint WordParameter;
        public nint LongParameter;
        public uint Time;
        public NativePoint Point;
        public uint Private;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint
    {
        public int X;
        public int Y;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(
        int hookType,
        LowLevelKeyboardProcedure callback,
        IntPtr module,
        uint threadId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hook);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(
        IntPtr hook,
        int code,
        IntPtr wordParameter,
        IntPtr longParameter);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int virtualKey);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? moduleName);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetMessage(
        out NativeMessage message,
        IntPtr window,
        uint minimumMessage,
        uint maximumMessage);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TranslateMessage(ref NativeMessage message);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref NativeMessage message);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostThreadMessage(
        uint threadId,
        uint message,
        IntPtr wordParameter,
        IntPtr longParameter);
}
