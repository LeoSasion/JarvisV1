using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Jarvis.Host.Agents;

internal static class WindowsSuspendedProcessLauncher
{
    private const uint CreateSuspended = 0x00000004;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const uint ExtendedStartupInfoPresent = 0x00080000;
    private const uint CreateNoWindow = 0x08000000;
    private const uint StartfUseStdHandles = 0x00000100;
    private const uint HandleFlagInherit = 0x00000001;
    private const int ErrorInsufficientBuffer = 122;
    private const uint LaunchTerminationTimeoutMilliseconds = 5_000;
    private const uint WaitObject0 = 0x00000000;
    private const uint WaitTimeout = 0x00000102;
    private const uint WaitFailed = 0xFFFFFFFF;
    private static readonly IntPtr ProcThreadAttributeHandleList = new(0x00020002);

    public static WindowsLaunchedProcess Start(
        ProcessStartInfo startInfo,
        WindowsProcessJob processJob)
    {
        ArgumentNullException.ThrowIfNull(startInfo);
        ArgumentNullException.ThrowIfNull(processJob);
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException(
                "The suspended Pi Agent launcher requires Windows.");
        }
        ValidateStartInfo(startInfo);

        SafeFileHandle? childStandardInput = null;
        SafeFileHandle? parentStandardInput = null;
        SafeFileHandle? parentStandardOutput = null;
        SafeFileHandle? childStandardOutput = null;
        SafeFileHandle? parentStandardError = null;
        SafeFileHandle? childStandardError = null;
        SafeProcessHandle? nativeProcess = null;
        SafeWaitHandle? nativeThread = null;
        IntPtr rawProcess = IntPtr.Zero;
        IntPtr rawThread = IntPtr.Zero;
        Process? managedProcess = null;
        FileStream? standardInput = null;
        FileStream? standardOutput = null;
        FileStream? standardError = null;
        IntPtr environmentPointer = IntPtr.Zero;
        uint processId = 0;

        try
        {
            CreateParentWritePipe(out childStandardInput, out parentStandardInput);
            CreateParentReadPipe(out parentStandardOutput, out childStandardOutput);
            CreateParentReadPipe(out parentStandardError, out childStandardError);

            using var attributeList = ProcThreadAttributeList.Create(
                childStandardInput,
                childStandardOutput,
                childStandardError);
            var startupInfo = new StartupInfoEx
            {
                StartupInfo = new StartupInfo
                {
                    Size = checked((uint)Marshal.SizeOf<StartupInfoEx>()),
                    Flags = StartfUseStdHandles,
                    StandardInput = childStandardInput.DangerousGetHandle(),
                    StandardOutput = childStandardOutput.DangerousGetHandle(),
                    StandardError = childStandardError.DangerousGetHandle()
                },
                AttributeList = attributeList.Pointer
            };

            var executablePath = Path.GetFullPath(startInfo.FileName);
            var commandLine = new StringBuilder(BuildCommandLine(
                executablePath,
                startInfo.ArgumentList));
            var environmentBlock = BuildEnvironmentBlock(startInfo.Environment);
            environmentPointer = AllocateEnvironmentBlock(environmentBlock);
            var workingDirectory = string.IsNullOrWhiteSpace(startInfo.WorkingDirectory)
                ? Environment.CurrentDirectory
                : Path.GetFullPath(startInfo.WorkingDirectory);

            if (!NativeMethods.CreateProcessW(
                    executablePath,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    inheritHandles: true,
                    CreateSuspended |
                    CreateUnicodeEnvironment |
                    ExtendedStartupInfoPresent |
                    CreateNoWindow,
                    environmentPointer,
                    workingDirectory,
                    ref startupInfo,
                    out var processInformation))
            {
                throw new Win32Exception(
                    Marshal.GetLastWin32Error(),
                    "Could not create the suspended Pi Agent process.");
            }

            rawProcess = processInformation.Process;
            rawThread = processInformation.Thread;
            processId = processInformation.ProcessId;
            nativeProcess = new SafeProcessHandle(rawProcess, ownsHandle: true);
            rawProcess = IntPtr.Zero;
            nativeThread = new SafeWaitHandle(rawThread, ownsHandle: true);
            rawThread = IntPtr.Zero;

            // No child code can execute before this succeeds: CREATE_SUSPENDED remains in
            // force until the process is fully contained by the kill-on-close Job Object.
            processJob.Assign(nativeProcess);

            managedProcess = Process.GetProcessById(checked((int)processId));
            standardInput = new FileStream(
                parentStandardInput,
                FileAccess.Write,
                bufferSize: 4096,
                isAsync: false);
            parentStandardInput = null;
            standardOutput = new FileStream(
                parentStandardOutput,
                FileAccess.Read,
                bufferSize: 4096,
                isAsync: false);
            parentStandardOutput = null;
            standardError = new FileStream(
                parentStandardError,
                FileAccess.Read,
                bufferSize: 4096,
                isAsync: false);
            parentStandardError = null;

            var previousSuspendCount = NativeMethods.ResumeThread(nativeThread);
            if (previousSuspendCount == uint.MaxValue)
            {
                throw new Win32Exception(
                    Marshal.GetLastWin32Error(),
                    "Could not resume the contained Pi Agent process.");
            }
            if (previousSuspendCount != 1)
            {
                throw new InvalidOperationException(
                    "The Pi Agent primary thread had an unexpected suspension count.");
            }

            var launchedProcess = new WindowsLaunchedProcess(
                managedProcess,
                standardInput,
                standardOutput,
                standardError);
            managedProcess = null;
            standardInput = null;
            standardOutput = null;
            standardError = null;
            return launchedProcess;
        }
        catch (Exception exception)
        {
            var terminationFailure = TerminateCreatedProcess(nativeProcess, rawProcess);
            if (processId != 0)
            {
                Exception innerException = terminationFailure is null
                    ? exception
                    : new AggregateException(exception, terminationFailure);
                throw new WindowsProcessLaunchException(
                    "The suspended Pi Agent process could not be launched safely.",
                    processId,
                    terminationFailure is null,
                    innerException);
            }
            throw;
        }
        finally
        {
            DisposeWithoutThrow(standardInput);
            DisposeWithoutThrow(standardOutput);
            DisposeWithoutThrow(standardError);
            DisposeWithoutThrow(managedProcess);
            DisposeWithoutThrow(nativeThread);
            DisposeWithoutThrow(nativeProcess);
            if (rawThread != IntPtr.Zero)
            {
                NativeMethods.CloseHandle(rawThread);
            }
            if (rawProcess != IntPtr.Zero)
            {
                NativeMethods.CloseHandle(rawProcess);
            }
            DisposeWithoutThrow(childStandardInput);
            DisposeWithoutThrow(childStandardOutput);
            DisposeWithoutThrow(childStandardError);
            DisposeWithoutThrow(parentStandardInput);
            DisposeWithoutThrow(parentStandardOutput);
            DisposeWithoutThrow(parentStandardError);
            if (environmentPointer != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(environmentPointer);
            }
        }
    }

    private static void DisposeWithoutThrow(IDisposable? value)
    {
        try
        {
            value?.Dispose();
        }
        catch
        {
            // Continue closing every remaining independent launch resource.
        }
    }

    internal static string BuildCommandLine(
        string executablePath,
        IEnumerable<string> arguments)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(executablePath);
        ArgumentNullException.ThrowIfNull(arguments);
        if (executablePath.Contains('\0'))
        {
            throw new ArgumentException("The executable path contains a null character.", nameof(executablePath));
        }

        var commandLine = new StringBuilder();
        AppendQuotedArgument(commandLine, executablePath, forceQuotes: true);
        foreach (var argument in arguments)
        {
            ArgumentNullException.ThrowIfNull(argument);
            if (argument.Contains('\0'))
            {
                throw new ArgumentException("A process argument contains a null character.", nameof(arguments));
            }
            commandLine.Append(' ');
            AppendQuotedArgument(commandLine, argument, forceQuotes: false);
        }

        // CreateProcess includes the terminating null in its 32,767-character limit.
        if (commandLine.Length > 32_766)
        {
            throw new ArgumentException("The Pi Agent command line exceeds the Windows limit.", nameof(arguments));
        }
        return commandLine.ToString();
    }

    internal static string BuildEnvironmentBlock(
        IEnumerable<KeyValuePair<string, string?>> environment)
    {
        ArgumentNullException.ThrowIfNull(environment);
        var entries = environment
            .OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase)
            .ThenBy(pair => pair.Key, StringComparer.Ordinal)
            .ToArray();
        var block = new StringBuilder();
        foreach (var pair in entries)
        {
            if (string.IsNullOrEmpty(pair.Key) ||
                pair.Key.Contains('=') ||
                pair.Key.Contains('\0'))
            {
                throw new ArgumentException("A process environment key is invalid.", nameof(environment));
            }
            var value = pair.Value ?? string.Empty;
            if (value.Contains('\0'))
            {
                throw new ArgumentException("A process environment value contains a null character.", nameof(environment));
            }
            block.Append(pair.Key);
            block.Append('=');
            block.Append(value);
            block.Append('\0');
        }
        block.Append('\0');
        if (entries.Length == 0)
        {
            block.Append('\0');
        }
        return block.ToString();
    }

    private static void ValidateStartInfo(ProcessStartInfo startInfo)
    {
        if (startInfo.UseShellExecute)
        {
            throw new ArgumentException("The native Pi Agent launcher cannot use the shell.", nameof(startInfo));
        }
        if (!startInfo.RedirectStandardInput ||
            !startInfo.RedirectStandardOutput ||
            !startInfo.RedirectStandardError)
        {
            throw new ArgumentException("All Pi Agent standard streams must be redirected.", nameof(startInfo));
        }
        if (!string.IsNullOrEmpty(startInfo.Arguments))
        {
            throw new ArgumentException(
                "Use ArgumentList so Pi Agent arguments retain an unambiguous boundary.",
                nameof(startInfo));
        }
        if (string.IsNullOrWhiteSpace(startInfo.FileName) ||
            !Path.IsPathFullyQualified(startInfo.FileName))
        {
            throw new ArgumentException("The Pi Agent executable path must be absolute.", nameof(startInfo));
        }
    }

    private static void CreateParentWritePipe(
        out SafeFileHandle childRead,
        out SafeFileHandle parentWrite)
    {
        CreatePipe(out childRead, out parentWrite);
        ClearInheritFlag(parentWrite);
    }

    private static void CreateParentReadPipe(
        out SafeFileHandle parentRead,
        out SafeFileHandle childWrite)
    {
        CreatePipe(out parentRead, out childWrite);
        ClearInheritFlag(parentRead);
    }

    private static void CreatePipe(out SafeFileHandle read, out SafeFileHandle write)
    {
        var securityAttributes = new SecurityAttributes
        {
            Length = checked((uint)Marshal.SizeOf<SecurityAttributes>()),
            InheritHandle = 1
        };
        if (!NativeMethods.CreatePipe(out read, out write, ref securityAttributes, size: 0))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not create a Pi Agent stdio pipe.");
        }
    }

    private static void ClearInheritFlag(SafeFileHandle handle)
    {
        if (!NativeMethods.SetHandleInformation(handle, HandleFlagInherit, flags: 0))
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error(),
                "Could not isolate the parent side of a Pi Agent stdio pipe.");
        }
    }

    private static IntPtr AllocateEnvironmentBlock(string block)
    {
        var characters = block.ToCharArray();
        var pointer = Marshal.AllocHGlobal(checked(characters.Length * sizeof(char)));
        Marshal.Copy(characters, startIndex: 0, pointer, characters.Length);
        return pointer;
    }

    private static Exception? TerminateCreatedProcess(
        SafeProcessHandle? process,
        IntPtr rawProcess)
    {
        if (process is not null && !process.IsInvalid && !process.IsClosed)
        {
            return TerminateCreatedProcess(process);
        }
        if (rawProcess != IntPtr.Zero)
        {
            return TerminateCreatedProcess(rawProcess);
        }
        return null;
    }

    private static Exception? TerminateCreatedProcess(SafeProcessHandle process)
    {
        try
        {
            if (!NativeMethods.TerminateProcess(process, exitCode: 1))
            {
                var error = Marshal.GetLastWin32Error();
                var state = NativeMethods.WaitForSingleObject(process, milliseconds: 0);
                if (state == WaitObject0)
                {
                    return null;
                }
                return new Win32Exception(error, "Could not terminate the suspended Pi Agent process.");
            }

            return MapTerminationWaitResult(NativeMethods.WaitForSingleObject(
                process,
                LaunchTerminationTimeoutMilliseconds));
        }
        catch (Exception exception)
        {
            return exception;
        }
    }

    private static Exception? TerminateCreatedProcess(IntPtr process)
    {
        try
        {
            if (!NativeMethods.TerminateProcessRaw(process, exitCode: 1))
            {
                var error = Marshal.GetLastWin32Error();
                var state = NativeMethods.WaitForSingleObjectRaw(process, milliseconds: 0);
                if (state == WaitObject0)
                {
                    return null;
                }
                return new Win32Exception(error, "Could not terminate the suspended Pi Agent process.");
            }

            return MapTerminationWaitResult(NativeMethods.WaitForSingleObjectRaw(
                process,
                LaunchTerminationTimeoutMilliseconds));
        }
        catch (Exception exception)
        {
            return exception;
        }
    }

    private static Exception? MapTerminationWaitResult(uint waitResult) =>
        waitResult switch
        {
            WaitObject0 => null,
            WaitFailed => new Win32Exception(
                Marshal.GetLastWin32Error(),
                "Could not confirm termination of the suspended Pi Agent process."),
            WaitTimeout => new TimeoutException(
                "Timed out while confirming termination of the suspended Pi Agent process."),
            _ => new InvalidOperationException(
                "Windows returned an unexpected result while confirming Pi Agent termination.")
        };

    private static void AppendQuotedArgument(
        StringBuilder target,
        string argument,
        bool forceQuotes)
    {
        var requiresQuotes = forceQuotes ||
                             argument.Length == 0 ||
                             argument.Any(character => char.IsWhiteSpace(character) || character == '"');
        if (!requiresQuotes)
        {
            target.Append(argument);
            return;
        }

        target.Append('"');
        var backslashes = 0;
        foreach (var character in argument)
        {
            if (character == '\\')
            {
                backslashes++;
                continue;
            }
            if (character == '"')
            {
                target.Append('\\', checked((backslashes * 2) + 1));
                target.Append('"');
                backslashes = 0;
                continue;
            }
            target.Append('\\', backslashes);
            backslashes = 0;
            target.Append(character);
        }
        target.Append('\\', checked(backslashes * 2));
        target.Append('"');
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes
    {
        public uint Length;
        public IntPtr SecurityDescriptor;
        public int InheritHandle;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfo
    {
        public uint Size;
        public IntPtr Reserved;
        public IntPtr Desktop;
        public IntPtr Title;
        public uint X;
        public uint Y;
        public uint XSize;
        public uint YSize;
        public uint XCountCharacters;
        public uint YCountCharacters;
        public uint FillAttribute;
        public uint Flags;
        public ushort ShowWindow;
        public ushort Reserved2Size;
        public IntPtr Reserved2;
        public IntPtr StandardInput;
        public IntPtr StandardOutput;
        public IntPtr StandardError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfoEx
    {
        public StartupInfo StartupInfo;
        public IntPtr AttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr Process;
        public IntPtr Thread;
        public uint ProcessId;
        public uint ThreadId;
    }

    private sealed class ProcThreadAttributeList : IDisposable
    {
        private IntPtr _pointer;
        private IntPtr _handles;
        private bool _initialized;

        private ProcThreadAttributeList()
        {
        }

        public IntPtr Pointer => _pointer;

        public static ProcThreadAttributeList Create(params SafeFileHandle[] handles)
        {
            var value = new ProcThreadAttributeList();
            try
            {
                IntPtr bytes = IntPtr.Zero;
                var initialized = NativeMethods.InitializeProcThreadAttributeList(
                    IntPtr.Zero,
                    attributeCount: 1,
                    flags: 0,
                    ref bytes);
                var sizeError = Marshal.GetLastWin32Error();
                if (initialized || bytes == IntPtr.Zero || sizeError != ErrorInsufficientBuffer)
                {
                    throw new Win32Exception(
                        sizeError,
                        "Could not size the Pi Agent process attribute list.");
                }

                value._pointer = Marshal.AllocHGlobal(bytes);
                if (!NativeMethods.InitializeProcThreadAttributeList(
                        value._pointer,
                        attributeCount: 1,
                        flags: 0,
                        ref bytes))
                {
                    throw new Win32Exception(
                        Marshal.GetLastWin32Error(),
                        "Could not initialize the Pi Agent process attribute list.");
                }
                value._initialized = true;

                value._handles = Marshal.AllocHGlobal(checked(IntPtr.Size * handles.Length));
                for (var index = 0; index < handles.Length; index++)
                {
                    Marshal.WriteIntPtr(
                        value._handles,
                        checked(index * IntPtr.Size),
                        handles[index].DangerousGetHandle());
                }
                if (!NativeMethods.UpdateProcThreadAttribute(
                        value._pointer,
                        flags: 0,
                        ProcThreadAttributeHandleList,
                        value._handles,
                        new IntPtr(checked(IntPtr.Size * handles.Length)),
                        IntPtr.Zero,
                        IntPtr.Zero))
                {
                    throw new Win32Exception(
                        Marshal.GetLastWin32Error(),
                        "Could not restrict inherited Pi Agent process handles.");
                }
                return value;
            }
            catch
            {
                value.Dispose();
                throw;
            }
        }

        public void Dispose()
        {
            if (_pointer != IntPtr.Zero)
            {
                if (_initialized)
                {
                    NativeMethods.DeleteProcThreadAttributeList(_pointer);
                    _initialized = false;
                }
                Marshal.FreeHGlobal(_pointer);
                _pointer = IntPtr.Zero;
            }
            if (_handles != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(_handles);
                _handles = IntPtr.Zero;
            }
        }
    }

    private static class NativeMethods
    {
        [DllImport("kernel32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool CreatePipe(
            out SafeFileHandle readPipe,
            out SafeFileHandle writePipe,
            ref SecurityAttributes pipeAttributes,
            uint size);

        [DllImport("kernel32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetHandleInformation(
            SafeFileHandle handle,
            uint mask,
            uint flags);

        [DllImport("kernel32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool InitializeProcThreadAttributeList(
            IntPtr attributeList,
            int attributeCount,
            uint flags,
            ref IntPtr size);

        [DllImport("kernel32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool UpdateProcThreadAttribute(
            IntPtr attributeList,
            uint flags,
            IntPtr attribute,
            IntPtr value,
            IntPtr size,
            IntPtr previousValue,
            IntPtr returnSize);

        [DllImport("kernel32.dll")]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        public static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

        [DllImport(
            "kernel32.dll",
            CharSet = CharSet.Unicode,
            ExactSpelling = true,
            SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool CreateProcessW(
            string applicationName,
            StringBuilder commandLine,
            IntPtr processAttributes,
            IntPtr threadAttributes,
            [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
            uint creationFlags,
            IntPtr environment,
            string currentDirectory,
            ref StartupInfoEx startupInfo,
            out ProcessInformation processInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        public static extern uint ResumeThread(SafeWaitHandle thread);

        [DllImport("kernel32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool TerminateProcess(SafeProcessHandle process, uint exitCode);

        [DllImport("kernel32.dll", EntryPoint = "TerminateProcess", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool TerminateProcessRaw(IntPtr process, uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        public static extern uint WaitForSingleObject(SafeProcessHandle handle, uint milliseconds);

        [DllImport("kernel32.dll", EntryPoint = "WaitForSingleObject", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        public static extern uint WaitForSingleObjectRaw(IntPtr handle, uint milliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool CloseHandle(IntPtr handle);
    }
}

internal sealed class WindowsLaunchedProcess : IDisposable
{
    private int _disposed;

    public WindowsLaunchedProcess(
        Process process,
        FileStream standardInput,
        FileStream standardOutput,
        FileStream standardError)
    {
        Process = process;
        StandardInput = standardInput;
        StandardOutput = standardOutput;
        StandardError = standardError;
    }

    public Process Process { get; }

    public FileStream StandardInput { get; }

    public FileStream StandardOutput { get; }

    public FileStream StandardError { get; }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }
        try
        {
            StandardInput.Dispose();
        }
        finally
        {
            try
            {
                StandardOutput.Dispose();
            }
            finally
            {
                try
                {
                    StandardError.Dispose();
                }
                finally
                {
                    Process.Dispose();
                }
            }
        }
    }
}

internal sealed class WindowsProcessLaunchException : Exception
{
    public WindowsProcessLaunchException(
        string message,
        uint processId,
        bool terminationConfirmed,
        Exception innerException)
        : base(message, innerException)
    {
        ProcessId = processId;
        TerminationConfirmed = terminationConfirmed;
    }

    public uint ProcessId { get; }

    public bool TerminationConfirmed { get; }
}
