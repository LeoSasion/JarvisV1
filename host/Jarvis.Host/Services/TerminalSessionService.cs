using System.Collections.Concurrent;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Jarvis.Host.Services;

internal sealed class TerminalSessionService : IDisposable
{
    private readonly ConcurrentDictionary<string, ConPtySession> _sessions =
        new(StringComparer.Ordinal);
    private bool _disposed;

    public event Action<TerminalOutputChunk>? OutputReceived;

    public event Action<TerminalSessionExit>? SessionExited;

    public TerminalProfilesResult ListProfiles()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var profiles = TerminalProfileCatalog.GetProfiles();
        return new TerminalProfilesResult(
            profiles.Select(profile => new TerminalProfileInfo(
                profile.Id,
                profile.Label,
                profile.Available,
                profile.IsDefault)).ToArray(),
            profiles.First(profile => profile.IsDefault).Id,
            NativeMethods.IsConPtyAvailable);
    }

    public TerminalSessionInfo Create(string? profileId, int columns, int rows)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (!NativeMethods.IsConPtyAvailable)
        {
            throw new PlatformNotSupportedException(
                "The Windows pseudoconsole API is unavailable. JARVIS Terminal requires Windows 10 version 1809 or later.");
        }

        var profile = TerminalProfileCatalog.Resolve(profileId);
        if (!profile.Available || string.IsNullOrWhiteSpace(profile.ExecutablePath))
        {
            throw new InvalidOperationException($"The terminal profile '{profile.Id}' is not installed.");
        }

        var sessionId = Guid.NewGuid().ToString("N");
        var session = ConPtySession.Start(
            sessionId,
            profile,
            NormalizeColumns(columns),
            NormalizeRows(rows));
        session.OutputReceived += HandleOutputReceived;
        session.Exited += HandleSessionExited;
        if (!_sessions.TryAdd(sessionId, session))
        {
            session.Dispose();
            throw new InvalidOperationException("Unable to register the terminal session.");
        }

        return session.GetInfo();
    }

    public async Task<TerminalWriteResult> WriteAsync(
        string sessionId,
        string data,
        CancellationToken cancellationToken)
    {
        var session = GetSession(sessionId);
        await session.WriteAsync(data, cancellationToken);
        return new TerminalWriteResult(sessionId, Encoding.UTF8.GetByteCount(data));
    }

    public TerminalResizeResult Resize(string sessionId, int columns, int rows)
    {
        var session = GetSession(sessionId);
        var normalizedColumns = NormalizeColumns(columns);
        var normalizedRows = NormalizeRows(rows);
        session.Resize(normalizedColumns, normalizedRows);
        return new TerminalResizeResult(sessionId, normalizedColumns, normalizedRows);
    }

    public TerminalCloseResult Close(string sessionId)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (!_sessions.TryRemove(sessionId, out var session))
        {
            return new TerminalCloseResult(sessionId, false);
        }

        Detach(session);
        session.Dispose();
        return new TerminalCloseResult(sessionId, true);
    }

    private ConPtySession GetSession(string sessionId)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (!_sessions.TryGetValue(sessionId, out var session))
        {
            throw new KeyNotFoundException("The terminal session is no longer active.");
        }

        return session;
    }

    private void HandleOutputReceived(TerminalOutputChunk chunk)
    {
        if (!_disposed && _sessions.ContainsKey(chunk.SessionId))
        {
            OutputReceived?.Invoke(chunk);
        }
    }

    private void HandleSessionExited(TerminalSessionExit exit)
    {
        if (!_sessions.TryRemove(exit.SessionId, out var session))
        {
            return;
        }

        Detach(session);
        session.Dispose();
        if (!_disposed)
        {
            SessionExited?.Invoke(exit);
        }
    }

    private void Detach(ConPtySession session)
    {
        session.OutputReceived -= HandleOutputReceived;
        session.Exited -= HandleSessionExited;
    }

    private static int NormalizeColumns(int columns) => Math.Clamp(columns, 20, 400);

    private static int NormalizeRows(int rows) => Math.Clamp(rows, 5, 200);

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        foreach (var pair in _sessions.ToArray())
        {
            if (_sessions.TryRemove(pair.Key, out var session))
            {
                Detach(session);
                session.Dispose();
            }
        }
    }
}

internal sealed class ConPtySession : IDisposable
{
    private static readonly UTF8Encoding Utf8 = new(false);

    private readonly string _sessionId;
    private readonly TerminalProfile _profile;
    private readonly IntPtr _pseudoConsole;
    private readonly FileStream _input;
    private readonly FileStream _output;
    private readonly Process _process;
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private readonly CancellationTokenSource _shutdown = new();
    private readonly Task _outputTask;

    private long _sequence;
    private int _exitRaised;
    private bool _disposed;

    private ConPtySession(
        string sessionId,
        TerminalProfile profile,
        IntPtr pseudoConsole,
        IntPtr inputWrite,
        IntPtr outputRead,
        int processId,
        int columns,
        int rows)
    {
        _sessionId = sessionId;
        _profile = profile;
        _pseudoConsole = pseudoConsole;
        Columns = columns;
        Rows = rows;
        _input = new FileStream(
            new SafeFileHandle(inputWrite, ownsHandle: true),
            FileAccess.Write,
            4096,
            isAsync: false);
        _output = new FileStream(
            new SafeFileHandle(outputRead, ownsHandle: true),
            FileAccess.Read,
            8192,
            isAsync: false);
        _process = Process.GetProcessById(processId);
        _process.EnableRaisingEvents = true;
        _process.Exited += OnProcessExited;
        _outputTask = Task.Run(ReadOutputAsync);
    }

    public event Action<TerminalOutputChunk>? OutputReceived;

    public event Action<TerminalSessionExit>? Exited;

    public int Columns { get; private set; }

    public int Rows { get; private set; }

    public static ConPtySession Start(
        string sessionId,
        TerminalProfile profile,
        int columns,
        int rows)
    {
        IntPtr inputRead = IntPtr.Zero;
        IntPtr inputWrite = IntPtr.Zero;
        IntPtr outputRead = IntPtr.Zero;
        IntPtr outputWrite = IntPtr.Zero;
        IntPtr pseudoConsole = IntPtr.Zero;
        IntPtr attributeList = IntPtr.Zero;
        NativeMethods.ProcessInformation processInformation = default;

        try
        {
            var securityAttributes = new NativeMethods.SecurityAttributes
            {
                Length = Marshal.SizeOf<NativeMethods.SecurityAttributes>(),
                SecurityDescriptor = IntPtr.Zero,
                InheritHandle = 0
            };
            NativeMethods.ThrowLastWin32ErrorIfFalse(
                NativeMethods.CreatePipe(out inputRead, out inputWrite, ref securityAttributes, 0),
                "Unable to create the terminal input pipe.");
            NativeMethods.ThrowLastWin32ErrorIfFalse(
                NativeMethods.CreatePipe(out outputRead, out outputWrite, ref securityAttributes, 0),
                "Unable to create the terminal output pipe.");

            var createResult = NativeMethods.CreatePseudoConsole(
                new NativeMethods.Coord((short)columns, (short)rows),
                inputRead,
                outputWrite,
                0,
                out pseudoConsole);
            Marshal.ThrowExceptionForHR(createResult);

            NativeMethods.CloseAndClear(ref inputRead);
            NativeMethods.CloseAndClear(ref outputWrite);

            nuint attributeSize = 0;
            _ = NativeMethods.InitializeProcThreadAttributeList(
                IntPtr.Zero,
                1,
                0,
                ref attributeSize);
            if (attributeSize == 0)
            {
                throw new Win32Exception(
                    Marshal.GetLastWin32Error(),
                    "Unable to size the terminal process attribute list.");
            }

            attributeList = Marshal.AllocHGlobal(checked((nint)attributeSize));
            NativeMethods.ThrowLastWin32ErrorIfFalse(
                NativeMethods.InitializeProcThreadAttributeList(
                    attributeList,
                    1,
                    0,
                    ref attributeSize),
                "Unable to initialize the terminal process attribute list.");
            NativeMethods.ThrowLastWin32ErrorIfFalse(
                NativeMethods.UpdateProcThreadAttribute(
                    attributeList,
                    0,
                    NativeMethods.ProcThreadAttributePseudoConsole,
                    pseudoConsole,
                    (nuint)IntPtr.Size,
                    IntPtr.Zero,
                    IntPtr.Zero),
                "Unable to attach the pseudoconsole to the terminal process.");

            var startupInfo = new NativeMethods.StartupInfoEx
            {
                StartupInfo = new NativeMethods.StartupInfo
                {
                    Size = Marshal.SizeOf<NativeMethods.StartupInfoEx>()
                },
                AttributeList = attributeList
            };
            var commandLine = new StringBuilder(
                $"\"{profile.ExecutablePath}\"{(string.IsNullOrWhiteSpace(profile.Arguments) ? string.Empty : $" {profile.Arguments}")}");
            var workingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            if (!Directory.Exists(workingDirectory))
            {
                workingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            }

            NativeMethods.ThrowLastWin32ErrorIfFalse(
                NativeMethods.CreateProcessW(
                    profile.ExecutablePath,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    false,
                    NativeMethods.ExtendedStartupInfoPresent |
                    NativeMethods.CreateUnicodeEnvironment,
                    IntPtr.Zero,
                    workingDirectory,
                    ref startupInfo,
                    out processInformation),
                $"Unable to start {profile.Label}.");

            var session = new ConPtySession(
                sessionId,
                profile,
                pseudoConsole,
                inputWrite,
                outputRead,
                checked((int)processInformation.ProcessId),
                columns,
                rows);
            pseudoConsole = IntPtr.Zero;
            inputWrite = IntPtr.Zero;
            outputRead = IntPtr.Zero;
            return session;
        }
        finally
        {
            if (attributeList != IntPtr.Zero)
            {
                NativeMethods.DeleteProcThreadAttributeList(attributeList);
                Marshal.FreeHGlobal(attributeList);
            }

            NativeMethods.CloseAndClear(ref processInformation.ProcessHandle);
            NativeMethods.CloseAndClear(ref processInformation.ThreadHandle);
            NativeMethods.CloseAndClear(ref inputRead);
            NativeMethods.CloseAndClear(ref inputWrite);
            NativeMethods.CloseAndClear(ref outputRead);
            NativeMethods.CloseAndClear(ref outputWrite);
            if (pseudoConsole != IntPtr.Zero)
            {
                NativeMethods.ClosePseudoConsole(pseudoConsole);
            }
        }
    }

    public TerminalSessionInfo GetInfo() => new(
        _sessionId,
        _profile.Id,
        _profile.Label,
        _process.Id,
        Columns,
        Rows);

    public async Task WriteAsync(string data, CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        await _writeGate.WaitAsync(cancellationToken);
        try
        {
            var bytes = Utf8.GetBytes(data);
            await _input.WriteAsync(bytes, cancellationToken);
            await _input.FlushAsync(cancellationToken);
        }
        finally
        {
            _writeGate.Release();
        }
    }

    public void Resize(int columns, int rows)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var result = NativeMethods.ResizePseudoConsole(
            _pseudoConsole,
            new NativeMethods.Coord((short)columns, (short)rows));
        Marshal.ThrowExceptionForHR(result);
        Columns = columns;
        Rows = rows;
    }

    private async Task ReadOutputAsync()
    {
        var buffer = new char[8192];
        try
        {
            using var reader = new StreamReader(
                _output,
                Utf8,
                detectEncodingFromByteOrderMarks: false,
                bufferSize: 8192,
                leaveOpen: true);
            while (!_shutdown.IsCancellationRequested)
            {
                var count = await reader.ReadAsync(buffer.AsMemory(), _shutdown.Token);
                if (count == 0)
                {
                    return;
                }

                OutputReceived?.Invoke(new TerminalOutputChunk(
                    _sessionId,
                    Interlocked.Increment(ref _sequence),
                    new string(buffer, 0, count)));
            }
        }
        catch (OperationCanceledException) when (_shutdown.IsCancellationRequested)
        {
            // Closing a terminal session intentionally stops its output reader.
        }
        catch (IOException) when (_shutdown.IsCancellationRequested || _disposed)
        {
            // Closing the pipe releases a blocked reader during normal shutdown.
        }
        catch (ObjectDisposedException) when (_disposed)
        {
            // The output stream can be disposed while the process exits.
        }
    }

    private void OnProcessExited(object? sender, EventArgs e)
    {
        if (Interlocked.Exchange(ref _exitRaised, 1) != 0 || _disposed)
        {
            return;
        }

        int? exitCode = null;
        try
        {
            exitCode = _process.ExitCode;
        }
        catch (InvalidOperationException)
        {
            // A process can disappear before its exit code is available.
        }

        Exited?.Invoke(new TerminalSessionExit(_sessionId, exitCode));
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _shutdown.Cancel();
        _process.Exited -= OnProcessExited;
        _input.Dispose();
        if (_pseudoConsole != IntPtr.Zero)
        {
            NativeMethods.ClosePseudoConsole(_pseudoConsole);
        }

        _output.Dispose();
        try
        {
            if (!_process.HasExited)
            {
                _process.Kill(entireProcessTree: true);
            }
        }
        catch (InvalidOperationException)
        {
            // The process exited while the session was closing.
        }
        catch (Win32Exception)
        {
            // Closing the pseudoconsole is normally enough; do not fail shutdown.
        }

        _process.Dispose();
        _writeGate.Dispose();
        _shutdown.Dispose();
        _ = _outputTask.Exception;
    }
}

internal static class TerminalProfileCatalog
{
    public static IReadOnlyList<TerminalProfile> GetProfiles()
    {
        var windowsDirectory = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        var systemDirectory = Environment.GetFolderPath(Environment.SpecialFolder.System);
        var powerShell7 = FindOnPath("pwsh.exe") ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            "PowerShell",
            "7",
            "pwsh.exe");
        var windowsPowerShell = Path.Combine(
            systemDirectory,
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe");
        var preferredPowerShell = File.Exists(powerShell7) ? powerShell7 : windowsPowerShell;
        var cmd = Environment.GetEnvironmentVariable("ComSpec") ?? Path.Combine(systemDirectory, "cmd.exe");
        var wsl = Path.Combine(systemDirectory, "wsl.exe");

        return new[]
        {
            new TerminalProfile(
                "powershell",
                File.Exists(powerShell7) ? "PowerShell 7" : "Windows PowerShell",
                preferredPowerShell,
                "-NoLogo",
                File.Exists(preferredPowerShell),
                true),
            new TerminalProfile("cmd", "Command Prompt", cmd, "/Q", File.Exists(cmd), false),
            new TerminalProfile("wsl", "Windows Subsystem for Linux", wsl, string.Empty, File.Exists(wsl), false)
        };
    }

    public static TerminalProfile Resolve(string? profileId)
    {
        var profiles = GetProfiles();
        if (string.IsNullOrWhiteSpace(profileId))
        {
            return profiles.First(profile => profile.IsDefault);
        }

        return profiles.FirstOrDefault(profile =>
                   profile.Id.Equals(profileId, StringComparison.OrdinalIgnoreCase))
               ?? throw new ArgumentException("Unsupported terminal profile.", nameof(profileId));
    }

    private static string? FindOnPath(string executableName)
    {
        var pathValue = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrWhiteSpace(pathValue))
        {
            return null;
        }

        foreach (var rawDirectory in pathValue.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                var directory = rawDirectory.Trim().Trim('"');
                var candidate = Path.GetFullPath(Path.Combine(directory, executableName));
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }
            catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
            {
                // Ignore malformed PATH entries while resolving an allowlisted executable.
            }
        }

        return null;
    }
}

internal static class NativeMethods
{
    public const uint ExtendedStartupInfoPresent = 0x00080000;
    public const uint CreateUnicodeEnvironment = 0x00000400;
    public static readonly IntPtr ProcThreadAttributePseudoConsole = new(0x00020016);

    public static bool IsConPtyAvailable => OperatingSystem.IsWindowsVersionAtLeast(10, 0, 17763);

    public static void ThrowLastWin32ErrorIfFalse(bool succeeded, string message)
    {
        if (!succeeded)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), message);
        }
    }

    public static void CloseAndClear(ref IntPtr handle)
    {
        if (handle == IntPtr.Zero)
        {
            return;
        }

        _ = CloseHandle(handle);
        handle = IntPtr.Zero;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct Coord
    {
        public Coord(short x, short y)
        {
            X = x;
            Y = y;
        }

        public short X;
        public short Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct SecurityAttributes
    {
        public int Length;
        public IntPtr SecurityDescriptor;
        public int InheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct StartupInfo
    {
        public int Size;
        public string? Reserved;
        public string? Desktop;
        public string? Title;
        public int X;
        public int Y;
        public int XSize;
        public int YSize;
        public int XCountChars;
        public int YCountChars;
        public int FillAttribute;
        public int Flags;
        public short ShowWindow;
        public short Reserved2Size;
        public IntPtr Reserved2;
        public IntPtr StandardInput;
        public IntPtr StandardOutput;
        public IntPtr StandardError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct StartupInfoEx
    {
        public StartupInfo StartupInfo;
        public IntPtr AttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct ProcessInformation
    {
        public IntPtr ProcessHandle;
        public IntPtr ThreadHandle;
        public uint ProcessId;
        public uint ThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CreatePipe(
        out IntPtr readPipe,
        out IntPtr writePipe,
        ref SecurityAttributes pipeAttributes,
        int size);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern int CreatePseudoConsole(
        Coord size,
        IntPtr input,
        IntPtr output,
        uint flags,
        out IntPtr pseudoConsole);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern int ResizePseudoConsole(IntPtr pseudoConsole, Coord size);

    [DllImport("kernel32.dll")]
    public static extern void ClosePseudoConsole(IntPtr pseudoConsole);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool InitializeProcThreadAttributeList(
        IntPtr attributeList,
        int attributeCount,
        int flags,
        ref nuint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool UpdateProcThreadAttribute(
        IntPtr attributeList,
        uint flags,
        IntPtr attribute,
        IntPtr value,
        nuint size,
        IntPtr previousValue,
        IntPtr returnSize);

    [DllImport("kernel32.dll")]
    public static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CreateProcessW(
        string? applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref StartupInfoEx startupInfo,
        out ProcessInformation processInformation);
}

internal sealed record TerminalProfile(
    string Id,
    string Label,
    string ExecutablePath,
    string Arguments,
    bool Available,
    bool IsDefault);

internal sealed record TerminalProfileInfo(string Id, string Label, bool Available, bool IsDefault);

internal sealed record TerminalProfilesResult(
    IReadOnlyList<TerminalProfileInfo> Profiles,
    string DefaultProfileId,
    bool ConPtyAvailable);

internal sealed record TerminalSessionInfo(
    string SessionId,
    string ProfileId,
    string ProfileLabel,
    int ProcessId,
    int Columns,
    int Rows);

internal sealed record TerminalOutputChunk(string SessionId, long Sequence, string Data);

internal sealed record TerminalSessionExit(string SessionId, int? ExitCode);

internal sealed record TerminalWriteResult(string SessionId, int BytesWritten);

internal sealed record TerminalResizeResult(string SessionId, int Columns, int Rows);

internal sealed record TerminalCloseResult(string SessionId, bool Closed);
