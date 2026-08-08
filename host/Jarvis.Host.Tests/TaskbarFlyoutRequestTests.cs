using System.Text.Json;
using Jarvis.Host.Bridge;

namespace Jarvis.Host.Tests;

public sealed class TaskbarFlyoutRequestTests
{
    [Fact]
    public void OverflowAcceptsBoundedRendererOwnedItemsWithoutNativeWindows()
    {
        using var document = JsonDocument.Parse("""
            {
              "mode": "overflow",
              "windowIds": [],
              "items": [{
                "itemId": "builtin:explorer",
                "label": "File Explorer",
                "meta": "PINNED APPLICATION",
                "windowId": null
              }],
              "anchorX": 320,
              "viewportWidth": 1280
            }
            """);

        var request = WebBridge.GetFlyoutRequest(document.RootElement);

        Assert.Empty(request.WindowIds);
        var item = Assert.Single(request.OverflowItems);
        Assert.Equal("builtin:explorer", item.ItemId);
        Assert.Equal("File Explorer", item.Label);
        Assert.Null(item.WindowId);
    }

    [Fact]
    public void OverflowPreservesMixedTaskbarItemOrder()
    {
        using var document = JsonDocument.Parse("""
            {
              "mode": "overflow",
              "windowIds": ["native:1"],
              "items": [
                { "itemId": "native", "label": "External", "meta": "READY", "windowId": "native:1" },
                { "itemId": "pinned", "label": "Pinned", "meta": "PINNED APPLICATION", "windowId": null },
                { "itemId": "internal", "label": "Agent", "meta": "INTERNAL WINDOW · ACTIVE", "windowId": "internal:agent" }
              ],
              "anchorX": 320,
              "viewportWidth": 1280
            }
            """);

        var request = WebBridge.GetFlyoutRequest(document.RootElement);

        Assert.Equal(new[] { "native", "pinned", "internal" }, request.OverflowItems.Select(item => item.ItemId));
        Assert.Equal("native:1", request.OverflowItems[0].WindowId);
        Assert.Null(request.OverflowItems[1].WindowId);
        Assert.Equal("internal:agent", request.OverflowItems[2].WindowId);
        Assert.Equal(3, WebBridge.GetTaskbarFlyoutItemCount(request));
    }

    [Fact]
    public void OverflowRejectsUnexpectedRendererOwnedFields()
    {
        using var document = JsonDocument.Parse("""
            {
              "mode": "overflow",
              "windowIds": [],
              "items": [{
                "itemId": "builtin:explorer",
                "label": "File Explorer",
                "meta": "PINNED APPLICATION",
                "command": "powershell.exe"
              }],
              "anchorX": 320,
              "viewportWidth": 1280
            }
            """);

        var error = Assert.Throws<BridgeFaultException>(
            () => WebBridge.GetFlyoutRequest(document.RootElement));

        Assert.Equal("INVALID_PARAMS", error.Code);
    }

    [Fact]
    public void WindowPreviewStillRequiresANativeWindowIdentifier()
    {
        using var document = JsonDocument.Parse("""
            {
              "mode": "windows",
              "windowIds": [],
              "anchorX": 320,
              "viewportWidth": 1280
            }
            """);

        var error = Assert.Throws<BridgeFaultException>(
            () => WebBridge.GetFlyoutRequest(document.RootElement));

        Assert.Equal("INVALID_PARAMS", error.Code);
    }
}
