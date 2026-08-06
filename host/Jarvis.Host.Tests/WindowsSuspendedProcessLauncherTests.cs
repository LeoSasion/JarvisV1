using System.Diagnostics;
using System.Text;
using Jarvis.Host.Agents;

namespace Jarvis.Host.Tests;

public sealed class WindowsSuspendedProcessLauncherTests
{
    [Theory]
    [InlineData("", "\"\"")]
    [InlineData("plain", "plain")]
    [InlineData("two words", "\"two words\"")]
    [InlineData("a\"b", "\"a\\\"b\"")]
    public void CommandLinePreservesArgumentBoundaries(string argument, string expectedArgument)
    {
        var commandLine = WindowsSuspendedProcessLauncher.BuildCommandLine(
            @"C:\Program Files\Pi\pi.exe",
            [argument]);

        Assert.Equal($"\"C:\\Program Files\\Pi\\pi.exe\" {expectedArgument}", commandLine);
    }

    [Fact]
    public void CommandLineDoublesTrailingBackslashesInsideQuotes()
    {
        var commandLine = WindowsSuspendedProcessLauncher.BuildCommandLine(
            @"C:\Pi Agent\pi.exe",
            [@"C:\path with space\"]);

        Assert.Equal(
            "\"C:\\Pi Agent\\pi.exe\" \"C:\\path with space\\\\\"",
            commandLine);
    }

    [Fact]
    public void EnvironmentBlockIsSortedAndDoubleNullTerminated()
    {
        var block = WindowsSuspendedProcessLauncher.BuildEnvironmentBlock(
        [
            new KeyValuePair<string, string?>("z_VALUE", "last"),
            new KeyValuePair<string, string?>("A_VALUE", "first")
        ]);

        Assert.Equal("A_VALUE=first\0z_VALUE=last\0\0", block);
        Assert.Equal("\0\0", WindowsSuspendedProcessLauncher.BuildEnvironmentBlock([]));
    }

    [Fact]
    public void EnvironmentBlockRejectsAmbiguousKeysAndNullCharacters()
    {
        Assert.Throws<ArgumentException>(() =>
            WindowsSuspendedProcessLauncher.BuildEnvironmentBlock(
                [new KeyValuePair<string, string?>("A=B", "value")]));
        Assert.Throws<ArgumentException>(() =>
            WindowsSuspendedProcessLauncher.BuildEnvironmentBlock(
                [new KeyValuePair<string, string?>("A", "bad\0value")]));
    }

    [Fact]
    public async Task LaunchesContainedStandInWithRedirectedStandardStreams()
    {
        if (!OperatingSystem.IsWindows())
        {
            return;
        }

        using var processJob = WindowsProcessJob.CreateKillOnClose();
        using var launched = WindowsSuspendedProcessLauncher.Start(
            CreateCommandStartInfo(
                "set /p JARVIS_LINE=& echo OUT:!JARVIS_LINE!& echo ERR:!JARVIS_LINE! 1>&2"),
            processJob);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var outputReader = new StreamReader(
            launched.StandardOutput,
            new UTF8Encoding(false, true),
            detectEncodingFromByteOrderMarks: false,
            leaveOpen: true);
        using var errorReader = new StreamReader(
            launched.StandardError,
            new UTF8Encoding(false, true),
            detectEncodingFromByteOrderMarks: false,
            leaveOpen: true);
        var outputTask = outputReader.ReadToEndAsync(timeout.Token);
        var errorTask = errorReader.ReadToEndAsync(timeout.Token);

        await launched.StandardInput.WriteAsync(
            Encoding.UTF8.GetBytes("ping\r\n"),
            timeout.Token);
        await launched.StandardInput.FlushAsync(timeout.Token);
        launched.StandardInput.Dispose();

        await launched.Process.WaitForExitAsync(timeout.Token);
        var output = await outputTask;
        var error = await errorTask;

        Assert.Equal(0, launched.Process.ExitCode);
        Assert.Contains("OUT:ping", output, StringComparison.Ordinal);
        Assert.Contains("ERR:ping", error, StringComparison.Ordinal);
    }

    [Fact]
    public void AssignmentFailureTerminatesTheStillSuspendedStandIn()
    {
        if (!OperatingSystem.IsWindows())
        {
            return;
        }

        var markerPath = Path.Combine(
            Path.GetTempPath(),
            $"jarvis-suspended-{Guid.NewGuid():N}.marker");
        try
        {
            var processJob = WindowsProcessJob.CreateKillOnClose();
            processJob.Dispose();

            var exception = Assert.Throws<WindowsProcessLaunchException>(() =>
                WindowsSuspendedProcessLauncher.Start(
                    CreateCommandStartInfo($"echo escaped>\"{markerPath}\""),
                    processJob));

            Assert.True(exception.TerminationConfirmed);
            Assert.False(IsProcessRunning(exception.ProcessId));
            Assert.False(File.Exists(markerPath));
        }
        finally
        {
            File.Delete(markerPath);
        }
    }

    [Fact]
    public void ClosingTheJobTerminatesAContainedStandIn()
    {
        if (!OperatingSystem.IsWindows())
        {
            return;
        }

        var processJob = WindowsProcessJob.CreateKillOnClose();
        using var launched = WindowsSuspendedProcessLauncher.Start(
            CreateCommandStartInfo("set /p JARVIS_BLOCK="),
            processJob);

        processJob.Dispose();

        Assert.True(launched.Process.WaitForExit(milliseconds: 5_000));
        Assert.True(launched.Process.HasExited);
    }

    private static ProcessStartInfo CreateCommandStartInfo(string command)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = Path.Combine(Environment.SystemDirectory, "cmd.exe"),
            WorkingDirectory = Path.GetTempPath(),
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        startInfo.ArgumentList.Add("/d");
        startInfo.ArgumentList.Add("/v:on");
        startInfo.ArgumentList.Add("/s");
        startInfo.ArgumentList.Add("/c");
        startInfo.ArgumentList.Add(command);
        return startInfo;
    }

    private static bool IsProcessRunning(uint processId)
    {
        try
        {
            using var process = Process.GetProcessById(checked((int)processId));
            return !process.HasExited;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }
}
