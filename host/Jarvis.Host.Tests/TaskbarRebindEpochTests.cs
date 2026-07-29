using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class TaskbarRebindEpochTests
{
    [Fact]
    public void NewGenerationSupersedesEveryOlderGeneration()
    {
        var epoch = new TaskbarRebindEpoch();

        var first = epoch.Next();
        var second = epoch.Next();

        Assert.False(epoch.IsCurrent(first));
        Assert.True(epoch.IsCurrent(second));
        Assert.Equal(second, epoch.Current);
    }

    [Fact]
    public void ExplicitInvalidationRejectsTheActiveGeneration()
    {
        var epoch = new TaskbarRebindEpoch();
        var active = epoch.Next();

        epoch.Invalidate();

        Assert.False(epoch.IsCurrent(active));
        Assert.Equal(active + 1, epoch.Current);
    }

    [Fact]
    public void InitialZeroIsNeverAnOwnedGeneration()
    {
        var epoch = new TaskbarRebindEpoch();

        Assert.False(epoch.IsCurrent(0));
        Assert.Equal(0, epoch.Current);
    }
}
