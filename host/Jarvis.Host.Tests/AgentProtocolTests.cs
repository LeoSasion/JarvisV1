using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Jarvis.Host.Agents;

namespace Jarvis.Host.Tests;

public sealed class AgentProtocolTests
{
    [Fact]
    public void JsonLineDecoderUsesOnlyLfAsRecordDelimiter()
    {
        var decoder = new StrictLfJsonLineDecoder(1024);
        var payload = Encoding.UTF8.GetBytes(
            "{\"type\":\"message_update\",\"delta\":\"one\u2028two\"}\r\n");

        var lines = decoder.Push(payload);

        var line = Assert.Single(lines);
        Assert.Contains("one\u2028two", line, StringComparison.Ordinal);
        Assert.DoesNotContain('\r', line);
        decoder.Complete();
    }

    [Fact]
    public void JsonLineDecoderPreservesRecordsSplitAcrossReads()
    {
        var decoder = new StrictLfJsonLineDecoder(1024);

        Assert.Empty(decoder.Push(Encoding.UTF8.GetBytes("{\"type\":")));
        var lines = decoder.Push(Encoding.UTF8.GetBytes("\"agent_settled\"}\n"));

        Assert.Equal("{\"type\":\"agent_settled\"}", Assert.Single(lines));
        decoder.Complete();
    }

    [Fact]
    public void JsonLineDecoderRejectsOversizedAndUnterminatedRecords()
    {
        var oversized = new StrictLfJsonLineDecoder(4);
        Assert.Throws<PiRpcProtocolException>(() =>
            oversized.Push(Encoding.UTF8.GetBytes("12345")));

        var unterminated = new StrictLfJsonLineDecoder(32);
        Assert.Empty(unterminated.Push(Encoding.UTF8.GetBytes("{}")));
        Assert.Throws<PiRpcProtocolException>(unterminated.Complete);
    }

    [Theory]
    [InlineData("tool_execution_start")]
    [InlineData("tool_execution_update")]
    [InlineData("tool_execution_end")]
    [InlineData("tool")]
    [InlineData("toolcall_start")]
    [InlineData("bash_execution_update")]
    [InlineData("extension_ui_request")]
    public void ChatOnlyPolicyRejectsExecutableEvents(string eventType)
    {
        using var document = JsonDocument.Parse($"{{\"type\":\"{eventType}\"}}");

        Assert.Throws<PiRpcProtocolException>(() =>
            PiRpcEventPolicy.ValidateChatOnlyEvent(document.RootElement));
    }

    [Fact]
    public void ChatOnlyPolicyRejectsToolCallDeltas()
    {
        using var document = JsonDocument.Parse(
            """
            {
              "type": "message_update",
              "assistantMessageEvent": { "type": "toolcall_delta", "delta": "{}" }
            }
            """);

        Assert.Throws<PiRpcProtocolException>(() =>
            PiRpcEventPolicy.ValidateChatOnlyEvent(document.RootElement));
    }

    [Fact]
    public void ChatOnlyPolicyRejectsToolRoleMessages()
    {
        using var document = JsonDocument.Parse(
            """
            {
              "type": "message_end",
              "message": { "role": "tool", "content": [] }
            }
            """);

        Assert.Throws<PiRpcProtocolException>(() =>
            PiRpcEventPolicy.ValidateChatOnlyEvent(document.RootElement));
    }

    [Fact]
    public void ChatOnlyPolicyAcceptsTextDeltas()
    {
        using var document = JsonDocument.Parse(
            """
            {
              "type": "message_update",
              "assistantMessageEvent": { "type": "text_delta", "delta": "hello" }
            }
            """);

        PiRpcEventPolicy.ValidateChatOnlyEvent(document.RootElement);
    }

    [Fact]
    public void TurnGuardAcceptsOrderedAssistantStream()
    {
        var guard = new AgentTurnGuard(8, 32, 1024);

        Observe(guard, """{"type":"message_start","message":{"role":"assistant"}}""");
        Observe(guard, """{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"hello"}}""");
        Observe(guard, """{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}""");
        Observe(guard, """{"type":"agent_settled"}""");
    }

    [Fact]
    public void TurnGuardRejectsOutOfSequenceAssistantUpdate()
    {
        var guard = new AgentTurnGuard(8, 32, 1024);

        Assert.Throws<PiRpcProtocolException>(() => Observe(
            guard,
            """{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"hello"}}"""));
    }

    [Fact]
    public void TurnGuardRejectsCumulativeOutputAndEventFloods()
    {
        var outputGuard = new AgentTurnGuard(8, 4, 1024);
        Observe(outputGuard, """{"type":"message_start","message":{"role":"assistant"}}""");
        Assert.Throws<PiRpcOutputLimitException>(() => Observe(
            outputGuard,
            """{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"hello"}}"""));

        var eventGuard = new AgentTurnGuard(1, 32, 1024);
        Observe(eventGuard, """{"type":"agent_start"}""");
        Assert.Throws<PiRpcOutputLimitException>(() => Observe(
            eventGuard,
            """{"type":"agent_start"}"""));
    }

    [Fact]
    public void TurnGuardCountsDeltasInsteadOfRepeatedCumulativeSnapshots()
    {
        var guard = new AgentTurnGuard(8, 5, 1024);
        Observe(guard, """{"type":"message_start","message":{"role":"assistant"}}""");
        for (var index = 1; index <= 5; index++)
        {
            var cumulative = new string('a', index);
            Observe(
                guard,
                JsonSerializer.Serialize(new
                {
                    type = "message_update",
                    message = new { role = "assistant", text = cumulative },
                    assistantMessageEvent = new { type = "text_delta", delta = "a" },
                }));
        }
        Observe(
            guard,
            """{"type":"message_end","message":{"role":"assistant","text":"aaaaa"}}""");
        Observe(guard, """{"type":"agent_settled"}""");
    }

    [Fact]
    public void TurnGuardRejectsDuplicateTerminalEvent()
    {
        var guard = new AgentTurnGuard(8, 32, 1024);
        Observe(guard, """{"type":"agent_settled"}""");

        Assert.Throws<PiRpcProtocolException>(() => Observe(
            guard,
            """{"type":"agent_settled"}"""));
    }

    [Fact]
    public void TurnGuardBoundsRepeatedCumulativePayloads()
    {
        var guard = new AgentTurnGuard(8, 32, 150);
        Observe(guard, """{"type":"message_start","message":{"role":"assistant"}}""");

        Assert.Throws<PiRpcOutputLimitException>(() => Observe(
            guard,
            """{"type":"message_update","message":{"role":"assistant","text":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"assistantMessageEvent":{"type":"text_delta","delta":"a"}}"""));
    }

    [Theory]
    [InlineData(false, false, false, false, false)]
    [InlineData(true, false, false, false, true)]
    [InlineData(false, true, false, false, true)]
    [InlineData(false, false, true, false, true)]
    [InlineData(false, false, false, true, true)]
    public void PromptAdmissionWaitsForThePreviousRpcReservation(
        bool hasActiveRun,
        bool sessionChanging,
        bool abortInProgress,
        bool reservationOwnedByAnotherPrompt,
        bool expected)
    {
        Assert.Equal(
            expected,
            AgentCoordinator.ShouldRejectPrompt(
                hasActiveRun,
                sessionChanging,
                abortInProgress,
                reservationOwnedByAnotherPrompt));
    }

    [Fact]
    public async Task PromptAdmissionLetsTheFirstConcurrentCallerOwnTheReservation()
    {
        var client = new ControllableAgentRpcClient();
        using var coordinator = new AgentCoordinator(
            CreateConfiguredAgentOptions(),
            () => client);

        var firstPrompt = Task.Run(() => coordinator.PromptAsync(
            "first request",
            "first-client-message",
            CancellationToken.None));
        await client.StartEntered.WaitAsync(TimeSpan.FromSeconds(5));

        var secondPromptTask = coordinator.PromptAsync(
            "second request",
            "second-client-message",
            CancellationToken.None);

        Assert.True(
            secondPromptTask.IsCompletedSuccessfully,
            "The later prompt must not wait behind the first prompt's client-start reservation.");
        var secondPrompt = await secondPromptTask;

        Assert.False(secondPrompt.Accepted);
        Assert.Null(secondPrompt.RunId);
        Assert.Equal("AGENT_BUSY", secondPrompt.Error?.Code);
        Assert.True(secondPrompt.Error?.Retryable);

        client.ReleaseStart();
        await client.PromptStarted.WaitAsync(TimeSpan.FromSeconds(5));
        client.CompletePrompt();
        var firstResult = await firstPrompt.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.True(firstResult.Accepted);
        Assert.NotNull(firstResult.RunId);
        Assert.Null(firstResult.Error);
        Assert.Equal(1, client.PromptCount);
    }

    [Theory]
    [InlineData("agent_start", false, true)]
    [InlineData("agent_end", false, true)]
    [InlineData("agent_settled", false, true)]
    [InlineData("turn_start", false, true)]
    [InlineData("turn_end", false, true)]
    [InlineData("message_start", false, true)]
    [InlineData("message_update", false, true)]
    [InlineData("message_end", false, true)]
    [InlineData("queue_update", false, true)]
    [InlineData("compaction_start", false, true)]
    [InlineData("auto_retry_start", false, true)]
    [InlineData("summarization_retry_finished", false, true)]
    [InlineData("extension_error", false, true)]
    [InlineData("message_update", true, false)]
    [InlineData("session_changed", false, false)]
    [InlineData("model_changed", false, false)]
    public void RunBoundEventsRequireAnActiveRun(
        string eventType,
        bool hasActiveRun,
        bool expectedRejection)
    {
        Assert.Equal(
            expectedRejection,
            AgentCoordinator.ShouldRejectEventWithoutActiveRun(eventType, hasActiveRun));
    }

    [Fact]
    public void ClientFaultStateInvalidatesTheEphemeralSession()
    {
        var previous = new AgentStateSnapshot(
            Provider: "pi",
            Model: "test-model",
            PermissionMode: "chat-only",
            Available: true,
            Configured: true,
            Connected: true,
            Running: true,
            Status: "running",
            SessionId: "old-session",
            ActiveRunId: "old-run",
            Error: null);
        var failure = new AgentError("PROVIDER_CRASHED", "Pi Agent exited.", true);

        var reset = AgentCoordinator.CreateClientFaultState(
            previous,
            running: false,
            activeRunId: null,
            error: failure);

        Assert.False(reset.Connected);
        Assert.False(reset.Running);
        Assert.Equal("ready", reset.Status);
        Assert.Null(reset.SessionId);
        Assert.Null(reset.ActiveRunId);
        Assert.Same(failure, reset.Error);
        Assert.Equal(previous.Model, reset.Model);
    }

    [Fact]
    public void TurnTimeoutRecoveryTreatsIoFailuresAsNonFatal()
    {
        Assert.False(AgentCoordinator.IsFatalAgentException(new IOException("broken pipe")));
        Assert.False(AgentCoordinator.IsFatalAgentException(new InvalidOperationException()));
        Assert.True(AgentCoordinator.IsFatalAgentException(new OutOfMemoryException()));
        Assert.True(AgentCoordinator.IsFatalAgentException(new AccessViolationException()));
    }

    [Fact]
    public void PiBackgroundObserversFailClosedForOrdinaryExceptions()
    {
        Assert.False(PiRpcClient.IsFatalBackgroundException(new IOException("broken pipe")));
        Assert.False(PiRpcClient.IsFatalBackgroundException(new InvalidOperationException()));
        Assert.True(PiRpcClient.IsFatalBackgroundException(new OutOfMemoryException()));
        Assert.True(PiRpcClient.IsFatalBackgroundException(new AccessViolationException()));
    }

    [Theory]
    [InlineData("OAuth login requires a refresh token", "AUTH_REQUIRED", false)]
    [InlineData("credential rejected", "AUTH_REQUIRED", false)]
    [InlineData("rate limit exceeded", "RATE_LIMITED", true)]
    [InlineData("model not found", "MODEL_REQUIRED", false)]
    [InlineData("unsupported model", "MODEL_REQUIRED", false)]
    [InlineData("fetch failed: ENOTFOUND", "NETWORK_UNAVAILABLE", true)]
    [InlineData("socket ECONNREFUSED", "NETWORK_UNAVAILABLE", true)]
    [InlineData("insufficient credits", "QUOTA_EXCEEDED", false)]
    [InlineData("quota exhausted", "QUOTA_EXCEEDED", false)]
    [InlineData("already running", "AGENT_BUSY", true)]
    [InlineData("provider returned an opaque failure", "PROVIDER_ERROR", true)]
    public void ProviderErrorsMapToSafeActionableCategories(
        string detail,
        string expectedCode,
        bool expectedRetryable)
    {
        var error = AgentCoordinator.MapResponseError(detail);

        Assert.Equal(expectedCode, error.Code);
        Assert.Equal(expectedRetryable, error.Retryable);
        Assert.DoesNotContain(detail, error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg")]
    [InlineData("00000000000000000000000000000000000000000000000000000000000000000")]
    public void PiExecutableHashRequiresExactlySixtyFourHexCharacters(string? value)
    {
        Assert.False(PiExecutableIntegrity.TryNormalizeSha256(value, out _));
    }

    [Fact]
    public void PiExecutableIntegrityRejectsTamperedContent()
    {
        var path = Path.Combine(Path.GetTempPath(), $"jarvis-pi-{Guid.NewGuid():N}.exe");
        var trustedBytes = Encoding.UTF8.GetBytes("trusted pi runtime");
        var trustedHash = Convert.ToHexString(SHA256.HashData(trustedBytes)).ToLowerInvariant();
        try
        {
            File.WriteAllBytes(path, trustedBytes);
            using (var verified = PiExecutableIntegrity.OpenVerified(
                       path,
                       new PiExecutableIdentity(trustedHash, trustedBytes.LongLength)))
            {
                Assert.Equal(trustedBytes.LongLength, verified.Length);
            }

            File.WriteAllBytes(path, Encoding.UTF8.GetBytes("tampered pi runtime"));
            Assert.Throws<PiRuntimeIntegrityException>(() =>
                PiExecutableIntegrity.OpenVerified(
                    path,
                    new PiExecutableIdentity(trustedHash, SizeBytes: null)));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void PackagedPiManifestMustMatchTrustedRuntimeIdentity()
    {
        var executable = new PiRuntimeExecutable(
            "pi.exe",
            111228928,
            "149c84e781334e9266f1a30d4380b50e42768e9880a9324d7fc92f91525cc642");
        var trusted = new PiRuntimeManifest(
            1,
            "pi-coding-agent",
            "0.83.0",
            "win-x64",
            "x64",
            "https://github.com/earendil-works/pi",
            "v0.83.0",
            "845d6ff1f6643aba440341cce877ce1c43ebbc39",
            "@earendil-works/pi-coding-agent",
            new PiRuntimeArchive(
                217,
                121117630,
                "RUNTIME-SHA256SUMS.txt",
                22289,
                "819b6d318c20a5d509fa422d420a61732b4ec92e96702db2065004ec3a997caa"),
            executable,
            new PiRuntimePolicies(
                "full-archive",
                "chat-only",
                false,
                "jsonl-stdin-stdout"),
            2099,
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

        Assert.True(trusted.MatchesPackagedRuntime(trusted));
        Assert.False(trusted.MatchesPackagedRuntime(
            trusted with { Version = "0.83.1" }));
        Assert.False(trusted.MatchesPackagedRuntime(
            trusted with { Runtime = "win-arm64" }));
        Assert.False(trusted.MatchesPackagedRuntime(
            trusted with { Executable = executable with { SizeBytes = executable.SizeBytes + 1 } }));
        Assert.False(trusted.MatchesPackagedRuntime(
            trusted with { Executable = executable with { Sha256 = new string('0', 64) } }));
        Assert.False(trusted.MatchesPackagedRuntime(
            trusted with { DocumentSha256 = new string('f', 64) }));
    }

    [Fact]
    public void PiRuntimeReceiptRequiresSortedSafeLfRecords()
    {
        var zeroHash = new string('0', 64);
        var oneHash = new string('1', 64);
        var valid = Encoding.UTF8.GetBytes(
            $"{zeroHash}  a.txt\n{oneHash}  nested/z.bin\n");

        var parsed = PiRuntimeTreeIntegrity.ParseReceipt(valid, expectedFileCount: 2);

        Assert.Equal(zeroHash, parsed["a.txt"]);
        Assert.Equal(oneHash, parsed["nested/z.bin"]);
        Assert.Throws<PiRuntimeIntegrityException>(() =>
            PiRuntimeTreeIntegrity.ParseReceipt(
                Encoding.UTF8.GetBytes($"{zeroHash}  ../escape.txt\n"),
                expectedFileCount: 1));
        Assert.Throws<PiRuntimeIntegrityException>(() =>
            PiRuntimeTreeIntegrity.ParseReceipt(
                Encoding.UTF8.GetBytes(
                    $"{oneHash}  z.txt\r\n{zeroHash}  a.txt\r\n"),
                expectedFileCount: 2));
    }

    private static void Observe(AgentTurnGuard guard, string json)
    {
        using var document = JsonDocument.Parse(json);
        guard.Observe(document.RootElement, json.Length);
    }

    private static PiAgentOptions CreateConfiguredAgentOptions()
    {
        var root = Path.Combine(Path.GetTempPath(), "jarvis-agent-concurrency-test");
        return new PiAgentOptions(
            ExecutablePath: Path.Combine(root, "fake-pi.exe"),
            ExecutableIdentity: new PiExecutableIdentity(new string('0', 64), SizeBytes: 1),
            AgentDirectory: root,
            PackageDirectory: Path.Combine(root, "packages"),
            WorkingDirectory: Path.Combine(root, "runtime"),
            PermissionMode: "chat-only",
            MaximumJsonLineBytes: 1024,
            CommandTimeout: TimeSpan.FromSeconds(5),
            AbortTimeout: TimeSpan.FromSeconds(1),
            TurnTimeout: TimeSpan.FromMinutes(1),
            ConfigurationIssue: null);
    }

    private sealed class ControllableAgentRpcClient : IAgentRpcClient
    {
        private readonly TaskCompletionSource _promptStarted = new(
            TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource _startEntered = new(
            TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<PiRpcResponse> _promptResponse = new(
            TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly ManualResetEventSlim _startRelease = new(initialState: false);
        private int _promptCount;

        public event Action<IAgentRpcClient, PiRpcEvent>? EventReceived
        {
            add { }
            remove { }
        }

        public event Action<IAgentRpcClient, PiRpcFailure>? Faulted
        {
            add { }
            remove { }
        }

        public bool IsConnected { get; private set; }

        public Task StartEntered => _startEntered.Task;

        public Task PromptStarted => _promptStarted.Task;

        public int PromptCount => Volatile.Read(ref _promptCount);

        public void Start()
        {
            _startEntered.TrySetResult();
            if (!_startRelease.Wait(TimeSpan.FromSeconds(5)))
            {
                throw new TimeoutException("The test did not release the fake Pi client start gate.");
            }
            IsConnected = true;
        }

        public void ReleaseStart() => _startRelease.Set();

        public Task<PiRpcResponse> SendAsync(
            string command,
            IReadOnlyDictionary<string, object?>? arguments,
            CancellationToken cancellationToken)
        {
            Assert.Equal("prompt", command);
            Assert.NotNull(arguments);
            Assert.Equal("first request", arguments["message"]);
            Interlocked.Increment(ref _promptCount);
            _promptStarted.TrySetResult();
            return _promptResponse.Task.WaitAsync(cancellationToken);
        }

        public void CompletePrompt() => _promptResponse.TrySetResult(
            new PiRpcResponse("prompt", Success: true, Data: null, Error: null));

        public void Terminate(PiRpcFailure failure) => IsConnected = false;

        public void Dispose()
        {
            IsConnected = false;
            _startRelease.Set();
        }
    }
}
