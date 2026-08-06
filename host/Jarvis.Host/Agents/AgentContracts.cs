using System.Text.Json;

namespace Jarvis.Host.Agents;

internal sealed record AgentError(
    string Code,
    string Message,
    bool Retryable = false);

internal sealed record AgentStateSnapshot(
    string? Provider,
    string? Model,
    string PermissionMode,
    bool Available,
    bool Configured,
    bool Connected,
    bool Running,
    string Status,
    string? SessionId,
    string? ActiveRunId,
    AgentError? Error);

internal sealed record AgentMessageSnapshot(
    string Id,
    string Role,
    string Text,
    string Status,
    string? CreatedAt,
    string? ClientMessageId);

internal sealed record AgentPromptResult(
    bool Accepted,
    string ClientMessageId,
    string? RunId,
    AgentStateSnapshot State,
    AgentError? Error);

internal sealed record AgentCommandResult(
    bool Success,
    AgentStateSnapshot State,
    AgentError? Error = null);

internal sealed record AgentUiEvent(
    string Kind,
    long? Sequence = null,
    string? RunId = null,
    string? MessageId = null,
    AgentMessageSnapshot? Message = null,
    string? Delta = null,
    string? Status = null,
    AgentError? Error = null,
    JsonElement? Tool = null);

internal sealed record PiRpcFailure(
    string Code,
    string Message,
    bool Retryable = false);

internal sealed record PiRpcResponse(
    string Command,
    bool Success,
    JsonElement? Data,
    string? Error);
