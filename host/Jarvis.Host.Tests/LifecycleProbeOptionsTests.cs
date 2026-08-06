using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Tests;

public sealed class LifecycleProbeOptionsTests
{
    private const string Nonce = "0123456789abcdef0123456789abcdef";

    [Fact]
    public void NormalStartupDoesNotEnterLifecycleProbe()
    {
        Assert.False(LifecycleProbeOptions.IsRequested(["--startup"]));
        Assert.False(LifecycleProbeOptions.TryParse(["--startup"], out _, out _));
    }

    [Fact]
    public void ValidProbeUsesCanonicalIsolatedPaths()
    {
        var root = CreateIsolatedRoot();
        var receipt = Path.Combine(root, "receipts", "probe.json");

        var parsed = LifecycleProbeOptions.TryParse(
            CreateArguments(root, receipt),
            out var options,
            out var error);

        Assert.True(parsed, error);
        Assert.NotNull(options);
        Assert.Equal(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar), options.DataRoot);
        Assert.Equal(Path.GetFullPath(receipt), options.ReceiptPath);
        Assert.Equal(Nonce, options.Nonce);
    }

    [Theory]
    [InlineData("relative-root", "relative-root\\probe.json")]
    [InlineData("relative-root", "C:\\temp\\probe.json")]
    public void RelativePathsAreRejected(string root, string receipt)
    {
        Assert.False(LifecycleProbeOptions.TryParse(
            CreateArguments(root, receipt),
            out _,
            out _));
    }

    [Fact]
    public void ReceiptCannotEscapeTheDataRoot()
    {
        var root = CreateIsolatedRoot();
        var receipt = Path.Combine(root, "..", "probe.json");

        Assert.False(LifecycleProbeOptions.TryParse(
            CreateArguments(root, receipt),
            out _,
            out _));
    }

    [Theory]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("gggggggggggggggggggggggggggggggg")]
    [InlineData("0123456789abcdef0123456789abcdef00")]
    public void NonceMustBeExactlyThirtyTwoHexCharacters(string nonce)
    {
        var root = CreateIsolatedRoot();
        var receipt = Path.Combine(root, "probe.json");
        var arguments = CreateArguments(root, receipt);
        arguments[3] = $"--lifecycle-nonce={nonce}";

        Assert.False(LifecycleProbeOptions.TryParse(arguments, out _, out _));
    }

    [Fact]
    public void ProductionDataTreeAndItsAncestorsAreRejected()
    {
        var productionRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "JARVIS");
        var productionChild = Path.Combine(productionRoot, "LifecycleProbe");
        var productionParent = Directory.GetParent(productionRoot)!.FullName;

        Assert.False(LifecycleProbeOptions.TryParse(
            CreateArguments(productionRoot, Path.Combine(productionRoot, "probe.json")),
            out _,
            out _));
        Assert.False(LifecycleProbeOptions.TryParse(
            CreateArguments(productionChild, Path.Combine(productionChild, "probe.json")),
            out _,
            out _));
        Assert.False(LifecycleProbeOptions.TryParse(
            CreateArguments(productionParent, Path.Combine(productionParent, "probe.json")),
            out _,
            out _));
    }

    [Fact]
    public void DuplicateOrUnknownProbeArgumentsFailClosed()
    {
        var root = CreateIsolatedRoot();
        var receipt = Path.Combine(root, "probe.json");
        var duplicate = CreateArguments(root, receipt).Concat([
            $"--lifecycle-nonce={Nonce}"
        ]).ToArray();
        var unknown = CreateArguments(root, receipt);
        unknown[3] = "--lifecycle-unknown=value";

        Assert.False(LifecycleProbeOptions.TryParse(duplicate, out _, out _));
        Assert.False(LifecycleProbeOptions.TryParse(unknown, out _, out _));
    }

    private static string[] CreateArguments(string root, string receipt) =>
    [
        "--lifecycle-probe",
        $"--lifecycle-data-root={root}",
        $"--lifecycle-receipt={receipt}",
        $"--lifecycle-nonce={Nonce}"
    ];

    private static string CreateIsolatedRoot() => Path.Combine(
        Path.GetTempPath(),
        "jarvis-lifecycle-probe-tests",
        Guid.NewGuid().ToString("N"));
}
