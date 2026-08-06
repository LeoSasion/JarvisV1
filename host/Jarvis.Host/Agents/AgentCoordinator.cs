using System.Text;
using System.Text.Json;
using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Agents;

internal sealed class AgentCoordinator : IDisposable
{
    private const int MaximumRememberedPrompts = 128;
    private const int MaximumRememberedMessages = 512;
    private const int MaximumMessageCharacters = 256 * 1024;
    private const long MaximumRememberedMessageCharacters = 2L * 1024 * 1024;
    private const int MaximumTurnEventCount = 16 * 1024;
    private const long MaximumTurnOutputCharacters = 1024 * 1024;
    private const long MaximumTurnPayloadCharacters = 32L * 1024 * 1024;
    private const int MaximumRememberedTerminalRuns = 128;

    private readonly PiAgentOptions _options;
    private readonly Func<IAgentRpcClient> _clientFactory;
    private readonly object _gate = new();
    private readonly object _eventGate = new();
    private readonly SemaphoreSlim _clientStartGate = new(1, 1);
    private readonly Dictionary<string, AgentPromptResult> _promptResults = new(StringComparer.Ordinal);
    private readonly Dictionary<string, TaskCompletionSource<AgentPromptResult>> _pendingPrompts =
        new(StringComparer.Ordinal);
    private readonly Queue<string> _promptResultOrder = new();
    private readonly List<AgentMessageSnapshot> _messages = [];
    private readonly Queue<AgentUiEvent> _pendingEvents = new();
    private readonly Dictionary<string, long> _eventSequences = new(StringComparer.Ordinal);
    private readonly HashSet<string> _terminalRuns = new(StringComparer.Ordinal);
    private readonly Queue<string> _terminalRunOrder = new();

    private IAgentRpcClient? _client;
    private ActiveRun? _activeRun;
    private TaskCompletionSource<AgentPromptResult>? _promptReservationOwner;
    private AgentStateSnapshot _state;
    private long _rememberedMessageCharacters;
    private bool _sessionChanging;
    private bool _abortInProgress;
    private bool _publishingEvents;
    private bool _disposed;

    public AgentCoordinator(PiAgentOptions options)
        : this(options, () => new PiAgentRpcClient(options))
    {
    }

    internal AgentCoordinator(
        PiAgentOptions options,
        Func<IAgentRpcClient> clientFactory)
    {
        _options = options;
        _clientFactory = clientFactory;
        var configurationError = options.IsConfigured
            ? null
            : new AgentError(
                "PROVIDER_NOT_CONFIGURED",
                options.ConfigurationIssue ?? "Pi Agent is not configured.");
        _state = new AgentStateSnapshot(
            Provider: "pi",
            Model: null,
            PermissionMode: options.PermissionMode,
            Available: options.IsConfigured,
            Configured: options.IsConfigured,
            Connected: false,
            Running: false,
            Status: options.IsConfigured ? "ready" : "unavailable",
            SessionId: null,
            ActiveRunId: null,
            Error: configurationError);
    }

    public event Action<AgentStateSnapshot>? StateChanged;

    public event Action<AgentUiEvent>? EventReceived;

    public AgentStateSnapshot GetStateSnapshot()
    {
        lock (_gate)
        {
            return _state;
        }
    }

    public async Task<AgentStateSnapshot> GetStateAsync(CancellationToken cancellationToken)
    {
        var client = GetConnectedClient();
        if (client is null)
        {
            return GetStateSnapshot();
        }

        try
        {
            var response = await client.SendAsync(
                "get_state",
                arguments: null,
                cancellationToken).ConfigureAwait(false);
            if (response.Success &&
                response.Data is JsonElement data &&
                data.ValueKind == JsonValueKind.Object)
            {
                ApplyPiState(data);
            }
            else if (!response.Success)
            {
                PublishProviderError(MapResponseError(response.Error));
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            HandleCommandFailure(client, exception);
        }

        return GetStateSnapshot();
    }

    public async Task<IReadOnlyList<AgentMessageSnapshot>> GetMessagesAsync(
        CancellationToken cancellationToken)
    {
        var client = GetConnectedClient();
        if (client is null)
        {
            return GetMessageSnapshot();
        }

        try
        {
            var response = await client.SendAsync(
                "get_messages",
                arguments: null,
                cancellationToken).ConfigureAwait(false);
            if (!response.Success ||
                response.Data is not JsonElement data ||
                data.ValueKind != JsonValueKind.Object ||
                !data.TryGetProperty("messages", out var messages))
            {
                var error = MapResponseError(response.Error);
                PublishProviderError(error);
                return GetMessageSnapshot();
            }

            PiRpcEventPolicy.ValidateChatOnlyMessages(messages);
            return NormalizeMessageHistory(messages);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            HandleCommandFailure(client, exception);
            return GetMessageSnapshot();
        }
    }

    public async Task<AgentPromptResult> PromptAsync(
        string message,
        string clientMessageId,
        CancellationToken cancellationToken)
    {
        Task<AgentPromptResult>? duplicateTask = null;
        TaskCompletionSource<AgentPromptResult>? reservation = null;
        AgentPromptResult? admissionBusyResult = null;
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_promptResults.TryGetValue(clientMessageId, out var previous))
            {
                return previous;
            }

            if (_pendingPrompts.TryGetValue(clientMessageId, out var pending))
            {
                duplicateTask = pending.Task;
            }
            else if (!_options.IsConfigured)
            {
                return UnavailablePromptResult(clientMessageId);
            }
            else if (ShouldRejectPrompt(
                         _activeRun is not null,
                         _sessionChanging,
                         _abortInProgress,
                         reservationOwnedByAnotherPrompt: _promptReservationOwner is not null))
            {
                admissionBusyResult = BusyPromptResultLocked(clientMessageId);
                RememberPromptResultLocked(clientMessageId, admissionBusyResult);
            }
            else
            {
                reservation = new TaskCompletionSource<AgentPromptResult>(
                    TaskCreationOptions.RunContinuationsAsynchronously);
                _pendingPrompts.Add(clientMessageId, reservation);
                _promptReservationOwner = reservation;
            }
        }

        if (duplicateTask is not null)
        {
            return await duplicateTask.WaitAsync(cancellationToken).ConfigureAwait(false);
        }
        if (admissionBusyResult is not null)
        {
            return admissionBusyResult;
        }

        var ownedReservation = reservation!;
        IAgentRpcClient? client = null;
        ActiveRun? run = null;
        try
        {
            client = await EnsureClientAsync(cancellationToken).ConfigureAwait(false);
            if (client is null)
            {
                return CompletePromptReservation(
                    clientMessageId,
                    ownedReservation,
                    UnavailablePromptResult(clientMessageId));
            }

            AgentStateSnapshot? changedState;
            AgentPromptResult? busyResult = null;
            lock (_gate)
            {
                ObjectDisposedException.ThrowIf(_disposed, this);
                if (ShouldRejectPrompt(
                        _activeRun is not null,
                        _sessionChanging,
                        _abortInProgress,
                        reservationOwnedByAnotherPrompt:
                            !ReferenceEquals(_promptReservationOwner, ownedReservation)))
                {
                    var busyError = new AgentError(
                        "AGENT_BUSY",
                        "Pi Agent is already processing a request.",
                        Retryable: true);
                    busyResult = new AgentPromptResult(
                        Accepted: false,
                        clientMessageId,
                        RunId: null,
                        _state,
                        busyError);
                    changedState = null;
                }
                else
                {
                    run = new ActiveRun(
                        Guid.NewGuid().ToString("N"),
                        clientMessageId,
                        message);
                    _activeRun = run;
                    changedState = SetStateLocked(_state with
                    {
                        Connected = true,
                        Running = true,
                        Status = "running",
                        ActiveRunId = run.RunId,
                        Error = null
                    });
                }
            }

            if (busyResult is not null)
            {
                return CompletePromptReservation(
                    clientMessageId,
                    ownedReservation,
                    busyResult);
            }

            var activeRun = run ?? throw new InvalidOperationException(
                "Pi Agent prompt reservation did not create a run.");
            PublishState(changedState);
            PublishEvent(new AgentUiEvent("run-start", RunId: activeRun.RunId));
            PublishUserMessage(activeRun);
            _ = EnforceTurnTimeoutAsync(activeRun, client);

            var response = await client.SendAsync(
                "prompt",
                new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    ["message"] = message
                },
                cancellationToken).ConfigureAwait(false);
            if (!response.Success)
            {
                var error = MapResponseError(response.Error);
                CompleteRun(activeRun, "failed", error);
                var rejected = new AgentPromptResult(
                    Accepted: false,
                    clientMessageId,
                    activeRun.RunId,
                    GetStateSnapshot(),
                    error);
                return CompletePromptReservation(
                    clientMessageId,
                    ownedReservation,
                    rejected);
            }

            var accepted = new AgentPromptResult(
                Accepted: true,
                clientMessageId,
                activeRun.RunId,
                GetStateSnapshot(),
                Error: null);
            return CompletePromptReservation(
                clientMessageId,
                ownedReservation,
                accepted);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            if (run is not null && client is not null)
            {
                MarkAbortRequested(run);
                client.Terminate(new PiRpcFailure(
                    "CANCELLED",
                    "The Pi Agent request was cancelled."));
            }
            CancelPromptReservation(clientMessageId, ownedReservation, cancellationToken);
            throw;
        }
        catch (Exception exception)
        {
            var error = client is null
                ? new AgentError(
                    "PROVIDER_UNAVAILABLE",
                    "Pi Agent is unavailable.",
                    Retryable: true)
                : HandleCommandFailure(client, exception);
            if (run is not null)
            {
                CompleteRun(run, "failed", error);
            }
            var rejected = new AgentPromptResult(
                Accepted: false,
                clientMessageId,
                run?.RunId,
                GetStateSnapshot(),
                error);
            return CompletePromptReservation(
                clientMessageId,
                ownedReservation,
                rejected);
        }
    }

    public async Task<AgentCommandResult> AbortAsync(CancellationToken cancellationToken)
    {
        ActiveRun? run;
        IAgentRpcClient? client;
        AgentStateSnapshot? changedState = null;
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            run = _activeRun;
            client = _client;
            if (run is null || client is null || !client.IsConnected)
            {
                return new AgentCommandResult(true, _state);
            }
            if (_abortInProgress)
            {
                return new AgentCommandResult(true, _state);
            }

            _abortInProgress = true;
            run.AbortRequested = true;
            changedState = SetStateLocked(_state with { Status = "running" });
        }
        PublishState(changedState);

        try
        {
            var response = await client.SendAsync(
                "abort",
                arguments: null,
                cancellationToken).ConfigureAwait(false);
            if (!response.Success)
            {
                client.Terminate(new PiRpcFailure(
                    "CANCELLED",
                    "Pi Agent did not acknowledge cancellation."));
            }

            try
            {
                await run.Settled.Task
                    .WaitAsync(_options.AbortTimeout, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (TimeoutException)
            {
                client.Terminate(new PiRpcFailure(
                    "CANCELLED",
                    "Pi Agent cancellation exceeded its shutdown deadline."));
            }

            return new AgentCommandResult(true, GetStateSnapshot());
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            client.Terminate(new PiRpcFailure(
                "CANCELLED",
                "Pi Agent cancellation was interrupted by host shutdown."));
            throw;
        }
        catch (Exception exception)
        {
            _ = HandleCommandFailure(client, exception);
            return new AgentCommandResult(true, GetStateSnapshot());
        }
        finally
        {
            lock (_gate)
            {
                _abortInProgress = false;
            }
        }
    }

    public async Task<AgentCommandResult> NewSessionAsync(CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (!_options.IsConfigured)
            {
                return new AgentCommandResult(false, _state, _state.Error);
            }
            if (_activeRun is not null ||
                _sessionChanging ||
                _abortInProgress ||
                _pendingPrompts.Count != 0)
            {
                var busyError = new AgentError(
                    "AGENT_BUSY",
                    "Wait for the current Pi Agent operation to finish.",
                    Retryable: true);
                return new AgentCommandResult(false, _state, busyError);
            }
            _sessionChanging = true;
        }

        try
        {
            var client = GetConnectedClient();
            if (client is null)
            {
                AgentStateSnapshot? resetState;
                lock (_gate)
                {
                    ClearSessionMemoryLocked();
                    resetState = SetStateLocked(_state with
                    {
                        Connected = false,
                        Running = false,
                        Status = "ready",
                        SessionId = null,
                        ActiveRunId = null,
                        Error = null
                    });
                }
                PublishState(resetState);
                return new AgentCommandResult(true, GetStateSnapshot());
            }

            var response = await client.SendAsync(
                "new_session",
                arguments: null,
                cancellationToken).ConfigureAwait(false);
            if (!response.Success || IsCancelledSessionResponse(response.Data))
            {
                var error = MapResponseError(response.Error);
                PublishProviderError(error);
                return new AgentCommandResult(false, GetStateSnapshot(), error);
            }

            lock (_gate)
            {
                ClearSessionMemoryLocked();
            }
            return new AgentCommandResult(true, GetStateSnapshot());
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            var client = GetConnectedClient();
            var error = client is null
                ? new AgentError("PROVIDER_UNAVAILABLE", "Pi Agent is unavailable.", true)
                : HandleCommandFailure(client, exception);
            return new AgentCommandResult(false, GetStateSnapshot(), error);
        }
        finally
        {
            lock (_gate)
            {
                _sessionChanging = false;
            }
        }
    }

    private async Task EnforceTurnTimeoutAsync(ActiveRun run, IAgentRpcClient client)
    {
        try
        {
            await Task.Delay(_options.TurnTimeout, run.Deadline.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (run.Deadline.IsCancellationRequested)
        {
            return;
        }

        var error = new AgentError(
            "TURN_TIMEOUT",
            "Pi Agent exceeded the turn deadline.",
            Retryable: true);
        lock (_gate)
        {
            if (!ReferenceEquals(_activeRun, run) || _abortInProgress)
            {
                return;
            }

            _abortInProgress = true;
            run.TimedOut = true;
            run.AbortRequested = true;
            run.Error = error;
        }

        var failure = new PiRpcFailure(error.Code, error.Message, error.Retryable);
        try
        {
            using var abortDeadline = new CancellationTokenSource(_options.AbortTimeout);
            var response = await client.SendAsync(
                "abort",
                arguments: null,
                abortDeadline.Token).ConfigureAwait(false);
            if (!response.Success)
            {
                client.Terminate(failure);
                return;
            }

            try
            {
                await run.Settled.Task
                    .WaitAsync(_options.AbortTimeout)
                    .ConfigureAwait(false);
            }
            catch (TimeoutException)
            {
                client.Terminate(failure);
            }
        }
        catch (Exception exception) when (!IsFatalAgentException(exception))
        {
            HostLog.Warning(
                $"Pi Agent turn-timeout recovery failed closed after {exception.GetType().Name}.");
            client.Terminate(failure);
        }
        finally
        {
            lock (_gate)
            {
                _abortInProgress = false;
            }
        }
    }

    internal static bool IsFatalAgentException(Exception exception) =>
        exception is OutOfMemoryException or StackOverflowException or AccessViolationException;

    private async Task<IAgentRpcClient?> EnsureClientAsync(CancellationToken cancellationToken)
    {
        var current = GetConnectedClient();
        if (current is not null)
        {
            return current;
        }

        if (!_options.IsConfigured)
        {
            return null;
        }

        await _clientStartGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            current = GetConnectedClient();
            if (current is not null)
            {
                return current;
            }

            var client = _clientFactory();
            client.EventReceived += OnPiEvent;
            client.Faulted += OnClientFaulted;
            lock (_gate)
            {
                if (_disposed)
                {
                    client.Dispose();
                    return null;
                }
                _client = client;
            }

            try
            {
                client.Start();
            }
            catch (Exception exception)
            {
                HostLog.Warning($"Pi Agent could not start: {exception.GetType().Name}.");
                client.EventReceived -= OnPiEvent;
                client.Faulted -= OnClientFaulted;
                client.Dispose();
                AgentStateSnapshot? changed;
                lock (_gate)
                {
                    if (ReferenceEquals(_client, client))
                    {
                        _client = null;
                    }
                    changed = SetStateLocked(_state with
                    {
                        Connected = false,
                        Running = false,
                        Status = "ready",
                        ActiveRunId = null,
                        Error = new AgentError(
                            "PROVIDER_UNAVAILABLE",
                            "Pi Agent could not be started.",
                            Retryable: true)
                    });
                }
                PublishState(changed);
                return null;
            }

            AgentStateSnapshot? connectedState;
            lock (_gate)
            {
                if (!ReferenceEquals(_client, client) || !client.IsConnected)
                {
                    return null;
                }
                connectedState = SetStateLocked(_state with
                {
                    Connected = true,
                    Status = _activeRun is null ? "ready" : _state.Status,
                    Error = null
                });
            }
            PublishState(connectedState);
            return client;
        }
        finally
        {
            _clientStartGate.Release();
        }
    }

    private void ApplyPiState(JsonElement data)
    {
        var sessionId = data.TryGetProperty("sessionId", out var sessionElement) &&
                        sessionElement.ValueKind == JsonValueKind.String
            ? sessionElement.GetString()
            : null;
        var model = GetModelLabel(data);
        var isStreaming = data.TryGetProperty("isStreaming", out var streamingElement) &&
                          streamingElement.ValueKind == JsonValueKind.True;

        AgentStateSnapshot? changed;
        lock (_gate)
        {
            changed = SetStateLocked(_state with
            {
                Connected = true,
                Running = _activeRun is not null || isStreaming,
                Status = _activeRun?.AbortRequested == true
                    ? "running"
                    : _activeRun is not null || isStreaming
                        ? "running"
                        : "ready",
                SessionId = sessionId ?? _state.SessionId,
                Model = model ?? _state.Model,
                Error = null
            });
        }
        PublishState(changed);
    }

    private void OnPiEvent(IAgentRpcClient client, PiRpcEvent piEvent)
    {
        var root = piEvent.Payload;
        lock (_gate)
        {
            if (_disposed || !ReferenceEquals(_client, client))
            {
                return;
            }
        }

        PiRpcEventPolicy.ValidateChatOnlyEvent(root);
        var eventType = root.GetProperty("type").GetString()!;
        lock (_gate)
        {
            if (_disposed || !ReferenceEquals(_client, client))
            {
                return;
            }
            if (ShouldRejectEventWithoutActiveRun(eventType, _activeRun is not null))
            {
                throw new PiRpcProtocolException(
                    $"Pi RPC emitted run-bound event '{eventType}' without an active run.");
            }
            _activeRun?.TurnGuard.Observe(root, piEvent.PayloadCharacters);
        }

        switch (eventType)
        {
            case "message_start":
                CaptureMessageStart(root);
                break;
            case "message_update":
                PublishTextDelta(root);
                break;
            case "message_end":
                PublishCompletedMessage(root);
                break;
            case "extension_error":
                RecordRunError(new AgentError(
                    "PROVIDER_ERROR",
                    "Pi Agent reported an extension failure."));
                break;
            case "agent_settled":
                CompleteSettledRun();
                break;
        }
    }

    private void CaptureMessageStart(JsonElement root)
    {
        if (!root.TryGetProperty("message", out var message) ||
            message.ValueKind != JsonValueKind.Object ||
            !IsAssistantMessage(message))
        {
            return;
        }

        lock (_gate)
        {
            if (_activeRun is not null)
            {
                _activeRun.ActiveMessageId = GetMessageId(message) ?? CreateMessageId();
            }
        }
    }

    private void PublishTextDelta(JsonElement root)
    {
        if (!root.TryGetProperty("assistantMessageEvent", out var update) ||
            update.ValueKind != JsonValueKind.Object ||
            !update.TryGetProperty("type", out var typeElement) ||
            typeElement.ValueKind != JsonValueKind.String ||
            !typeElement.ValueEquals("text_delta") ||
            !update.TryGetProperty("delta", out var deltaElement) ||
            deltaElement.ValueKind != JsonValueKind.String)
        {
            return;
        }

        string? runId;
        string? messageId;
        lock (_gate)
        {
            if (_activeRun is null)
            {
                return;
            }
            _activeRun.ActiveMessageId ??= CreateMessageId();
            runId = _activeRun.RunId;
            messageId = _activeRun.ActiveMessageId;
        }

        PublishEvent(new AgentUiEvent(
            "text-delta",
            RunId: runId,
            MessageId: messageId,
            Delta: deltaElement.GetString()));
    }

    private void PublishCompletedMessage(JsonElement root)
    {
        if (!root.TryGetProperty("message", out var message) ||
            message.ValueKind != JsonValueKind.Object ||
            !IsAssistantMessage(message))
        {
            return;
        }

        string? runId;
        string messageId;
        string status;
        AgentError? error;
        lock (_gate)
        {
            if (_activeRun is null)
            {
                return;
            }

            runId = _activeRun.RunId;
            messageId = GetMessageId(message) ??
                        _activeRun.ActiveMessageId ??
                        CreateMessageId();
            status = ResolveMessageStatus(message, _activeRun.AbortRequested);
            error = status == "failed"
                ? MapMessageError(message)
                : null;
            if (error is not null)
            {
                _activeRun.Error = error;
            }
            _activeRun.ActiveMessageId = null;
        }

        var normalizedMessage = NormalizeMessage(
            message,
            messageId,
            clientMessageId: null,
            status);
        RememberMessage(normalizedMessage);
        PublishEvent(new AgentUiEvent(
            "message",
            RunId: runId,
            MessageId: messageId,
            Message: normalizedMessage));
        PublishEvent(new AgentUiEvent(
            "message-complete",
            RunId: runId,
            MessageId: messageId,
            Status: status,
            Error: error));
    }

    private void CompleteSettledRun()
    {
        ActiveRun? run;
        lock (_gate)
        {
            run = _activeRun;
        }
        if (run is null)
        {
            return;
        }

        var status = run.TimedOut
            ? "failed"
            : run.AbortRequested
                ? "cancelled"
            : run.Error is null
                ? "completed"
                : "failed";
        CompleteRun(run, status, run.Error);
    }

    private void CompleteRun(ActiveRun run, string status, AgentError? error)
    {
        AgentStateSnapshot? changedState;
        lock (_gate)
        {
            if (!ReferenceEquals(_activeRun, run))
            {
                return;
            }

            _activeRun = null;
            run.Deadline.Cancel();
            changedState = SetStateLocked(_state with
            {
                Running = false,
                Status = _options.IsConfigured ? "ready" : "unavailable",
                ActiveRunId = null,
                Error = error
            });
        }

        PublishEvent(new AgentUiEvent(
            "run-end",
            RunId: run.RunId,
            Status: status,
            Error: error));
        run.Settled.TrySetResult(status);
        PublishState(changedState);
    }

    private void OnClientFaulted(IAgentRpcClient client, PiRpcFailure failure)
    {
        ActiveRun? run;
        AgentStateSnapshot? changedState;
        AgentError error;
        AgentError? sessionResetError;
        lock (_gate)
        {
            if (!ReferenceEquals(_client, client))
            {
                return;
            }

            _client = null;
            run = _activeRun;
            error = MapFailure(failure);
            if (run?.TimedOut == true)
            {
                error = run.Error ?? new AgentError(
                    "TURN_TIMEOUT",
                    "Pi Agent exceeded the turn deadline.",
                    Retryable: true);
            }
            else if (run?.AbortRequested == true)
            {
                error = new AgentError("CANCELLED", "The Pi Agent request was cancelled.");
            }
            sessionResetError = run?.AbortRequested == true && run?.TimedOut != true
                ? null
                : error;
            ClearMessageHistoryLocked();
            changedState = SetStateLocked(CreateClientFaultState(
                _state,
                run is not null,
                run?.RunId,
                sessionResetError));
        }

        if (run is not null)
        {
            CompleteRun(
                run,
                run.TimedOut ? "failed" : run.AbortRequested ? "cancelled" : "failed",
                run.AbortRequested && !run.TimedOut ? null : error);
        }
        else
        {
            PublishState(changedState);
        }
        PublishEvent(new AgentUiEvent(
            "session-reset",
            Status: sessionResetError is null ? "cancelled" : "failed",
            Error: sessionResetError));

        client.EventReceived -= OnPiEvent;
        client.Faulted -= OnClientFaulted;
        client.Dispose();
    }

    private AgentError HandleCommandFailure(IAgentRpcClient client, Exception exception)
    {
        var failure = exception switch
        {
            PiRpcCommandException commandException => new PiRpcFailure(
                commandException.Code,
                commandException.Message,
                commandException.Retryable),
            PiRpcOutputLimitException => new PiRpcFailure(
                "OUTPUT_LIMIT_EXCEEDED",
                "Pi Agent exceeded the output limit for one turn.",
                Retryable: true),
            PiRpcProtocolException => new PiRpcFailure(
                "PROTOCOL_ERROR",
                "Pi Agent returned an invalid chat-only RPC stream."),
            _ => new PiRpcFailure(
                "PROVIDER_UNAVAILABLE",
                "Pi Agent command failed.",
                Retryable: true)
        };
        client.Terminate(failure);
        return MapFailure(failure);
    }

    private void PublishProviderError(AgentError error)
    {
        AgentStateSnapshot? changed;
        lock (_gate)
        {
            changed = SetStateLocked(_state with { Error = error });
        }
        PublishState(changed);
    }

    private void RecordRunError(AgentError error)
    {
        lock (_gate)
        {
            if (_activeRun is not null)
            {
                _activeRun.Error = error;
            }
        }
    }

    private void MarkAbortRequested(ActiveRun run)
    {
        lock (_gate)
        {
            if (ReferenceEquals(_activeRun, run))
            {
                run.AbortRequested = true;
            }
        }
    }

    private void PublishUserMessage(ActiveRun run)
    {
        var message = new AgentMessageSnapshot(
            run.ClientMessageId,
            "user",
            run.Message,
            "complete",
            DateTimeOffset.UtcNow.ToString("O"),
            run.ClientMessageId);
        RememberMessage(message);
        PublishEvent(new AgentUiEvent(
            "message",
            RunId: run.RunId,
            MessageId: run.ClientMessageId,
            Message: message));
        PublishEvent(new AgentUiEvent(
            "message-complete",
            RunId: run.RunId,
            MessageId: run.ClientMessageId,
            Status: "completed"));
    }

    private AgentPromptResult UnavailablePromptResult(string clientMessageId)
    {
        var state = GetStateSnapshot();
        var error = state.Error ?? new AgentError(
            "PROVIDER_UNAVAILABLE",
            "Pi Agent is unavailable.",
            Retryable: true);
        return new AgentPromptResult(
            Accepted: false,
            clientMessageId,
            RunId: null,
            state,
            error);
    }

    private AgentPromptResult BusyPromptResultLocked(string clientMessageId)
    {
        var error = new AgentError(
            "AGENT_BUSY",
            "Pi Agent is already processing a request.",
            Retryable: true);
        return new AgentPromptResult(
            Accepted: false,
            clientMessageId,
            RunId: null,
            _state,
            error);
    }

    private AgentPromptResult CompletePromptReservation(
        string clientMessageId,
        TaskCompletionSource<AgentPromptResult> reservation,
        AgentPromptResult result)
    {
        RememberPromptResult(clientMessageId, result);
        lock (_gate)
        {
            if (_pendingPrompts.TryGetValue(clientMessageId, out var current) &&
                ReferenceEquals(current, reservation))
            {
                _pendingPrompts.Remove(clientMessageId);
            }
            if (ReferenceEquals(_promptReservationOwner, reservation))
            {
                _promptReservationOwner = null;
            }
        }
        reservation.TrySetResult(result);
        return result;
    }

    private void CancelPromptReservation(
        string clientMessageId,
        TaskCompletionSource<AgentPromptResult> reservation,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (_pendingPrompts.TryGetValue(clientMessageId, out var current) &&
                ReferenceEquals(current, reservation))
            {
                _pendingPrompts.Remove(clientMessageId);
            }
            if (ReferenceEquals(_promptReservationOwner, reservation))
            {
                _promptReservationOwner = null;
            }
        }
        reservation.TrySetCanceled(cancellationToken);
    }

    private void RememberPromptResult(string clientMessageId, AgentPromptResult result)
    {
        lock (_gate)
        {
            RememberPromptResultLocked(clientMessageId, result);
        }
    }

    private void RememberPromptResultLocked(string clientMessageId, AgentPromptResult result)
    {
        if (_promptResults.ContainsKey(clientMessageId))
        {
            _promptResults[clientMessageId] = result;
            return;
        }

        _promptResults.Add(clientMessageId, result);
        _promptResultOrder.Enqueue(clientMessageId);
        while (_promptResultOrder.Count > MaximumRememberedPrompts)
        {
            _promptResults.Remove(_promptResultOrder.Dequeue());
        }
    }

    private void ClearSessionMemoryLocked()
    {
        _promptResults.Clear();
        _promptResultOrder.Clear();
        ClearMessageHistoryLocked();
    }

    private void ClearMessageHistoryLocked()
    {
        _messages.Clear();
        _rememberedMessageCharacters = 0;
    }

    private IReadOnlyList<AgentMessageSnapshot> NormalizeMessageHistory(JsonElement messages)
    {
        AgentMessageSnapshot[] existing;
        lock (_gate)
        {
            existing = _messages.ToArray();
        }

        var usedIds = new HashSet<string>(StringComparer.Ordinal);
        var normalized = new List<AgentMessageSnapshot>(messages.GetArrayLength());
        var index = 0;
        foreach (var rawMessage in messages.EnumerateArray())
        {
            if (rawMessage.ValueKind != JsonValueKind.Object)
            {
                index++;
                continue;
            }

            var role = GetMessageRole(rawMessage);
            var text = GetMessageText(rawMessage);
            var previous = existing.FirstOrDefault(candidate =>
                !usedIds.Contains(candidate.Id) &&
                candidate.Role.Equals(role, StringComparison.Ordinal) &&
                candidate.Text.Equals(text, StringComparison.Ordinal));
            var id = GetMessageId(rawMessage) ??
                     previous?.Id ??
                     $"pi-history-{index}-{Guid.NewGuid():N}";
            usedIds.Add(id);
            normalized.Add(NormalizeMessage(
                rawMessage,
                id,
                previous?.ClientMessageId,
                NormalizeCompletedStatus(ResolveMessageStatus(rawMessage, abortRequested: false))));
            index++;
        }

        lock (_gate)
        {
            _messages.Clear();
            _rememberedMessageCharacters = 0;
            foreach (var message in normalized)
            {
                RememberMessageLocked(message);
            }
            return _messages.ToArray();
        }
    }

    private IReadOnlyList<AgentMessageSnapshot> GetMessageSnapshot()
    {
        lock (_gate)
        {
            return _messages.ToArray();
        }
    }

    private void RememberMessage(AgentMessageSnapshot message)
    {
        lock (_gate)
        {
            RememberMessageLocked(message);
        }
    }

    private void RememberMessageLocked(AgentMessageSnapshot message)
    {
        var index = _messages.FindIndex(candidate =>
            candidate.Id.Equals(message.Id, StringComparison.Ordinal));
        if (index >= 0)
        {
            _rememberedMessageCharacters -= _messages[index].Text.Length;
            _messages[index] = message;
        }
        else
        {
            _messages.Add(message);
        }
        _rememberedMessageCharacters += message.Text.Length;

        while (_messages.Count > MaximumRememberedMessages ||
               _rememberedMessageCharacters > MaximumRememberedMessageCharacters)
        {
            _rememberedMessageCharacters -= _messages[0].Text.Length;
            _messages.RemoveAt(0);
        }
    }

    private static AgentMessageSnapshot NormalizeMessage(
        JsonElement message,
        string messageId,
        string? clientMessageId,
        string status) =>
        new(
            messageId,
            GetMessageRole(message),
            GetMessageText(message),
            status,
            GetMessageCreatedAt(message),
            clientMessageId);

    private static string GetMessageRole(JsonElement message)
    {
        if (!message.TryGetProperty("role", out var roleElement) ||
            roleElement.ValueKind != JsonValueKind.String)
        {
            return "assistant";
        }

        return roleElement.GetString()?.ToLowerInvariant() switch
        {
            "user" => "user",
            "assistant" => "assistant",
            "system" => "system",
            _ => "assistant"
        };
    }

    private static string GetMessageText(JsonElement message)
    {
        if (message.TryGetProperty("text", out var textElement) &&
            textElement.ValueKind == JsonValueKind.String)
        {
            return RequireBoundedMessageText(textElement.GetString());
        }

        if (!message.TryGetProperty("content", out var content))
        {
            return string.Empty;
        }
        if (content.ValueKind == JsonValueKind.String)
        {
            return RequireBoundedMessageText(content.GetString());
        }
        if (content.ValueKind != JsonValueKind.Array)
        {
            return string.Empty;
        }

        var text = new StringBuilder();
        foreach (var block in content.EnumerateArray())
        {
            if (block.ValueKind != JsonValueKind.Object ||
                !block.TryGetProperty("type", out var typeElement) ||
                typeElement.ValueKind != JsonValueKind.String ||
                !typeElement.ValueEquals("text") ||
                !block.TryGetProperty("text", out var blockText) ||
                blockText.ValueKind != JsonValueKind.String)
            {
                continue;
            }
            var part = blockText.GetString() ?? string.Empty;
            if (part.Length > MaximumMessageCharacters - text.Length)
            {
                throw new PiRpcOutputLimitException(
                    "Pi RPC emitted a message larger than the chat history limit.");
            }
            text.Append(part);
        }
        return text.ToString();
    }

    private static string RequireBoundedMessageText(string? value)
    {
        var text = value ?? string.Empty;
        if (text.Length > MaximumMessageCharacters)
        {
            throw new PiRpcOutputLimitException(
                "Pi RPC emitted a message larger than the chat history limit.");
        }
        return text;
    }

    private static string? GetMessageCreatedAt(JsonElement message)
    {
        if (!message.TryGetProperty("timestamp", out var timestamp))
        {
            return null;
        }
        if (timestamp.ValueKind == JsonValueKind.String)
        {
            return timestamp.GetString();
        }
        if (timestamp.ValueKind == JsonValueKind.Number && timestamp.TryGetInt64(out var milliseconds))
        {
            try
            {
                return DateTimeOffset.FromUnixTimeMilliseconds(milliseconds).ToString("O");
            }
            catch (ArgumentOutOfRangeException)
            {
                return null;
            }
        }
        return null;
    }

    private static string NormalizeCompletedStatus(string status) => status switch
    {
        "completed" => "complete",
        "cancelled" => "cancelled",
        "failed" => "failed",
        _ => status
    };

    private static string? GetModelLabel(JsonElement state)
    {
        if (!state.TryGetProperty("model", out var model))
        {
            return null;
        }
        if (model.ValueKind == JsonValueKind.String)
        {
            return model.GetString();
        }
        if (model.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (var propertyName in new[] { "name", "id" })
        {
            if (model.TryGetProperty(propertyName, out var value) &&
                value.ValueKind == JsonValueKind.String &&
                !string.IsNullOrWhiteSpace(value.GetString()))
            {
                return value.GetString();
            }
        }
        return null;
    }

    private IAgentRpcClient? GetConnectedClient()
    {
        lock (_gate)
        {
            return !_disposed && _client is { IsConnected: true }
                ? _client
                : null;
        }
    }

    private AgentStateSnapshot? SetStateLocked(AgentStateSnapshot state)
    {
        if (_state == state)
        {
            return null;
        }
        _state = state;
        return state;
    }

    internal static AgentStateSnapshot CreateClientFaultState(
        AgentStateSnapshot state,
        bool running,
        string? activeRunId,
        AgentError? error) =>
        state with
        {
            Connected = false,
            Running = running,
            Status = state.Configured ? "ready" : "unavailable",
            SessionId = null,
            ActiveRunId = activeRunId,
            Error = error
        };

    private void PublishState(AgentStateSnapshot? state)
    {
        if (state is null)
        {
            return;
        }

        try
        {
            StateChanged?.Invoke(state);
        }
        catch (Exception exception)
        {
            HostLog.Warning($"Agent state subscriber failed: {exception.GetType().Name}.");
        }
    }

    private void PublishEvent(AgentUiEvent value)
    {
        lock (_eventGate)
        {
            if (value.RunId is { } runId)
            {
                if (_terminalRuns.Contains(runId))
                {
                    return;
                }

                var sequence = _eventSequences.TryGetValue(runId, out var previous)
                    ? checked(previous + 1)
                    : 1;
                _eventSequences[runId] = sequence;
                value = value with { Sequence = sequence };

                if (value.Kind.Equals("run-end", StringComparison.Ordinal))
                {
                    _eventSequences.Remove(runId);
                    _terminalRuns.Add(runId);
                    _terminalRunOrder.Enqueue(runId);
                    while (_terminalRunOrder.Count > MaximumRememberedTerminalRuns)
                    {
                        _terminalRuns.Remove(_terminalRunOrder.Dequeue());
                    }
                }
            }

            _pendingEvents.Enqueue(value);
            if (_publishingEvents)
            {
                return;
            }
            _publishingEvents = true;
        }

        while (true)
        {
            AgentUiEvent next;
            lock (_eventGate)
            {
                if (_pendingEvents.Count == 0)
                {
                    _publishingEvents = false;
                    return;
                }
                next = _pendingEvents.Dequeue();
            }

            try
            {
                EventReceived?.Invoke(next);
            }
            catch (Exception exception)
            {
                HostLog.Warning($"Agent event subscriber failed: {exception.GetType().Name}.");
            }
        }
    }

    private static string? GetMessageId(JsonElement message)
    {
        if (!message.TryGetProperty("id", out var idElement) ||
            idElement.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        var value = idElement.GetString();
        return string.IsNullOrWhiteSpace(value) || value.Length > 160
            ? null
            : value;
    }

    private static string CreateMessageId() => $"pi-message-{Guid.NewGuid():N}";

    internal static bool ShouldRejectPrompt(
        bool hasActiveRun,
        bool sessionChanging,
        bool abortInProgress,
        bool reservationOwnedByAnotherPrompt) =>
        hasActiveRun ||
        sessionChanging ||
        abortInProgress ||
        reservationOwnedByAnotherPrompt;

    internal static bool ShouldRejectEventWithoutActiveRun(
        string eventType,
        bool hasActiveRun) =>
        !hasActiveRun && eventType is
            "agent_start" or
            "agent_end" or
            "agent_settled" or
            "turn_start" or
            "turn_end" or
            "message_start" or
            "message_update" or
            "message_end" or
            "queue_update" or
            "compaction_start" or
            "compaction_end" or
            "auto_retry_start" or
            "auto_retry_end" or
            "summarization_retry_scheduled" or
            "summarization_retry_attempt_start" or
            "summarization_retry_finished" or
            "extension_error";

    private static bool IsAssistantMessage(JsonElement message) =>
        message.TryGetProperty("role", out var roleElement) &&
        roleElement.ValueKind == JsonValueKind.String &&
        roleElement.ValueEquals("assistant");

    private static string ResolveMessageStatus(JsonElement message, bool abortRequested)
    {
        if (abortRequested)
        {
            return "cancelled";
        }

        if (message.TryGetProperty("errorMessage", out var errorElement) &&
            errorElement.ValueKind == JsonValueKind.String &&
            !string.IsNullOrWhiteSpace(errorElement.GetString()))
        {
            return "failed";
        }

        if (message.TryGetProperty("stopReason", out var stopElement) &&
            stopElement.ValueKind == JsonValueKind.String)
        {
            var stopReason = stopElement.GetString();
            if (stopReason is "error")
            {
                return "failed";
            }
            if (stopReason is "aborted" or "cancelled")
            {
                return "cancelled";
            }
        }

        return "completed";
    }

    private static AgentError MapMessageError(JsonElement message)
    {
        var detail = message.TryGetProperty("errorMessage", out var errorElement) &&
                     errorElement.ValueKind == JsonValueKind.String
            ? errorElement.GetString()
            : null;
        return MapResponseError(detail);
    }

    internal static AgentError MapResponseError(string? detail)
    {
        var normalized = detail?.ToLowerInvariant() ?? string.Empty;
        if (normalized.Contains("api key", StringComparison.Ordinal) ||
            normalized.Contains("unauthorized", StringComparison.Ordinal) ||
            normalized.Contains("authentication", StringComparison.Ordinal) ||
            normalized.Contains("credential", StringComparison.Ordinal) ||
            normalized.Contains("login", StringComparison.Ordinal) ||
            normalized.Contains("oauth", StringComparison.Ordinal) ||
            normalized.Contains("refresh token", StringComparison.Ordinal))
        {
            return new AgentError(
                "AUTH_REQUIRED",
                "Pi Agent authentication is required.");
        }
        if (normalized.Contains("rate limit", StringComparison.Ordinal) ||
            normalized.Contains("too many requests", StringComparison.Ordinal))
        {
            return new AgentError(
                "RATE_LIMITED",
                "Pi Agent is currently rate limited.",
                Retryable: true);
        }
        if (normalized.Contains("model not found", StringComparison.Ordinal) ||
            normalized.Contains("no model", StringComparison.Ordinal) ||
            normalized.Contains("model required", StringComparison.Ordinal) ||
            normalized.Contains("unsupported model", StringComparison.Ordinal))
        {
            return new AgentError(
                "MODEL_REQUIRED",
                "Pi Agent requires a supported model configuration.");
        }
        if (normalized.Contains("network", StringComparison.Ordinal) ||
            normalized.Contains("fetch failed", StringComparison.Ordinal) ||
            normalized.Contains("enotfound", StringComparison.Ordinal) ||
            normalized.Contains("econnrefused", StringComparison.Ordinal) ||
            normalized.Contains("dns", StringComparison.Ordinal) ||
            normalized.Contains("socket", StringComparison.Ordinal))
        {
            return new AgentError(
                "NETWORK_UNAVAILABLE",
                "Pi Agent could not reach its model provider.",
                Retryable: true);
        }
        if (normalized.Contains("quota", StringComparison.Ordinal) ||
            normalized.Contains("insufficient credits", StringComparison.Ordinal))
        {
            return new AgentError(
                "QUOTA_EXCEEDED",
                "Pi Agent provider quota is exhausted.");
        }
        if (normalized.Contains("streaming", StringComparison.Ordinal) ||
            normalized.Contains("already running", StringComparison.Ordinal))
        {
            return new AgentError(
                "AGENT_BUSY",
                "Pi Agent is already processing a request.",
                Retryable: true);
        }

        return new AgentError(
            "PROVIDER_ERROR",
            "Pi Agent could not complete the request.",
            Retryable: true);
    }

    private static AgentError MapFailure(PiRpcFailure failure) =>
        new(failure.Code, failure.Message, failure.Retryable);

    private static bool IsCancelledSessionResponse(JsonElement? data) =>
        data is JsonElement value &&
        value.ValueKind == JsonValueKind.Object &&
        value.TryGetProperty("cancelled", out var cancelledElement) &&
        cancelledElement.ValueKind == JsonValueKind.True;

    public void Dispose()
    {
        IAgentRpcClient? client;
        ActiveRun? run;
        TaskCompletionSource<AgentPromptResult>[] pendingPrompts;
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            client = _client;
            _client = null;
            run = _activeRun;
            _activeRun = null;
            pendingPrompts = _pendingPrompts.Values.ToArray();
            _pendingPrompts.Clear();
            _promptReservationOwner = null;
        }

        if (client is not null)
        {
            client.EventReceived -= OnPiEvent;
            client.Faulted -= OnClientFaulted;
            client.Dispose();
        }
        run?.Deadline.Cancel();
        run?.Settled.TrySetResult("cancelled");
        foreach (var pending in pendingPrompts)
        {
            pending.TrySetCanceled();
        }
    }

    private sealed class ActiveRun
    {
        public ActiveRun(string runId, string clientMessageId, string message)
        {
            RunId = runId;
            ClientMessageId = clientMessageId;
            Message = message;
            TurnGuard = new AgentTurnGuard(
                MaximumTurnEventCount,
                MaximumTurnOutputCharacters,
                MaximumTurnPayloadCharacters);
        }

        public string RunId { get; }

        public string ClientMessageId { get; }

        public string Message { get; }

        public TaskCompletionSource<string> Settled { get; } = new(
            TaskCreationOptions.RunContinuationsAsynchronously);

        public CancellationTokenSource Deadline { get; } = new();

        public AgentTurnGuard TurnGuard { get; }

        public string? ActiveMessageId { get; set; }

        public AgentError? Error { get; set; }

        public bool AbortRequested { get; set; }

        public bool TimedOut { get; set; }
    }
}

internal interface IAgentRpcClient : IDisposable
{
    event Action<IAgentRpcClient, PiRpcEvent>? EventReceived;

    event Action<IAgentRpcClient, PiRpcFailure>? Faulted;

    bool IsConnected { get; }

    void Start();

    Task<PiRpcResponse> SendAsync(
        string command,
        IReadOnlyDictionary<string, object?>? arguments,
        CancellationToken cancellationToken);

    void Terminate(PiRpcFailure failure);
}

internal sealed class PiAgentRpcClient : IAgentRpcClient
{
    private readonly PiRpcClient _inner;

    public PiAgentRpcClient(PiAgentOptions options)
    {
        _inner = new PiRpcClient(options);
        _inner.EventReceived += OnEventReceived;
        _inner.Faulted += OnFaulted;
    }

    public event Action<IAgentRpcClient, PiRpcEvent>? EventReceived;

    public event Action<IAgentRpcClient, PiRpcFailure>? Faulted;

    public bool IsConnected => _inner.IsConnected;

    public void Start() => _inner.Start();

    public Task<PiRpcResponse> SendAsync(
        string command,
        IReadOnlyDictionary<string, object?>? arguments,
        CancellationToken cancellationToken) =>
        _inner.SendAsync(command, arguments, cancellationToken);

    public void Terminate(PiRpcFailure failure) => _inner.Terminate(failure);

    public void Dispose()
    {
        _inner.EventReceived -= OnEventReceived;
        _inner.Faulted -= OnFaulted;
        _inner.Dispose();
    }

    private void OnEventReceived(PiRpcClient _, PiRpcEvent value) =>
        EventReceived?.Invoke(this, value);

    private void OnFaulted(PiRpcClient _, PiRpcFailure failure) =>
        Faulted?.Invoke(this, failure);
}
