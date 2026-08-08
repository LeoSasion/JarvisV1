using System.IO;
using System.Text;
using System.Text.Json;

namespace Jarvis.Host.Infrastructure;

internal sealed record RendererSmokeResult(
    bool ShellReady,
    bool HelpOpened,
    bool HelpClosed,
    bool ExplorerOpened,
    bool AgentOpened,
    bool LinkedWorkspaceReady,
    bool NoticeAvoidsCriticalControls,
    bool ReducedMotionStylesApplied)
{
    public bool Succeeded =>
        ShellReady &&
        HelpOpened &&
        HelpClosed &&
        ExplorerOpened &&
        AgentOpened &&
        LinkedWorkspaceReady &&
        NoticeAvoidsCriticalControls &&
        ReducedMotionStylesApplied;
}

internal static class RendererSmokeReceipt
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public static void Write(
        RendererSmokeOptions options,
        RendererSmokeResult? result,
        bool mainWindowCreated,
        string? error)
    {
        ArgumentNullException.ThrowIfNull(options);

        var receiptDirectory = Path.GetDirectoryName(options.ReceiptPath) ??
                               throw new InvalidDataException("Renderer smoke receipt directory is invalid.");
        Directory.CreateDirectory(receiptDirectory);

        var temporaryPath = options.ReceiptPath + "." + options.Nonce + ".tmp";
        var receipt = new RendererSmokeReceiptModel(
            SchemaVersion: 1,
            Success: result?.Succeeded == true && string.IsNullOrWhiteSpace(error),
            Mode: "renderer-smoke",
            options.Nonce,
            DataRoot: options.DataRoot,
            MainWindowCreated: mainWindowCreated,
            TaskbarTouched: false,
            result,
            Error: string.IsNullOrWhiteSpace(error) ? null : error);
        var payload = JsonSerializer.Serialize(receipt, JsonOptions) + Environment.NewLine;

        try
        {
            if (File.Exists(options.ReceiptPath))
            {
                throw new IOException("Renderer smoke receipt already exists.");
            }

            File.WriteAllText(
                temporaryPath,
                payload,
                new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
            File.Move(temporaryPath, options.ReceiptPath, overwrite: false);
        }
        finally
        {
            if (File.Exists(temporaryPath))
            {
                File.Delete(temporaryPath);
            }
        }
    }

    private sealed record RendererSmokeReceiptModel(
        int SchemaVersion,
        bool Success,
        string Mode,
        string Nonce,
        string DataRoot,
        bool MainWindowCreated,
        bool TaskbarTouched,
        RendererSmokeResult? Result,
        string? Error);
}
