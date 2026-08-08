using System.IO;
using System.Text;

namespace Jarvis.Host.Infrastructure;

internal static class HostLog
{
    private const long MaxLogBytes = 4 * 1024 * 1024;

    private static readonly object Gate = new();
    private static string _logPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "JARVIS",
        "Logs",
        "jarvis-host.log");
    private static bool _hasWritten;

    public static void UseIsolatedLogDirectory(string directory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(directory);
        lock (Gate)
        {
            if (_hasWritten)
            {
                throw new InvalidOperationException(
                    "Host log location cannot change after the first write.");
            }

            _logPath = Path.Combine(Path.GetFullPath(directory), "jarvis-host.log");
        }
    }

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
                Directory.CreateDirectory(Path.GetDirectoryName(_logPath)!);
                var payload = builder.AppendLine().ToString();
                RotateIfNeeded(Encoding.UTF8.GetByteCount(payload));
                File.AppendAllText(_logPath, payload, Encoding.UTF8);
                _hasWritten = true;
            }
        }
        catch
        {
            // Logging must never prevent the shell fallback or application exit.
        }
    }

    private static void RotateIfNeeded(int incomingBytes)
    {
        if (!File.Exists(_logPath) || new FileInfo(_logPath).Length + incomingBytes <= MaxLogBytes)
        {
            return;
        }

        File.Move(_logPath, _logPath + ".1", overwrite: true);
    }
}
