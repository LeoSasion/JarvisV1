namespace Jarvis.Host.Tests;

public sealed class TaskbarFlyoutInteractionTests
{
    [Theory]
    [InlineData("overflow", true)]
    [InlineData("context", true)]
    [InlineData("windows", false)]
    public void OnlyCommandFlyoutsTakeKeyboardFocus(string mode, bool expected)
    {
        Assert.Equal(expected, TaskbarFlyoutWindow.IsKeyboardInteractiveMode(mode));
    }
}
