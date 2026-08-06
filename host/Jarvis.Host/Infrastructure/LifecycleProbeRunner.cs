using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Jarvis.Host.Agents;
using Microsoft.Web.WebView2.Core;

namespace Jarvis.Host.Infrastructure;

internal static class LifecycleProbeRunner
{
    private const int SuccessExitCode = 0;
    private const int FailureExitCode = 70;

    private static readonly JsonSerializerOptions ReceiptJsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public static async Task<int> RunAsync(LifecycleProbeOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        string? webViewVersion = null;
        var frontendValidated = false;
        var piRuntimeValidated = false;
        try
        {
            Directory.CreateDirectory(options.DataRoot);

            var frontendPath = Path.Combine(AppContext.BaseDirectory, "frontend", "index.html");
            if (!File.Exists(frontendPath))
            {
                throw new InvalidDataException("The packaged frontend entry point is missing.");
            }
            frontendValidated = true;

            webViewVersion = CoreWebView2Environment.GetAvailableBrowserVersionString();
            if (string.IsNullOrWhiteSpace(webViewVersion))
            {
                throw new InvalidOperationException("Microsoft Edge WebView2 Runtime is unavailable.");
            }

            var webViewDataRoot = Path.Combine(options.DataRoot, "WebView2");
            Directory.CreateDirectory(webViewDataRoot);
            _ = await CoreWebView2Environment.CreateAsync(
                    browserExecutableFolder: null,
                    userDataFolder: webViewDataRoot)
                .ConfigureAwait(true);

            var agentOptions = PiAgentOptions.FromEnvironment();
            if (!agentOptions.IsConfigured)
            {
                throw new InvalidDataException(
                    agentOptions.ConfigurationIssue ?? "The packaged Pi runtime is unavailable.");
            }
            using (agentOptions.OpenVerifiedRuntime())
            {
                piRuntimeValidated = true;
            }

            WriteReceiptAtomic(options, new LifecycleProbeReceipt(
                SchemaVersion: 1,
                Success: true,
                Mode: "lifecycle-probe",
                options.Nonce,
                Version: GetProductVersion(),
                ExecutablePath: GetExecutablePath(),
                options.DataRoot,
                WebView2Version: webViewVersion,
                Frontend: "packaged",
                PiRuntimeValidated: true,
                MainWindowCreated: false,
                TaskbarTouched: false,
                Error: null));
            return SuccessExitCode;
        }
        catch (Exception exception)
        {
            TryWriteFailureReceipt(
                options,
                webViewVersion,
                frontendValidated,
                piRuntimeValidated,
                exception);
            return FailureExitCode;
        }
    }

    private static void TryWriteFailureReceipt(
        LifecycleProbeOptions options,
        string? webViewVersion,
        bool frontendValidated,
        bool piRuntimeValidated,
        Exception exception)
    {
        try
        {
            WriteReceiptAtomic(options, new LifecycleProbeReceipt(
                SchemaVersion: 1,
                Success: false,
                Mode: "lifecycle-probe",
                options.Nonce,
                Version: GetProductVersion(),
                ExecutablePath: GetExecutablePath(),
                options.DataRoot,
                WebView2Version: webViewVersion,
                Frontend: frontendValidated ? "packaged" : "missing",
                PiRuntimeValidated: piRuntimeValidated,
                MainWindowCreated: false,
                TaskbarTouched: false,
                Error: exception.GetType().Name));
        }
        catch
        {
            // The process exit code remains authoritative if the isolated receipt cannot be written.
        }
    }

    private static void WriteReceiptAtomic(
        LifecycleProbeOptions options,
        LifecycleProbeReceipt receipt)
    {
        var receiptDirectory = Path.GetDirectoryName(options.ReceiptPath) ??
                               throw new InvalidDataException("Lifecycle receipt directory is invalid.");
        Directory.CreateDirectory(receiptDirectory);

        var temporaryPath = options.ReceiptPath + "." + options.Nonce + ".tmp";
        var payload = JsonSerializer.Serialize(receipt, ReceiptJsonOptions) + Environment.NewLine;
        try
        {
            File.WriteAllText(temporaryPath, payload, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
            File.Move(temporaryPath, options.ReceiptPath, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporaryPath))
            {
                File.Delete(temporaryPath);
            }
        }
    }

    private static string GetProductVersion()
    {
        var informationalVersion = Assembly.GetEntryAssembly()?
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion;
        if (!string.IsNullOrWhiteSpace(informationalVersion))
        {
            return informationalVersion;
        }

        return FileVersionInfo.GetVersionInfo(GetExecutablePath()).ProductVersion ?? "unknown";
    }

    private static string GetExecutablePath() =>
        Path.GetFullPath(Environment.ProcessPath ??
                         throw new InvalidOperationException("The host executable path is unavailable."));

    private sealed record LifecycleProbeReceipt(
        int SchemaVersion,
        bool Success,
        string Mode,
        string Nonce,
        string Version,
        string ExecutablePath,
        string DataRoot,
        string? WebView2Version,
        string Frontend,
        bool PiRuntimeValidated,
        bool MainWindowCreated,
        bool TaskbarTouched,
        string? Error);
}
