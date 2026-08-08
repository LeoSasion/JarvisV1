using System.Text.Json;
using Jarvis.Host.Bridge;
using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class RendererFaultReportTests
{
    [Fact]
    public void ServiceOwnsMetadataAndDeduplicatesEquivalentFaults()
    {
        using var service = new SystemFeedService(null!);
        var publishedSnapshots = 0;
        service.SnapshotChanged += _ => publishedSnapshots++;
        var startedAt = DateTimeOffset.UtcNow;
        var report = new RendererFaultReport(
            " SHELL ",
            " WARNING ",
            " Renderer could not refresh ",
            " Native shell data is temporarily unavailable. ",
            " OPEN-RUNTIME-SETTINGS ");

        var first = service.ReportRendererFault(report);
        var finishedAt = DateTimeOffset.UtcNow;

        var item = Assert.Single(first.Items);
        Assert.True(Guid.TryParseExact(item.Id, "N", out _));
        Assert.Equal("renderer.shell.fault", item.Type);
        Assert.Equal("warning", item.Severity);
        Assert.Equal("Renderer could not refresh", item.Title);
        Assert.Equal("Native shell data is temporarily unavailable.", item.Detail);
        Assert.Equal("open-runtime-settings", item.ActionId);
        Assert.True(item.Unread);
        Assert.InRange(item.Timestamp, startedAt, finishedAt);
        Assert.Equal(1, first.UnreadCount);
        Assert.Equal(1, publishedSnapshots);

        var duplicate = service.ReportRendererFault(report);

        Assert.Single(duplicate.Items);
        Assert.Equal(item.Id, duplicate.Items[0].Id);
        Assert.Equal(1, publishedSnapshots);
    }

    [Theory]
    [InlineData("unsupported-severity")]
    [InlineData("unsupported-source")]
    [InlineData("unsupported-action")]
    [InlineData("long-title")]
    [InlineData("long-detail")]
    [InlineData("control-character")]
    public void ServiceRejectsUnboundedOrUnsupportedFaults(string scenario)
    {
        using var service = new SystemFeedService(null!);
        var report = scenario switch
        {
            "unsupported-severity" => new RendererFaultReport("shell", "info", "Fault"),
            "unsupported-source" => new RendererFaultReport("untrusted", "error", "Fault"),
            "unsupported-action" => new RendererFaultReport("shell", "error", "Fault", ActionId: "retry"),
            "long-title" => new RendererFaultReport("shell", "error", new string('x', 161)),
            "long-detail" => new RendererFaultReport("shell", "error", "Fault", new string('x', 321)),
            "control-character" => new RendererFaultReport("shell", "error", "Fault", "line\nbreak"),
            _ => throw new ArgumentOutOfRangeException(nameof(scenario))
        };

        Assert.Throws<ArgumentException>(() => service.ReportRendererFault(report));
        Assert.Empty(service.GetSnapshot().Items);
    }

    [Fact]
    public void BridgeParserAcceptsOnlyTheTypedRendererFaultShape()
    {
        using var document = JsonDocument.Parse(
            """
            {
              "source": "shell",
              "severity": "error",
              "title": "Renderer fault",
              "detail": null,
              "actionId": "open-runtime-settings"
            }
            """);

        var report = WebBridge.GetRendererFaultReport(document.RootElement);

        Assert.Equal("shell", report.Source);
        Assert.Equal("error", report.Severity);
        Assert.Equal("Renderer fault", report.Title);
        Assert.Null(report.Detail);
        Assert.Equal("open-runtime-settings", report.ActionId);
    }

    [Theory]
    [InlineData("command")]
    [InlineData("path")]
    [InlineData("id")]
    [InlineData("timestamp")]
    [InlineData("unread")]
    public void BridgeParserRejectsCommandsPathsAndCallerOwnedMetadata(string fieldName)
    {
        using var document = JsonDocument.Parse(
            $$"""
            {
              "source": "shell",
              "severity": "error",
              "title": "Renderer fault",
              "{{fieldName}}": "caller-owned"
            }
            """);

        var exception = Assert.Throws<BridgeFaultException>(
            () => WebBridge.GetRendererFaultReport(document.RootElement));

        Assert.Equal("INVALID_PARAMS", exception.Code);
        Assert.Contains($"params.{fieldName}", exception.Message, StringComparison.Ordinal);
    }
}
