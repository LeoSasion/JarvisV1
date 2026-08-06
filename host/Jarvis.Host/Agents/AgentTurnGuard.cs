using System.Text.Json;

namespace Jarvis.Host.Agents;

internal sealed class AgentTurnGuard
{
    private readonly int _maximumEventCount;
    private readonly long _maximumOutputCharacters;
    private readonly long _maximumPayloadCharacters;

    private int _eventCount;
    private long _outputCharacters;
    private long _payloadCharacters;
    private long _currentMessageDeltaCharacters;
    private bool _assistantMessageOpen;
    private bool _settled;

    public AgentTurnGuard(
        int maximumEventCount,
        long maximumOutputCharacters,
        long maximumPayloadCharacters)
    {
        if (maximumEventCount <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maximumEventCount));
        }
        if (maximumOutputCharacters <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maximumOutputCharacters));
        }
        if (maximumPayloadCharacters <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maximumPayloadCharacters));
        }
        _maximumEventCount = maximumEventCount;
        _maximumOutputCharacters = maximumOutputCharacters;
        _maximumPayloadCharacters = maximumPayloadCharacters;
    }

    public void Observe(JsonElement root, int payloadCharacters)
    {
        if (root.ValueKind != JsonValueKind.Object ||
            !root.TryGetProperty("type", out var typeElement) ||
            typeElement.ValueKind != JsonValueKind.String)
        {
            throw new PiRpcProtocolException("Pi RPC emitted an event without a type string.");
        }

        if (payloadCharacters <= 0 ||
            payloadCharacters > _maximumPayloadCharacters - _payloadCharacters)
        {
            throw new PiRpcOutputLimitException(
                "Pi RPC exceeded the payload limit for one turn.");
        }
        _payloadCharacters += payloadCharacters;

        if (_eventCount >= _maximumEventCount)
        {
            throw new PiRpcOutputLimitException("Pi RPC exceeded the event limit for one turn.");
        }
        _eventCount++;

        var eventType = typeElement.GetString()!;
        switch (eventType)
        {
            case "message_start" when IsAssistantMessage(root):
                if (_assistantMessageOpen || _settled)
                {
                    throw new PiRpcProtocolException(
                        "Pi RPC started an assistant message out of sequence.");
                }
                _assistantMessageOpen = true;
                _currentMessageDeltaCharacters = 0;
                break;

            case "message_update" when HasAssistantUpdate(root):
                if (!_assistantMessageOpen || _settled)
                {
                    throw new PiRpcProtocolException(
                        "Pi RPC updated an assistant message out of sequence.");
                }
                if (TryGetTextDeltaLength(root, out var deltaLength))
                {
                    AddOutputCharacters(deltaLength);
                    _currentMessageDeltaCharacters += deltaLength;
                }
                break;

            case "message_end" when IsAssistantMessage(root):
                if (!_assistantMessageOpen || _settled)
                {
                    throw new PiRpcProtocolException(
                        "Pi RPC ended an assistant message out of sequence.");
                }
                var finalLength = GetMessageTextLength(root.GetProperty("message"));
                if (finalLength > _currentMessageDeltaCharacters)
                {
                    AddOutputCharacters(finalLength - _currentMessageDeltaCharacters);
                }
                _assistantMessageOpen = false;
                _currentMessageDeltaCharacters = 0;
                break;

            case "agent_settled":
                if (_assistantMessageOpen || _settled)
                {
                    throw new PiRpcProtocolException(
                        "Pi RPC settled a turn out of sequence.");
                }
                _settled = true;
                break;
        }
    }

    private void AddOutputCharacters(long count)
    {
        if (count < 0 || count > _maximumOutputCharacters - _outputCharacters)
        {
            throw new PiRpcOutputLimitException("Pi RPC exceeded the output limit for one turn.");
        }
        _outputCharacters += count;
    }

    private static bool IsAssistantMessage(JsonElement root) =>
        root.TryGetProperty("message", out var message) &&
        message.ValueKind == JsonValueKind.Object &&
        message.TryGetProperty("role", out var roleElement) &&
        roleElement.ValueKind == JsonValueKind.String &&
        roleElement.ValueEquals("assistant");

    private static bool HasAssistantUpdate(JsonElement root) =>
        root.TryGetProperty("assistantMessageEvent", out var update) &&
        update.ValueKind == JsonValueKind.Object;

    private static bool TryGetTextDeltaLength(JsonElement root, out int length)
    {
        length = 0;
        if (!root.TryGetProperty("assistantMessageEvent", out var update) ||
            update.ValueKind != JsonValueKind.Object ||
            !update.TryGetProperty("type", out var typeElement) ||
            typeElement.ValueKind != JsonValueKind.String ||
            !typeElement.ValueEquals("text_delta") ||
            !update.TryGetProperty("delta", out var deltaElement) ||
            deltaElement.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        length = deltaElement.GetString()?.Length ?? 0;
        return true;
    }

    private static long GetMessageTextLength(JsonElement message)
    {
        if (message.TryGetProperty("text", out var textElement) &&
            textElement.ValueKind == JsonValueKind.String)
        {
            return textElement.GetString()?.Length ?? 0;
        }
        if (!message.TryGetProperty("content", out var content))
        {
            return 0;
        }
        if (content.ValueKind == JsonValueKind.String)
        {
            return content.GetString()?.Length ?? 0;
        }
        if (content.ValueKind != JsonValueKind.Array)
        {
            return 0;
        }

        long length = 0;
        foreach (var block in content.EnumerateArray())
        {
            if (block.ValueKind == JsonValueKind.Object &&
                block.TryGetProperty("type", out var typeElement) &&
                typeElement.ValueKind == JsonValueKind.String &&
                typeElement.ValueEquals("text") &&
                block.TryGetProperty("text", out var blockText) &&
                blockText.ValueKind == JsonValueKind.String)
            {
                length += blockText.GetString()?.Length ?? 0;
            }
        }
        return length;
    }
}
