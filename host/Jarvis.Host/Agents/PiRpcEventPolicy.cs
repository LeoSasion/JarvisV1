using System.Text.Json;

namespace Jarvis.Host.Agents;

internal static class PiRpcEventPolicy
{
    public static void ValidateChatOnlyEvent(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object ||
            !root.TryGetProperty("type", out var typeElement) ||
            typeElement.ValueKind != JsonValueKind.String)
        {
            throw new PiRpcProtocolException("Pi RPC emitted an event without a type string.");
        }

        var eventType = typeElement.GetString()!;
        if (IsToolEventType(eventType) ||
            NormalizeType(eventType).StartsWith("extensionui", StringComparison.Ordinal))
        {
            throw new PiRpcProtocolException(
                $"Pi RPC emitted forbidden chat-only event type '{eventType}'.");
        }

        if (root.TryGetProperty("toolResults", out var toolResults) &&
            toolResults.ValueKind != JsonValueKind.Null &&
            (toolResults.ValueKind != JsonValueKind.Array ||
             toolResults.GetArrayLength() != 0))
        {
            throw new PiRpcProtocolException(
                "Pi RPC emitted tool results while JARVIS is in chat-only mode.");
        }

        ValidateMessages(root, "message");
        ValidateMessages(root, "messages");

        if (root.TryGetProperty("assistantMessageEvent", out var update) &&
            update.ValueKind == JsonValueKind.Object &&
            update.TryGetProperty("type", out var updateTypeElement) &&
            updateTypeElement.ValueKind == JsonValueKind.String)
        {
            var updateType = NormalizeType(updateTypeElement.GetString());
            if (updateType.StartsWith("toolcall", StringComparison.Ordinal) ||
                updateType.StartsWith("toolresult", StringComparison.Ordinal))
            {
                throw new PiRpcProtocolException(
                    "Pi RPC attempted to stream a tool call while JARVIS is in chat-only mode.");
            }
        }
    }

    public static void ValidateChatOnlyMessages(JsonElement messages)
    {
        if (messages.ValueKind != JsonValueKind.Array)
        {
            throw new PiRpcProtocolException("Pi RPC get_messages did not return a messages array.");
        }

        foreach (var message in messages.EnumerateArray())
        {
            ValidateMessage(message);
        }
    }

    internal static bool IsToolEventType(string eventType)
    {
        var normalized = NormalizeType(eventType);
        return normalized.StartsWith("tool", StringComparison.Ordinal) ||
               normalized.StartsWith("bash", StringComparison.Ordinal);
    }

    private static void ValidateMessages(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var value))
        {
            return;
        }

        if (value.ValueKind == JsonValueKind.Array)
        {
            foreach (var message in value.EnumerateArray())
            {
                ValidateMessage(message);
            }
            return;
        }

        ValidateMessage(value);
    }

    private static void ValidateMessage(JsonElement message)
    {
        if (message.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        if (message.TryGetProperty("role", out var roleElement) &&
            roleElement.ValueKind == JsonValueKind.String &&
            NormalizeType(roleElement.GetString()).StartsWith("tool", StringComparison.Ordinal))
        {
            throw new PiRpcProtocolException(
                "Pi RPC emitted a tool-result message while JARVIS is in chat-only mode.");
        }

        if (!message.TryGetProperty("content", out var content) ||
            content.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        foreach (var block in content.EnumerateArray())
        {
            if (block.ValueKind != JsonValueKind.Object ||
                !block.TryGetProperty("type", out var blockTypeElement) ||
                blockTypeElement.ValueKind != JsonValueKind.String)
            {
                continue;
            }

            var blockType = NormalizeType(blockTypeElement.GetString());
            if (blockType.StartsWith("toolcall", StringComparison.Ordinal) ||
                blockType.StartsWith("toolresult", StringComparison.Ordinal))
            {
                throw new PiRpcProtocolException(
                    "Pi RPC emitted tool content while JARVIS is in chat-only mode.");
            }
        }
    }

    private static string NormalizeType(string? value) =>
        (value ?? string.Empty)
            .Replace("_", string.Empty, StringComparison.Ordinal)
            .Replace("-", string.Empty, StringComparison.Ordinal)
            .ToLowerInvariant();
}
