using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class NativeWindowAppearanceRulesTests
{
    [Theory]
    [InlineData("notepad.exe", "notepad")]
    [InlineData(" Code ", "Code")]
    [InlineData("my app.EXE", "my app")]
    public void NormalizesBoundedProcessFilenames(string value, string expected)
    {
        Assert.True(NativeWindowAppearanceRuleSet.TryNormalizeProcessName(value, out var actual));
        Assert.Equal(expected, actual);
    }

    [Theory]
    [InlineData("")]
    [InlineData(@"C:\Windows\notepad.exe")]
    [InlineData("../notepad")]
    [InlineData("bad*name")]
    public void RejectsPathsAndMalformedProcessNames(string value)
    {
        Assert.False(NativeWindowAppearanceRuleSet.TryNormalizeProcessName(value, out _));
    }

    [Fact]
    public void SystemProtectionWinsOverUserConfiguration()
    {
        var rules = new NativeWindowAppearanceRuleSet(
        [
            new NativeWindowAppearanceRule("SearchHost", "allow"),
            new NativeWindowAppearanceRule("notepad", "deny")
        ]);

        var protectedDecision = rules.Evaluate("SearchHost.exe");
        var deniedDecision = rules.Evaluate("notepad.exe");

        Assert.Equal(NativeWindowAppearanceRuleDecision.Protected, protectedDecision.Decision);
        Assert.False(protectedDecision.PermitsAppearance);
        Assert.Equal(NativeWindowAppearanceRuleDecision.Denied, deniedDecision.Decision);
        Assert.False(deniedDecision.PermitsAppearance);
        Assert.Single(rules.GetSnapshot());
    }

    [Fact]
    public void SupportsAllowDenyAndReturningToAutomatic()
    {
        var rules = new NativeWindowAppearanceRuleSet();

        Assert.True(rules.TrySet("Code.exe", "allow", out var normalized, out _));
        Assert.Equal("Code", normalized);
        Assert.Equal(NativeWindowAppearanceRuleDecision.Allowed, rules.Evaluate("code").Decision);

        Assert.True(rules.TrySet("code", "deny", out _, out _));
        Assert.Equal(NativeWindowAppearanceRuleDecision.Denied, rules.Evaluate("CODE.EXE").Decision);

        Assert.True(rules.TryRemove("Code.exe", out _, out _));
        Assert.Equal(NativeWindowAppearanceRuleDecision.Automatic, rules.Evaluate("code").Decision);
    }

    [Fact]
    public void EnforcesRuleCapacityWithoutBlockingUpdates()
    {
        var rules = new NativeWindowAppearanceRuleSet();
        for (var index = 0; index < NativeWindowAppearanceRuleSet.MaximumRules; index++)
        {
            Assert.True(rules.TrySet($"app-{index}", "deny", out _, out _));
        }

        Assert.False(rules.TrySet("overflow", "deny", out _, out var error));
        Assert.Contains("At most", error);
        Assert.True(rules.TrySet("app-0", "allow", out _, out _));
        Assert.Equal(
            NativeWindowAppearanceRuleDecision.Allowed,
            rules.Evaluate("app-0").Decision);
    }
}
