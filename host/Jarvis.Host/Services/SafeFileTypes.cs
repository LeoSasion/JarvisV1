namespace Jarvis.Host.Services;

internal static class SafeFileTypes
{
    private static readonly HashSet<string> OpenableExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".7z", ".avif", ".bmp", ".csv", ".doc", ".docx", ".flac", ".gif", ".heic",
        ".ico", ".jpeg", ".jpg", ".json", ".log", ".m4a", ".md", ".mkv", ".mov",
        ".mp3", ".mp4", ".pdf", ".png", ".ppt", ".pptx", ".rar", ".rtf", ".tsv",
        ".txt", ".wav", ".webm", ".webp", ".xls", ".xlsx", ".xml", ".yaml", ".yml",
        ".zip"
    };

    public static bool IsOpenable(string? extension) =>
        !string.IsNullOrWhiteSpace(extension) && OpenableExtensions.Contains(extension);
}
