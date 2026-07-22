namespace Jarvis.Host.Bridge;

internal sealed class BridgeFaultException : Exception
{
    public BridgeFaultException(string code, string message)
        : base(message)
    {
        Code = code;
    }

    public string Code { get; }
}
