using System.Text;
using System.Runtime.InteropServices;

namespace Jarvis.Host.Agents;

internal sealed class StrictLfJsonLineDecoder
{
    private static readonly UTF8Encoding StrictUtf8 = new(
        encoderShouldEmitUTF8Identifier: false,
        throwOnInvalidBytes: true);

    private readonly int _maximumLineBytes;
    private readonly List<byte> _pending = [];

    public StrictLfJsonLineDecoder(int maximumLineBytes)
    {
        if (maximumLineBytes <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maximumLineBytes));
        }

        _maximumLineBytes = maximumLineBytes;
    }

    public IReadOnlyList<string> Push(ReadOnlySpan<byte> bytes)
    {
        var lines = new List<string>();
        foreach (var value in bytes)
        {
            if (value == (byte)'\n')
            {
                lines.Add(DecodePendingLine());
                _pending.Clear();
                continue;
            }

            if (_pending.Count >= _maximumLineBytes)
            {
                throw new PiRpcProtocolException(
                    $"Pi RPC produced a JSONL record larger than {_maximumLineBytes} bytes.");
            }

            _pending.Add(value);
        }

        return lines;
    }

    public void Complete()
    {
        if (_pending.Count != 0)
        {
            throw new PiRpcProtocolException(
                "Pi RPC closed stdout with an unterminated JSONL record.");
        }
    }

    private string DecodePendingLine()
    {
        var length = _pending.Count;
        if (length > 0 && _pending[length - 1] == (byte)'\r')
        {
            length--;
        }

        try
        {
            return StrictUtf8.GetString(CollectionsMarshal.AsSpan(_pending)[..length]);
        }
        catch (DecoderFallbackException exception)
        {
            throw new PiRpcProtocolException("Pi RPC stdout is not valid UTF-8.", exception);
        }
    }
}

internal class PiRpcProtocolException : Exception
{
    public PiRpcProtocolException(string message)
        : base(message)
    {
    }

    public PiRpcProtocolException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}

internal sealed class PiRpcOutputLimitException : PiRpcProtocolException
{
    public PiRpcOutputLimitException(string message)
        : base(message)
    {
    }
}
