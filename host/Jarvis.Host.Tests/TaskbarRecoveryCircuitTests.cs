using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class TaskbarRecoveryCircuitTests
{
    private static readonly DateTimeOffset Baseline =
        new(2026, 7, 29, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void ThirdFailureInsideWindowOpensCircuit()
    {
        var circuit = new TaskbarRecoveryCircuit();

        _ = circuit.ReportFailure(Baseline);
        _ = circuit.ReportFailure(Baseline.AddSeconds(20));
        var snapshot = circuit.ReportFailure(Baseline.AddSeconds(40));

        Assert.True(snapshot.IsOpen);
        Assert.Equal(3, snapshot.FailureCount);
        Assert.Equal(Baseline.AddSeconds(100), snapshot.RetryAfterUtc);
    }

    [Fact]
    public void FailuresOutsideRollingWindowDoNotAccumulate()
    {
        var circuit = new TaskbarRecoveryCircuit();

        _ = circuit.ReportFailure(Baseline);
        _ = circuit.ReportFailure(Baseline.AddSeconds(61));
        var snapshot = circuit.ReportFailure(Baseline.AddSeconds(122));

        Assert.False(snapshot.IsOpen);
        Assert.Equal(1, snapshot.FailureCount);
    }

    [Fact]
    public void CooldownExpiryClosesAndClearsCircuit()
    {
        var circuit = CreateOpenCircuit();

        var snapshot = circuit.Capture(Baseline.AddSeconds(101));

        Assert.False(snapshot.IsOpen);
        Assert.Equal(0, snapshot.FailureCount);
        Assert.Null(snapshot.RetryAfterUtc);
    }

    [Fact]
    public void ExplicitResetClearsFailureBudget()
    {
        var circuit = CreateOpenCircuit();

        var snapshot = circuit.Reset();

        Assert.False(snapshot.IsOpen);
        Assert.Equal(0, snapshot.FailureCount);
    }

    [Fact]
    public void StableSuccessClearsPartialFailureBudget()
    {
        var circuit = new TaskbarRecoveryCircuit();
        _ = circuit.ReportFailure(Baseline);
        _ = circuit.ReportFailure(Baseline.AddSeconds(10));

        var snapshot = circuit.ReportStableSuccess();

        Assert.False(snapshot.IsOpen);
        Assert.Equal(0, snapshot.FailureCount);
    }

    [Fact]
    public void OpenCircuitDoesNotExtendCooldownForAdditionalReports()
    {
        var circuit = CreateOpenCircuit();

        var snapshot = circuit.ReportFailure(Baseline.AddSeconds(50));

        Assert.Equal(Baseline.AddSeconds(100), snapshot.RetryAfterUtc);
        Assert.Equal(3, snapshot.FailureCount);
    }

    [Fact]
    public void OpenCircuitRetainsFailureEvidenceUntilCooldownExpires()
    {
        var circuit = CreateOpenCircuit();

        var snapshot = circuit.Capture(Baseline.AddSeconds(90));

        Assert.True(snapshot.IsOpen);
        Assert.Equal(3, snapshot.FailureCount);
    }

    private static TaskbarRecoveryCircuit CreateOpenCircuit()
    {
        var circuit = new TaskbarRecoveryCircuit();
        _ = circuit.ReportFailure(Baseline);
        _ = circuit.ReportFailure(Baseline.AddSeconds(20));
        _ = circuit.ReportFailure(Baseline.AddSeconds(40));
        return circuit;
    }
}
