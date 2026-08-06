using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Agents;

internal sealed class PiRpcClient : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly byte[] NewLine = [(byte)'\n'];
    private static readonly string[] FixedArguments =
    [
        "--mode", "rpc",
        "--no-session",
        "--no-tools",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-context-files",
        "--no-themes",
        "--no-approve",
        "--offline"
    ];

    private readonly PiAgentOptions _options;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private readonly ConcurrentDictionary<string, PendingCommand> _pending = new(StringComparer.Ordinal);
    private readonly object _stateGate = new();

    private WindowsLaunchedProcess? _launchedProcess;
    private WindowsProcessJob? _processJob;
    private long _requestSequence;
    private bool _started;
    private bool _faulted;
    private bool _disposed;
    private PiRpcFailure? _failure;

    public PiRpcClient(PiAgentOptions options)
    {
        _options = options;
    }

    public event Action<PiRpcClient, PiRpcEvent>? EventReceived;

    public event Action<PiRpcClient, PiRpcFailure>? Faulted;

    public bool IsConnected
    {
        get
        {
            lock (_stateGate)
            {
                return _started &&
                       !_faulted &&
                       !_disposed &&
                       _launchedProcess?.Process is { HasExited: false };
            }
        }
    }

    public void Start()
    {
        WindowsLaunchedProcess launchedToObserve;
        lock (_stateGate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_started)
            {
                return;
            }

            if (!_options.IsConfigured || _options.ExecutablePath is null)
            {
                throw new InvalidOperationException("Pi Agent is not configured.");
            }

            Directory.CreateDirectory(_options.AgentDirectory);
            Directory.CreateDirectory(_options.PackageDirectory);
            Directory.CreateDirectory(_options.WorkingDirectory);

            var startInfo = CreateStartInfo(_options);
            WindowsLaunchedProcess? launchedProcess = null;
            WindowsProcessJob? processJob = null;
            try
            {
                processJob = WindowsProcessJob.CreateKillOnClose();
                // Keep verified runtime files open without write/delete sharing through launch
                // and Job assignment. This narrows the hash-to-execution replacement window.
                using var runtimeLease = _options.OpenVerifiedRuntime();
                launchedProcess = WindowsSuspendedProcessLauncher.Start(startInfo, processJob);

                _launchedProcess = launchedProcess;
                _processJob = processJob;
                _started = true;
                launchedToObserve = launchedProcess;
                launchedProcess = null;
                processJob = null;
            }
            catch
            {
                TryKill(launchedProcess?.Process);
                launchedProcess?.Dispose();
                throw;
            }
            finally
            {
                processJob?.Dispose();
            }
        }

        _ = ObserveBackgroundTaskAsync(
            ReadStdoutAsync(launchedToObserve),
            "RPC stdout reader");
        _ = ObserveBackgroundTaskAsync(
            DrainStderrAsync(launchedToObserve),
            "stderr drain");
        _ = ObserveBackgroundTaskAsync(
            ObserveExitAsync(launchedToObserve.Process),
            "process exit observer");
    }

    public async Task<PiRpcResponse> SendAsync(
        string command,
        IReadOnlyDictionary<string, object?>? arguments,
        CancellationToken cancellationToken)
    {
        if (command is not ("get_state" or "get_messages" or "prompt" or "abort" or "new_session"))
        {
            throw new PiRpcProtocolException("The Pi RPC command is outside the chat-only allowlist.");
        }

        WindowsLaunchedProcess launchedProcess;
        lock (_stateGate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (!_started ||
                _faulted ||
                _launchedProcess is null ||
                _launchedProcess.Process.HasExited)
            {
                throw new InvalidOperationException("Pi Agent is not connected.");
            }
            launchedProcess = _launchedProcess;
        }

        var id = $"jarvis-pi-{Interlocked.Increment(ref _requestSequence)}";
        var completion = new TaskCompletionSource<PiRpcResponse>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        if (!_pending.TryAdd(id, new PendingCommand(command, completion)))
        {
            throw new InvalidOperationException("Pi Agent request identifiers collided.");
        }

        try
        {
            var payload = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["id"] = id,
                ["type"] = command
            };
            if (arguments is not null)
            {
                foreach (var pair in arguments)
                {
                    if (pair.Key is "id" or "type")
                    {
                        throw new ArgumentException(
                            "Pi RPC command arguments cannot override id or type.",
                            nameof(arguments));
                    }
                    payload[pair.Key] = pair.Value;
                }
            }

            var bytes = JsonSerializer.SerializeToUtf8Bytes(payload, JsonOptions);
            if (bytes.Length > _options.MaximumJsonLineBytes)
            {
                throw new PiRpcProtocolException("The Pi RPC command exceeds the JSONL size limit.");
            }

            using var timeout = new CancellationTokenSource(_options.CommandTimeout);
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(
                cancellationToken,
                _lifetime.Token,
                timeout.Token);

            await _writeGate.WaitAsync(linked.Token).ConfigureAwait(false);
            try
            {
                await launchedProcess.StandardInput
                    .WriteAsync(bytes, linked.Token)
                    .ConfigureAwait(false);
                await launchedProcess.StandardInput
                    .WriteAsync(NewLine, linked.Token)
                    .ConfigureAwait(false);
                await launchedProcess.StandardInput
                    .FlushAsync(linked.Token)
                    .ConfigureAwait(false);
            }
            finally
            {
                _writeGate.Release();
            }

            return await completion.Task.WaitAsync(linked.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
            PiRpcFailure failure;
            lock (_stateGate)
            {
                failure = _failure ?? new PiRpcFailure(
                    "PROVIDER_CRASHED",
                    "Pi Agent disconnected unexpectedly.",
                    Retryable: true);
            }
            throw new PiRpcCommandException(
                failure.Code,
                failure.Message,
                failure.Retryable);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new PiRpcCommandException(
                "COMMAND_TIMEOUT",
                $"Pi RPC command '{command}' timed out.",
                retryable: true);
        }
        finally
        {
            _pending.TryRemove(id, out _);
        }
    }

    public void Terminate(PiRpcFailure failure)
    {
        Fault(failure);
    }

    private static ProcessStartInfo CreateStartInfo(PiAgentOptions options)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = options.ExecutablePath!,
            WorkingDirectory = options.WorkingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(false),
            StandardOutputEncoding = new UTF8Encoding(false, true),
            StandardErrorEncoding = new UTF8Encoding(false, true)
        };
        foreach (var argument in FixedArguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        startInfo.Environment["PI_CODING_AGENT_DIR"] = options.AgentDirectory;
        startInfo.Environment["PI_PACKAGE_DIR"] = options.PackageDirectory;
        startInfo.Environment["PI_SKIP_VERSION_CHECK"] = "1";
        startInfo.Environment["PI_TELEMETRY"] = "0";
        startInfo.Environment["PI_OFFLINE"] = "1";
        return startInfo;
    }

    private async Task ReadStdoutAsync(WindowsLaunchedProcess process)
    {
        var decoder = new StrictLfJsonLineDecoder(_options.MaximumJsonLineBytes);
        var buffer = new byte[8192];
        try
        {
            while (!_lifetime.IsCancellationRequested)
            {
                var count = await process.StandardOutput
                    .ReadAsync(buffer, _lifetime.Token)
                    .ConfigureAwait(false);
                if (count == 0)
                {
                    break;
                }

                foreach (var line in decoder.Push(buffer.AsSpan(0, count)))
                {
                    ProcessLine(line);
                }
            }

            decoder.Complete();
            if (!_lifetime.IsCancellationRequested)
            {
                Fault(new PiRpcFailure(
                    "PROVIDER_CRASHED",
                    "Pi Agent closed its RPC output unexpectedly.",
                    Retryable: true));
            }
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
            // Normal termination closes the redirected stream.
        }
        catch (PiRpcOutputLimitException exception)
        {
            HostLog.Warning($"Pi Agent output limit reached: {exception.Message}");
            Fault(new PiRpcFailure(
                "OUTPUT_LIMIT_EXCEEDED",
                "Pi Agent exceeded the output limit for one turn.",
                Retryable: true));
        }
        catch (PiRpcProtocolException exception)
        {
            HostLog.Warning($"Pi Agent protocol violation: {exception.Message}");
            Fault(new PiRpcFailure(
                "PROTOCOL_ERROR",
                "Pi Agent returned an invalid chat-only RPC stream."));
        }
        catch (JsonException exception)
        {
            HostLog.Warning($"Pi Agent emitted invalid JSON: {exception.GetType().Name}.");
            Fault(new PiRpcFailure(
                "PROTOCOL_ERROR",
                "Pi Agent returned an invalid chat-only RPC stream."));
        }
        catch (Exception exception) when (
            exception is IOException or ObjectDisposedException or DecoderFallbackException)
        {
            HostLog.Warning($"Pi Agent RPC reader failed: {exception.GetType().Name}.");
            Fault(new PiRpcFailure(
                "PROVIDER_CRASHED",
                "Pi Agent disconnected unexpectedly.",
                Retryable: true));
        }
    }

    private async Task DrainStderrAsync(WindowsLaunchedProcess process)
    {
        var buffer = new byte[4096];
        try
        {
            while (!_lifetime.IsCancellationRequested)
            {
                var count = await process.StandardError
                    .ReadAsync(buffer, _lifetime.Token)
                    .ConfigureAwait(false);
                if (count == 0)
                {
                    return;
                }
            }
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
            // Stderr is intentionally drained and discarded to avoid leaking prompts or secrets.
        }
        catch (Exception exception) when (exception is IOException or ObjectDisposedException)
        {
            // Stdout/process-exit handling owns the visible failure state.
        }
    }

    private async Task ObserveExitAsync(Process process)
    {
        try
        {
            await process.WaitForExitAsync(_lifetime.Token).ConfigureAwait(false);
            if (!_lifetime.IsCancellationRequested)
            {
                Fault(new PiRpcFailure(
                    "PROVIDER_CRASHED",
                    "Pi Agent exited unexpectedly.",
                    Retryable: true));
            }
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
            // Normal disposal cancels the exit observer.
        }
    }

    private async Task ObserveBackgroundTaskAsync(Task task, string operation)
    {
        try
        {
            await task.ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
            // Normal disposal cancels all three observers together.
        }
        catch (Exception exception) when (!IsFatalBackgroundException(exception))
        {
            HostLog.Warning(
                $"Pi Agent {operation} failed closed after {exception.GetType().Name}.");
            Fault(new PiRpcFailure(
                "PROVIDER_CRASHED",
                "Pi Agent disconnected unexpectedly.",
                Retryable: true));
        }
    }

    internal static bool IsFatalBackgroundException(Exception exception) =>
        exception is OutOfMemoryException or StackOverflowException or AccessViolationException;

    private void ProcessLine(string line)
    {
        if (string.IsNullOrWhiteSpace(line))
        {
            throw new PiRpcProtocolException("Pi RPC emitted an empty JSONL record.");
        }

        using var document = JsonDocument.Parse(line);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object ||
            !root.TryGetProperty("type", out var typeElement) ||
            typeElement.ValueKind != JsonValueKind.String)
        {
            throw new PiRpcProtocolException("Pi RPC emitted a JSON object without a type string.");
        }

        if (!typeElement.ValueEquals("response"))
        {
            EventReceived?.Invoke(this, new PiRpcEvent(root.Clone(), line.Length));
            return;
        }

        if (!root.TryGetProperty("id", out var idElement) ||
            idElement.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(idElement.GetString()))
        {
            throw new PiRpcProtocolException("Pi RPC emitted a response without a request id.");
        }

        var id = idElement.GetString()!;
        if (!_pending.TryGetValue(id, out var pending))
        {
            throw new PiRpcProtocolException("Pi RPC emitted a response for an unknown request id.");
        }

        if (!root.TryGetProperty("success", out var successElement) ||
            successElement.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            throw new PiRpcProtocolException("Pi RPC response is missing a success boolean.");
        }

        var responseCommand = root.TryGetProperty("command", out var commandElement) &&
                              commandElement.ValueKind == JsonValueKind.String
            ? commandElement.GetString()!
            : pending.Command;
        if (!responseCommand.Equals(pending.Command, StringComparison.Ordinal))
        {
            throw new PiRpcProtocolException("Pi RPC response command did not match its request.");
        }

        JsonElement? data = root.TryGetProperty("data", out var dataElement)
            ? dataElement.Clone()
            : null;
        var error = root.TryGetProperty("error", out var errorElement) &&
                    errorElement.ValueKind == JsonValueKind.String
            ? errorElement.GetString()
            : null;
        pending.Completion.TrySetResult(new PiRpcResponse(
            pending.Command,
            successElement.GetBoolean(),
            data,
            error));
    }

    private void Fault(PiRpcFailure failure)
    {
        Process? process;
        lock (_stateGate)
        {
            if (_faulted || _disposed)
            {
                return;
            }

            _faulted = true;
            _failure = failure;
            process = _launchedProcess?.Process;
        }

        _lifetime.Cancel();
        TryKill(process);
        var exception = new PiRpcCommandException(
            failure.Code,
            failure.Message,
            failure.Retryable);
        foreach (var pending in _pending.Values)
        {
            pending.Completion.TrySetException(exception);
        }
        _pending.Clear();
        try
        {
            Faulted?.Invoke(this, failure);
        }
        catch (Exception subscriberException) when (!IsFatalBackgroundException(subscriberException))
        {
            HostLog.Warning(
                $"Pi Agent fault subscriber failed after {subscriberException.GetType().Name}.");
        }
    }

    private static void TryKill(Process? process)
    {
        if (process is null)
        {
            return;
        }

        try
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
            }
        }
        catch (Exception exception) when (
            exception is InvalidOperationException or NotSupportedException or System.ComponentModel.Win32Exception)
        {
            // The process may have exited between the state check and the kill request.
        }
    }

    public void Dispose()
    {
        WindowsLaunchedProcess? launchedProcess;
        WindowsProcessJob? processJob;
        lock (_stateGate)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            launchedProcess = _launchedProcess;
            _launchedProcess = null;
            processJob = _processJob;
            _processJob = null;
        }

        _lifetime.Cancel();
        TryKill(launchedProcess?.Process);
        processJob?.Dispose();
        foreach (var pending in _pending.Values)
        {
            pending.Completion.TrySetCanceled();
        }
        _pending.Clear();
        launchedProcess?.Dispose();
    }

    private sealed record PendingCommand(
        string Command,
        TaskCompletionSource<PiRpcResponse> Completion);
}

internal readonly record struct PiRpcEvent(JsonElement Payload, int PayloadCharacters);

internal sealed class PiRpcCommandException : Exception
{
    public PiRpcCommandException(string code, string message, bool retryable = false)
        : base(message)
    {
        Code = code;
        Retryable = retryable;
    }

    public string Code { get; }

    public bool Retryable { get; }
}
