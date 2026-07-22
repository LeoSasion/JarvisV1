using System.IO;

namespace Jarvis.Host.Services;

internal sealed class DesktopService
{
    public bool IsListedEntry(string fullPath)
    {
        return ListEntries().Entries.Any(
            entry => entry.Path.Equals(fullPath, StringComparison.OrdinalIgnoreCase));
    }

    public DesktopEntriesResult ListEntries()
    {
        var userDesktopPath = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        var publicDesktopPath = Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory);
        var entries = new List<DesktopEntry>();

        AddEntries(entries, userDesktopPath, "user");
        if (!publicDesktopPath.Equals(userDesktopPath, StringComparison.OrdinalIgnoreCase))
        {
            AddEntries(entries, publicDesktopPath, "public");
        }

        return new DesktopEntriesResult(
            entries
                .DistinctBy(entry => entry.Path, StringComparer.OrdinalIgnoreCase)
                .OrderBy(entry => entry.Source.Equals("user", StringComparison.Ordinal) ? 0 : 1)
                .ThenBy(entry => entry.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToArray(),
            userDesktopPath,
            publicDesktopPath);
    }

    private static void AddEntries(List<DesktopEntry> entries, string desktopPath, string source)
    {
        if (string.IsNullOrWhiteSpace(desktopPath) || !Directory.Exists(desktopPath))
        {
            return;
        }

        try
        {
            foreach (var path in Directory.EnumerateFileSystemEntries(desktopPath, "*", SearchOption.TopDirectoryOnly))
            {
                try
                {
                    var attributes = File.GetAttributes(path);
                    if (attributes.HasFlag(FileAttributes.Hidden) || attributes.HasFlag(FileAttributes.System))
                    {
                        continue;
                    }

                    var isDirectory = attributes.HasFlag(FileAttributes.Directory);
                    var extension = isDirectory ? string.Empty : Path.GetExtension(path);
                    var kind = GetKind(isDirectory, extension);
                    var name = kind is "shortcut" or "url"
                        ? Path.GetFileNameWithoutExtension(path)
                        : Path.GetFileName(path);

                    entries.Add(new DesktopEntry(
                        name,
                        Path.GetFullPath(path),
                        source,
                        kind,
                        extension));
                }
                catch (IOException)
                {
                    // A desktop item can disappear during enumeration.
                }
                catch (UnauthorizedAccessException)
                {
                    // Skip an individual item rather than failing the desktop.
                }
            }
        }
        catch (IOException)
        {
            // The desktop folder can be redirected or temporarily unavailable.
        }
        catch (UnauthorizedAccessException)
        {
            // Return any entries that could be read from the other desktop scope.
        }
    }

    private static string GetKind(bool isDirectory, string extension)
    {
        if (isDirectory)
        {
            return "directory";
        }

        if (extension.Equals(".lnk", StringComparison.OrdinalIgnoreCase))
        {
            return "shortcut";
        }

        return extension.Equals(".url", StringComparison.OrdinalIgnoreCase) ? "url" : "file";
    }
}

internal sealed record DesktopEntriesResult(
    IReadOnlyList<DesktopEntry> Entries,
    string UserDesktopPath,
    string PublicDesktopPath);

internal sealed record DesktopEntry(
    string Name,
    string Path,
    string Source,
    string Kind,
    string Extension);
