using System.IO;
using System.Text;

namespace Jarvis.Host.Infrastructure;

internal static class HostLog
{
    private const long MaxLogBytes = 4 * 1024 * 1024;

    private static readonly object Gate = new();
    private static readonly string LogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "JARVIS",
        "Logs",
        "jarvis-host.log");
    private static readonly string BackupLogPath = LogPath + ".1";

    public static void Info(string message) => Write("INFO", message, null);

    public static void Warning(string message) => Write("WARN", message, null);

    public static void Error(string message, Exception? exception = null) =>
        Write("ERROR", message, exception);

    private static void Write(string level, string message, Exception? exception)
    {
        try
        {
            var builder = new StringBuilder()
                .Append(DateTimeOffset.Now.ToString("O"))
                .Append(' ')
                .Append(level)
                .Append(' ')
                .Append(message);
            if (exception is not null)
            {
                builder.AppendLine().Append(exception);
            }

            lock (Gate)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
                var payload = builder.AppendLine().ToString();
                RotateIfNeeded(Encoding.UTF8.GetByteCount(payload));
                File.AppendAllText(LogPath, payload, Encoding.UTF8);
            }
        }
        catch
        {
            // Logging must never prevent the shell fallback or application exit.
        }
    }

    private static void RotateIfNeeded(int incomingBytes)
    {
        if (!File.Exists(LogPath) || new FileInfo(LogPath).Length + incomingBytes <= MaxLogBytes)
        {
            return;
        }

        File.Move(LogPath, BackupLogPath, overwrite: true);
    }
}
