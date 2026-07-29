using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class TaskbarSurfaceVisibilityPolicyTests
{
    [Theory]
    [InlineData(false, false, false)]
    [InlineData(true, false, true)]
    [InlineData(true, true, false)]
    [InlineData(false, true, false)]
    public void VisibilityRequiresActivationWithoutFullscreenSuppression(
        bool lifecycleActivated,
        bool fullscreenSuppressed,
        bool expected)
    {
        Assert.Equal(
            expected,
            TaskbarSurfaceVisibilityPolicy.ShouldShow(
                lifecycleActivated,
                fullscreenSuppressed));
    }
}
