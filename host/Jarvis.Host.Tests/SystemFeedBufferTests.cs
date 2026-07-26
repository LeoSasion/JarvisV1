using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class SystemFeedBufferTests
{
    [Fact]
    public void BufferIsBoundedAndNewestFirst()
    {
        var buffer = new SystemFeedBuffer(2, TimeSpan.Zero);
        Add(buffer, "one", DateTimeOffset.Parse("2026-07-27T00:00:01Z"));
        Add(buffer, "two", DateTimeOffset.Parse("2026-07-27T00:00:02Z"));
        Add(buffer, "three", DateTimeOffset.Parse("2026-07-27T00:00:03Z"));

        var snapshot = buffer.GetSnapshot();
        Assert.Equal(2, snapshot.Items.Count);
        Assert.Equal("three", snapshot.Items[0].Id);
        Assert.Equal("two", snapshot.Items[1].Id);
        Assert.Equal(2, snapshot.UnreadCount);
        Assert.InRange(buffer.DeduplicationKeyCount, 0, 2);
    }

    [Fact]
    public void DeduplicationIndexIsBoundedWithUniqueKeys()
    {
        var buffer = new SystemFeedBuffer(2, TimeSpan.FromHours(1));
        Add(buffer, "one", DateTimeOffset.Parse("2026-07-27T00:00:01Z"));
        Add(buffer, "two", DateTimeOffset.Parse("2026-07-27T00:00:02Z"));
        Add(buffer, "three", DateTimeOffset.Parse("2026-07-27T00:00:03Z"));

        Assert.Equal(2, buffer.DeduplicationKeyCount);
    }

    [Fact]
    public void DuplicateEventsAreThrottledThenCanReturnAfterClear()
    {
        var buffer = new SystemFeedBuffer(50, TimeSpan.FromSeconds(30));
        var first = CreateItem("first", DateTimeOffset.Parse("2026-07-27T00:00:00Z"));
        var duplicate = CreateItem("duplicate", first.Timestamp.AddSeconds(10));

        Assert.True(buffer.TryAdd("network:false", first, out _));
        Assert.False(buffer.TryAdd("network:false", duplicate, out var throttled));
        Assert.Single(throttled.Items);

        buffer.Clear();
        Assert.True(buffer.TryAdd("network:false", duplicate, out var afterClear));
        Assert.Single(afterClear.Items);
    }

    [Fact]
    public void MarkAllReadKeepsItemsAndClearsUnreadCount()
    {
        var buffer = new SystemFeedBuffer(50, TimeSpan.Zero);
        Add(buffer, "one", DateTimeOffset.UtcNow);

        var snapshot = buffer.MarkAllRead();

        Assert.Single(snapshot.Items);
        Assert.Equal(0, snapshot.UnreadCount);
        Assert.False(snapshot.Items[0].Unread);
    }

    private static void Add(
        SystemFeedBuffer buffer,
        string id,
        DateTimeOffset timestamp)
    {
        Assert.True(buffer.TryAdd(id, CreateItem(id, timestamp), out _));
    }

    private static SystemFeedItem CreateItem(
        string id,
        DateTimeOffset timestamp) =>
        new(
            id,
            "test",
            "info",
            "Test event",
            "Test detail",
            timestamp,
            Unread: true,
            ActionId: null);
}
