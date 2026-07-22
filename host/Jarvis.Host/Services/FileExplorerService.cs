using System.Diagnostics;
using System.IO;
using Jarvis.Host.Bridge;
using RecycleOption = Microsoft.VisualBasic.FileIO.RecycleOption;
using UICancelOption = Microsoft.VisualBasic.FileIO.UICancelOption;
using UIOption = Microsoft.VisualBasic.FileIO.UIOption;
using VisualBasicFileSystem = Microsoft.VisualBasic.FileIO.FileSystem;

namespace Jarvis.Host.Services;

internal sealed class FileExplorerService
{
    private const int MaxPathLength = 1024;
    private const int MaxOperationItems = 128;
    private const int MaxEntryNameLength = 255;
    private const int MaxBrowseEntries = 1000;

    private static readonly HashSet<string> ReservedWindowsNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
    };

    private static readonly HashSet<string> ImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".avif", ".bmp", ".gif", ".heic", ".ico", ".jpeg", ".jpg", ".png", ".webp"
    };

    private static readonly HashSet<string> SpreadsheetExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".csv", ".tsv", ".xls", ".xlsx"
    };

    private static readonly HashSet<string> PresentationExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".ppt", ".pptx"
    };

    private static readonly HashSet<string> ArchiveExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".7z", ".rar", ".zip"
    };

    private static readonly HashSet<string> AudioExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".flac", ".m4a", ".mp3", ".wav"
    };

    private static readonly HashSet<string> VideoExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".mkv", ".mov", ".mp4", ".webm"
    };

    public ExplorerSnapshot Browse(string? requestedPath)
    {
        var path = NormalizeDirectoryPath(requestedPath);
        var entries = new List<ExplorerEntry>();
        string? warning = null;

        try
        {
            foreach (var itemPath in Directory.EnumerateFileSystemEntries(
                         path,
                         "*",
                         SearchOption.TopDirectoryOnly))
            {
                try
                {
                    var attributes = File.GetAttributes(itemPath);
                    if (attributes.HasFlag(FileAttributes.Hidden) ||
                        attributes.HasFlag(FileAttributes.System))
                    {
                        continue;
                    }

                    if (entries.Count >= MaxBrowseEntries)
                    {
                        warning = $"Showing the first {MaxBrowseEntries:N0} items. Narrow this folder before continuing.";
                        break;
                    }

                    entries.Add(CreateEntry(itemPath, attributes));
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    // Individual entries may disappear or become inaccessible while enumerating.
                }
            }
        }
        catch (UnauthorizedAccessException)
        {
            warning = "Windows denied access to this folder.";
        }
        catch (IOException ex)
        {
            warning = ex.Message;
        }

        var orderedEntries = entries
            .OrderByDescending(entry => entry.IsDirectory)
            .ThenBy(entry => entry.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToArray();

        return new ExplorerSnapshot(
            path,
            GetParentPath(path),
            orderedEntries,
            GetLocations(),
            GetDrives(),
            BuildBreadcrumbs(path),
            warning);
    }

    public ExplorerOpenResult OpenFile(string requestedPath)
    {
        var path = NormalizeFilePath(requestedPath);
        var extension = Path.GetExtension(path);
        if (!SafeFileTypes.IsOpenable(extension))
        {
            throw new BridgeFaultException(
                "FILE_TYPE_NOT_ALLOWED",
                "JARVIS Explorer V1 opens documents, media, and archives only. Active content remains blocked.");
        }

        try
        {
            using var process = Process.Start(new ProcessStartInfo
            {
                FileName = path,
                UseShellExecute = true,
                Verb = "open",
                WindowStyle = ProcessWindowStyle.Normal
            });
            return new ExplorerOpenResult(true, path, process?.Id, "file");
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            throw new BridgeFaultException(
                "OPEN_FAILED",
                $"Windows could not open the selected file: {ex.Message}");
        }
    }

    public ExplorerOpenResult OpenInWindows(string requestedPath)
    {
        var path = NormalizeExistingPath(requestedPath);
        var directory = Directory.Exists(path) ? path : Path.GetDirectoryName(path);
        if (string.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory))
        {
            throw new BridgeFaultException("TARGET_NOT_FOUND", "The selected location no longer exists.");
        }

        try
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = "explorer.exe",
                UseShellExecute = false,
                WindowStyle = ProcessWindowStyle.Normal
            };
            startInfo.ArgumentList.Add(directory);
            using var process = Process.Start(startInfo);
            return new ExplorerOpenResult(true, directory, process?.Id, "windows-explorer");
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            throw new BridgeFaultException(
                "OPEN_FAILED",
                $"Windows File Explorer could not open the selected location: {ex.Message}");
        }
    }

    public ExplorerOperationResult CreateFolder(string requestedParentPath, string requestedName)
    {
        var parentPath = NormalizeDirectoryPath(requestedParentPath);
        var name = NormalizeEntryName(requestedName);
        var targetPath = Path.Combine(parentPath, name);
        EnsurePathDoesNotExist(targetPath);

        try
        {
            Directory.CreateDirectory(targetPath);
            return ExplorerOperationResult.Completed(
                "create-folder",
                new ExplorerOperationItem(parentPath, targetPath, name));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new BridgeFaultException(
                "CREATE_FOLDER_FAILED",
                $"Windows could not create the folder: {ex.Message}");
        }
    }

    public ExplorerOperationResult Rename(string requestedPath, string requestedName)
    {
        var sourcePath = NormalizeMutablePath(requestedPath);
        var name = NormalizeEntryName(requestedName);
        var parentPath = Path.GetDirectoryName(sourcePath);
        if (string.IsNullOrWhiteSpace(parentPath))
        {
            throw new BridgeFaultException("TARGET_NOT_ALLOWED", "Drive roots cannot be renamed.");
        }

        var targetPath = Path.Combine(parentPath, name);
        if (sourcePath.Equals(targetPath, StringComparison.Ordinal))
        {
            throw new BridgeFaultException("NAME_UNCHANGED", "The new name matches the current name.");
        }

        if (!sourcePath.Equals(targetPath, StringComparison.OrdinalIgnoreCase))
        {
            EnsurePathDoesNotExist(targetPath);
        }

        try
        {
            if (sourcePath.Equals(targetPath, StringComparison.OrdinalIgnoreCase))
            {
                RenameCaseOnly(sourcePath, targetPath);
            }
            else if (Directory.Exists(sourcePath))
            {
                Directory.Move(sourcePath, targetPath);
            }
            else
            {
                File.Move(sourcePath, targetPath);
            }

            return ExplorerOperationResult.Completed(
                "rename",
                new ExplorerOperationItem(sourcePath, targetPath, name));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new BridgeFaultException(
                "RENAME_FAILED",
                $"Windows could not rename the selected item: {ex.Message}");
        }
    }

    public ExplorerOperationResult Transfer(
        IReadOnlyList<string> requestedPaths,
        string requestedDestinationPath,
        string requestedMode)
    {
        var mode = requestedMode.ToLowerInvariant();
        if (mode is not ("copy" or "move"))
        {
            throw new BridgeFaultException("INVALID_OPERATION", "Transfer mode must be copy or move.");
        }

        var destinationPath = NormalizeDirectoryPath(requestedDestinationPath);
        var sourcePaths = NormalizeOperationPaths(requestedPaths);
        var completed = new List<ExplorerOperationItem>();
        var failures = new List<ExplorerOperationFailure>();

        foreach (var sourcePath in sourcePaths)
        {
            try
            {
                var isDirectory = Directory.Exists(sourcePath);
                if (isDirectory && IsPathWithin(destinationPath, sourcePath))
                {
                    throw new BridgeFaultException(
                        "INVALID_DESTINATION",
                        "A folder cannot be copied or moved into itself or one of its descendants.");
                }

                var sourceParent = Path.GetDirectoryName(sourcePath);
                if (mode == "move" &&
                    sourceParent is not null &&
                    sourceParent.Equals(destinationPath, StringComparison.OrdinalIgnoreCase))
                {
                    completed.Add(new ExplorerOperationItem(
                        sourcePath,
                        sourcePath,
                        Path.GetFileName(sourcePath)));
                    continue;
                }

                var targetPath = CreateUniqueDestinationPath(
                    destinationPath,
                    Path.GetFileName(sourcePath),
                    isDirectory,
                    mode == "copy");

                if (mode == "copy")
                {
                    CopyEntry(sourcePath, targetPath, isDirectory);
                }
                else
                {
                    MoveEntry(sourcePath, targetPath, isDirectory);
                }

                completed.Add(new ExplorerOperationItem(
                    sourcePath,
                    targetPath,
                    Path.GetFileName(targetPath)));
            }
            catch (BridgeFaultException ex)
            {
                failures.Add(new ExplorerOperationFailure(sourcePath, ex.Code, ex.Message));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                failures.Add(new ExplorerOperationFailure(sourcePath, "TRANSFER_FAILED", ex.Message));
            }
        }

        return new ExplorerOperationResult(mode, completed, failures);
    }

    public ExplorerOperationResult Recycle(IReadOnlyList<string> requestedPaths)
    {
        var sourcePaths = NormalizeOperationPaths(requestedPaths);
        var completed = new List<ExplorerOperationItem>();
        var failures = new List<ExplorerOperationFailure>();

        foreach (var sourcePath in sourcePaths)
        {
            try
            {
                if (Directory.Exists(sourcePath))
                {
                    VisualBasicFileSystem.DeleteDirectory(
                        sourcePath,
                        UIOption.OnlyErrorDialogs,
                        RecycleOption.SendToRecycleBin,
                        UICancelOption.ThrowException);
                }
                else
                {
                    VisualBasicFileSystem.DeleteFile(
                        sourcePath,
                        UIOption.OnlyErrorDialogs,
                        RecycleOption.SendToRecycleBin,
                        UICancelOption.ThrowException);
                }

                completed.Add(new ExplorerOperationItem(
                    sourcePath,
                    sourcePath,
                    Path.GetFileName(sourcePath)));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or OperationCanceledException)
            {
                failures.Add(new ExplorerOperationFailure(sourcePath, "RECYCLE_FAILED", ex.Message));
            }
        }

        return new ExplorerOperationResult("recycle", completed, failures);
    }

    private static string NormalizeDirectoryPath(string? requestedPath)
    {
        var path = string.IsNullOrWhiteSpace(requestedPath)
            ? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
            : requestedPath;
        var normalized = NormalizeLocalPath(path);
        if (!Directory.Exists(normalized))
        {
            throw new BridgeFaultException("DIRECTORY_NOT_FOUND", "The requested folder does not exist.");
        }

        var attributes = File.GetAttributes(normalized);
        if (attributes.HasFlag(FileAttributes.ReparsePoint))
        {
            throw new BridgeFaultException(
                "TARGET_NOT_ALLOWED",
                "Linked folders are not traversed directly by JARVIS Explorer V1.");
        }

        return normalized;
    }

    private static string NormalizeMutablePath(string requestedPath)
    {
        var normalized = NormalizeExistingPath(requestedPath);
        var root = Path.GetPathRoot(normalized);
        if (root is not null &&
            (normalized.Equals(root, StringComparison.OrdinalIgnoreCase) ||
             normalized.Equals(Path.TrimEndingDirectorySeparator(root), StringComparison.OrdinalIgnoreCase)))
        {
            throw new BridgeFaultException("TARGET_NOT_ALLOWED", "Drive roots cannot be modified.");
        }

        var attributes = File.GetAttributes(normalized);
        if (attributes.HasFlag(FileAttributes.ReparsePoint))
        {
            throw new BridgeFaultException(
                "TARGET_NOT_ALLOWED",
                "Linked file-system entries cannot be modified by JARVIS Explorer.");
        }

        return normalized;
    }

    private static IReadOnlyList<string> NormalizeOperationPaths(IReadOnlyList<string> requestedPaths)
    {
        if (requestedPaths.Count == 0)
        {
            throw new BridgeFaultException("INVALID_PARAMS", "Select at least one file or folder.");
        }

        if (requestedPaths.Count > MaxOperationItems)
        {
            throw new BridgeFaultException(
                "TOO_MANY_ITEMS",
                $"JARVIS Explorer supports up to {MaxOperationItems} items per operation.");
        }

        return requestedPaths
            .Select(NormalizeMutablePath)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static string NormalizeEntryName(string requestedName)
    {
        var name = requestedName.Trim();
        if (name.Length == 0 || name.Length > MaxEntryNameLength ||
            name is "." or ".." ||
            name.EndsWith(' ') || name.EndsWith('.') ||
            name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 ||
            name.Contains(Path.DirectorySeparatorChar) ||
            name.Contains(Path.AltDirectorySeparatorChar))
        {
            throw new BridgeFaultException(
                "INVALID_NAME",
                "Use a valid Windows file name without trailing spaces or periods.");
        }

        var stem = Path.GetFileNameWithoutExtension(name);
        if (ReservedWindowsNames.Contains(stem))
        {
            throw new BridgeFaultException("INVALID_NAME", "That name is reserved by Windows.");
        }

        return name;
    }

    private static void EnsurePathDoesNotExist(string path)
    {
        if (File.Exists(path) || Directory.Exists(path))
        {
            throw new BridgeFaultException(
                "NAME_CONFLICT",
                "An item with that name already exists in this folder.");
        }
    }

    private static void RenameCaseOnly(string sourcePath, string targetPath)
    {
        var parent = Path.GetDirectoryName(sourcePath)!;
        var temporaryPath = Path.Combine(parent, $".jarvis-rename-{Guid.NewGuid():N}.tmp");
        var isDirectory = Directory.Exists(sourcePath);
        try
        {
            if (isDirectory)
            {
                Directory.Move(sourcePath, temporaryPath);
                Directory.Move(temporaryPath, targetPath);
            }
            else
            {
                File.Move(sourcePath, temporaryPath);
                File.Move(temporaryPath, targetPath);
            }
        }
        catch
        {
            if (Directory.Exists(temporaryPath) && !Directory.Exists(sourcePath))
            {
                Directory.Move(temporaryPath, sourcePath);
            }
            else if (File.Exists(temporaryPath) && !File.Exists(sourcePath))
            {
                File.Move(temporaryPath, sourcePath);
            }

            throw;
        }
    }

    private static string CreateUniqueDestinationPath(
        string destinationDirectory,
        string sourceName,
        bool isDirectory,
        bool isCopy)
    {
        var initialPath = Path.Combine(destinationDirectory, sourceName);
        if (!File.Exists(initialPath) && !Directory.Exists(initialPath))
        {
            return initialPath;
        }

        var extension = isDirectory ? string.Empty : Path.GetExtension(sourceName);
        var stem = isDirectory ? sourceName : Path.GetFileNameWithoutExtension(sourceName);
        var copySuffix = isCopy ? " - Copy" : string.Empty;
        for (var counter = 1; counter <= 10_000; counter++)
        {
            var numericSuffix = counter == 1 ? string.Empty : $" ({counter})";
            var candidate = Path.Combine(
                destinationDirectory,
                $"{stem}{copySuffix}{numericSuffix}{extension}");
            if (!File.Exists(candidate) && !Directory.Exists(candidate))
            {
                return candidate;
            }
        }

        throw new BridgeFaultException(
            "NAME_CONFLICT",
            "JARVIS could not generate a unique destination name.");
    }

    private static void CopyEntry(string sourcePath, string targetPath, bool isDirectory)
    {
        try
        {
            if (isDirectory)
            {
                CopyDirectory(sourcePath, targetPath);
            }
            else
            {
                File.Copy(sourcePath, targetPath, overwrite: false);
            }
        }
        catch
        {
            DeleteCreatedEntry(targetPath);
            throw;
        }
    }

    private static void CopyDirectory(string sourcePath, string targetPath)
    {
        var sourceInfo = new DirectoryInfo(sourcePath);
        if (sourceInfo.Attributes.HasFlag(FileAttributes.ReparsePoint))
        {
            throw new BridgeFaultException(
                "TARGET_NOT_ALLOWED",
                "Linked folders are not copied by JARVIS Explorer.");
        }

        Directory.CreateDirectory(targetPath);
        foreach (var file in sourceInfo.EnumerateFiles())
        {
            if (file.Attributes.HasFlag(FileAttributes.ReparsePoint))
            {
                throw new BridgeFaultException(
                    "TARGET_NOT_ALLOWED",
                    $"Linked file-system entry blocked: {file.Name}");
            }

            file.CopyTo(Path.Combine(targetPath, file.Name), overwrite: false);
        }

        foreach (var directory in sourceInfo.EnumerateDirectories())
        {
            if (directory.Attributes.HasFlag(FileAttributes.ReparsePoint))
            {
                throw new BridgeFaultException(
                    "TARGET_NOT_ALLOWED",
                    $"Linked file-system entry blocked: {directory.Name}");
            }

            CopyDirectory(directory.FullName, Path.Combine(targetPath, directory.Name));
        }
    }

    private static void MoveEntry(string sourcePath, string targetPath, bool isDirectory)
    {
        var sourceRoot = Path.GetPathRoot(sourcePath);
        var targetRoot = Path.GetPathRoot(targetPath);
        if (sourceRoot?.Equals(targetRoot, StringComparison.OrdinalIgnoreCase) != true)
        {
            throw new BridgeFaultException(
                "CROSS_DRIVE_MOVE_NOT_SUPPORTED",
                "Cross-drive cut and paste is not enabled in this safety milestone. Use copy instead.");
        }

        if (isDirectory)
        {
            Directory.Move(sourcePath, targetPath);
        }
        else
        {
            File.Move(sourcePath, targetPath);
        }
    }

    private static void DeleteCreatedEntry(string path)
    {
        try
        {
            if (Directory.Exists(path))
            {
                Directory.Delete(path, recursive: true);
            }
            else if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch
        {
            // Best-effort cleanup only applies to a destination created by this operation.
        }
    }

    private static bool IsPathWithin(string candidatePath, string directoryPath)
    {
        var normalizedDirectory = Path.TrimEndingDirectorySeparator(directoryPath) + Path.DirectorySeparatorChar;
        var normalizedCandidate = Path.TrimEndingDirectorySeparator(candidatePath) + Path.DirectorySeparatorChar;
        return normalizedCandidate.StartsWith(normalizedDirectory, StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizeFilePath(string requestedPath)
    {
        var normalized = NormalizeLocalPath(requestedPath);
        if (!File.Exists(normalized))
        {
            throw new BridgeFaultException("FILE_NOT_FOUND", "The selected file no longer exists.");
        }

        var attributes = File.GetAttributes(normalized);
        if (attributes.HasFlag(FileAttributes.ReparsePoint))
        {
            throw new BridgeFaultException(
                "TARGET_NOT_ALLOWED",
                "Linked file-system entries are not opened directly by JARVIS Explorer V1.");
        }

        return normalized;
    }

    private static string NormalizeExistingPath(string requestedPath)
    {
        var normalized = NormalizeLocalPath(requestedPath);
        if (!File.Exists(normalized) && !Directory.Exists(normalized))
        {
            throw new BridgeFaultException("TARGET_NOT_FOUND", "The selected path no longer exists.");
        }

        return normalized;
    }

    private static string NormalizeLocalPath(string path)
    {
        var trimmed = path.Trim();
        if (trimmed.Length == 0 || trimmed.Length > MaxPathLength ||
            trimmed.IndexOfAny(['\0', '\r', '\n']) >= 0 ||
            !Path.IsPathFullyQualified(trimmed) ||
            trimmed.StartsWith(@"\\", StringComparison.Ordinal) ||
            trimmed.StartsWith(@"\\?\", StringComparison.Ordinal) ||
            trimmed.StartsWith(@"\\.\", StringComparison.Ordinal))
        {
            throw new BridgeFaultException(
                "INVALID_PATH",
                "JARVIS Explorer V1 supports fully qualified local Windows paths only.");
        }

        var normalized = Path.GetFullPath(trimmed);
        var root = Path.GetPathRoot(normalized);
        if (string.IsNullOrWhiteSpace(root))
        {
            throw new BridgeFaultException("INVALID_PATH", "The requested path has no local drive root.");
        }

        var drive = new DriveInfo(root);
        if (drive.DriveType is DriveType.Network or DriveType.CDRom || !drive.IsReady)
        {
            throw new BridgeFaultException(
                "DRIVE_NOT_AVAILABLE",
                "Network, optical, and unavailable drives are outside JARVIS Explorer V1.");
        }

        return normalized.Equals(root, StringComparison.OrdinalIgnoreCase)
            ? root
            : Path.TrimEndingDirectorySeparator(normalized);
    }

    private static ExplorerEntry CreateEntry(string path, FileAttributes attributes)
    {
        var isDirectory = attributes.HasFlag(FileAttributes.Directory);
        var extension = isDirectory ? string.Empty : Path.GetExtension(path);
        var info = isDirectory ? null : new FileInfo(path);
        var modified = isDirectory
            ? new DirectoryInfo(path).LastWriteTime
            : info!.LastWriteTime;

        return new ExplorerEntry(
            Path.GetFileName(path),
            Path.GetFullPath(path),
            isDirectory,
            GetKind(isDirectory, extension),
            GetTypeLabel(isDirectory, extension),
            extension,
            isDirectory ? null : info!.Length,
            new DateTimeOffset(modified),
            attributes.HasFlag(FileAttributes.ReparsePoint));
    }

    private static string GetKind(bool isDirectory, string extension)
    {
        if (isDirectory) return "folder";
        if (ImageExtensions.Contains(extension)) return "image";
        if (SpreadsheetExtensions.Contains(extension)) return "spreadsheet";
        if (PresentationExtensions.Contains(extension)) return "presentation";
        if (ArchiveExtensions.Contains(extension)) return "archive";
        if (AudioExtensions.Contains(extension)) return "audio";
        if (VideoExtensions.Contains(extension)) return "video";
        if (extension.Equals(".pdf", StringComparison.OrdinalIgnoreCase)) return "pdf";
        if (extension is ".json" or ".xml" or ".yaml" or ".yml") return "code";
        return SafeFileTypes.IsOpenable(extension) ? "document" : "file";
    }

    private static string GetTypeLabel(bool isDirectory, string extension)
    {
        if (isDirectory) return "File folder";
        if (string.IsNullOrWhiteSpace(extension)) return "File";

        return extension.ToLowerInvariant() switch
        {
            ".pdf" => "PDF document",
            ".doc" or ".docx" => "Microsoft Word document",
            ".xls" or ".xlsx" => "Microsoft Excel worksheet",
            ".ppt" or ".pptx" => "Microsoft PowerPoint presentation",
            ".jpg" or ".jpeg" or ".png" or ".webp" => "Image",
            ".txt" => "Text document",
            ".md" => "Markdown document",
            ".zip" or ".rar" or ".7z" => "Archive",
            _ => $"{extension.TrimStart('.').ToUpperInvariant()} file"
        };
    }

    private static string? GetParentPath(string path)
    {
        var root = Path.GetPathRoot(path);
        if (root is not null && path.Equals(Path.TrimEndingDirectorySeparator(root), StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        return Directory.GetParent(path)?.FullName;
    }

    private static IReadOnlyList<ExplorerLocation> GetLocations()
    {
        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        return new[]
        {
            CreateLocation("home", "Home", userProfile, "home"),
            CreateLocation("desktop", "Desktop", Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "desktop"),
            CreateLocation("downloads", "Downloads", Path.Combine(userProfile, "Downloads"), "download"),
            CreateLocation("documents", "Documents", Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "document"),
            CreateLocation("pictures", "Pictures", Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "image")
        }.Where(location => Directory.Exists(location.Path)).ToArray();
    }

    private static ExplorerLocation CreateLocation(string id, string label, string path, string kind) =>
        new(id, label, Path.GetFullPath(path), kind);

    private static IReadOnlyList<ExplorerDrive> GetDrives()
    {
        return DriveInfo.GetDrives().Where(drive =>
                drive.IsReady && drive.DriveType is not (DriveType.Network or DriveType.CDRom))
            .Select(drive => new ExplorerDrive(
                drive.Name,
                string.IsNullOrWhiteSpace(drive.VolumeLabel) ? $"Local Disk ({drive.Name.TrimEnd('\\')})" : drive.VolumeLabel,
                drive.Name,
                drive.DriveType.ToString(),
                drive.TotalSize,
                drive.AvailableFreeSpace))
            .ToArray();
    }

    private static IReadOnlyList<ExplorerBreadcrumb> BuildBreadcrumbs(string path)
    {
        var breadcrumbs = new List<ExplorerBreadcrumb>();
        var root = Path.GetPathRoot(path);
        if (string.IsNullOrWhiteSpace(root))
        {
            return breadcrumbs;
        }

        breadcrumbs.Add(new ExplorerBreadcrumb(root.TrimEnd('\\'), root));
        var relative = path[root.Length..];
        var current = root;
        foreach (var segment in relative.Split(
                     Path.DirectorySeparatorChar,
                     StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, segment);
            breadcrumbs.Add(new ExplorerBreadcrumb(segment, current));
        }

        return breadcrumbs;
    }
}

internal sealed record ExplorerSnapshot(
    string CurrentPath,
    string? ParentPath,
    IReadOnlyList<ExplorerEntry> Entries,
    IReadOnlyList<ExplorerLocation> Locations,
    IReadOnlyList<ExplorerDrive> Drives,
    IReadOnlyList<ExplorerBreadcrumb> Breadcrumbs,
    string? Warning);

internal sealed record ExplorerEntry(
    string Name,
    string Path,
    bool IsDirectory,
    string Kind,
    string TypeLabel,
    string Extension,
    long? SizeBytes,
    DateTimeOffset Modified,
    bool IsLinked);

internal sealed record ExplorerLocation(string Id, string Label, string Path, string Kind);

internal sealed record ExplorerDrive(
    string Id,
    string Label,
    string Path,
    string DriveType,
    long TotalBytes,
    long FreeBytes);

internal sealed record ExplorerBreadcrumb(string Label, string Path);

internal sealed record ExplorerOpenResult(bool Opened, string Target, int? ProcessId, string Mode);

internal sealed record ExplorerOperationItem(string Source, string Target, string Name);

internal sealed record ExplorerOperationFailure(string Source, string Code, string Message);

internal sealed record ExplorerOperationResult(
    string Operation,
    IReadOnlyList<ExplorerOperationItem> Items,
    IReadOnlyList<ExplorerOperationFailure> Failures)
{
    public static ExplorerOperationResult Completed(string operation, params ExplorerOperationItem[] items) =>
        new(operation, items, Array.Empty<ExplorerOperationFailure>());
}
