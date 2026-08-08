using System.Text.Json;
using Jarvis.Host.Bridge;

namespace Jarvis.Host.Tests;

public sealed class ShellPanelRequestTests
{
    [Fact]
    public void HelpPanelIsAvailableThroughTheTrustedDesktopBridge()
    {
        using var document = JsonDocument.Parse("""{ "panel": "help" }""");

        Assert.Equal("help", WebBridge.GetRequestedPanel(document.RootElement));
    }

    [Fact]
    public void ArbitraryPanelNamesRemainRejected()
    {
        using var document = JsonDocument.Parse("""{ "panel": "developer-console" }""");

        var error = Assert.Throws<BridgeFaultException>(
            () => WebBridge.GetRequestedPanel(document.RootElement));

        Assert.Equal("INVALID_PARAMS", error.Code);
    }
}
