using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Jarvis.Host.Agents;

internal sealed record PiAgentOptions(
    string? ExecutablePath,
    PiExecutableIdentity? ExecutableIdentity,
    string AgentDirectory,
    string PackageDirectory,
    string WorkingDirectory,
    string PermissionMode,
    int MaximumJsonLineBytes,
    TimeSpan CommandTimeout,
    TimeSpan AbortTimeout,
    TimeSpan TurnTimeout,
    string? ConfigurationIssue)
{
    private const string AllowExternalEnvironmentVariable = "JARVIS_ALLOW_EXTERNAL_PI_RUNTIME";
    private const string ExecutableEnvironmentVariable = "JARVIS_PI_EXECUTABLE";
    private const string ExecutableSha256EnvironmentVariable = "JARVIS_PI_EXECUTABLE_SHA256";
    private const string RuntimeManifestResourceName = "Jarvis.Host.PiRuntimeManifest.json";

    public bool IsConfigured =>
        ConfigurationIssue is null &&
        ExecutablePath is not null &&
        ExecutableIdentity is not null;

    public static PiAgentOptions FromEnvironment()
    {
        var localRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "JARVIS",
            "PiAgent");

        PiRuntimeManifest trustedManifest;
        try
        {
            trustedManifest = PiRuntimeManifestReader.ReadEmbedded(RuntimeManifestResourceName);
        }
        catch (Exception exception) when (PiRuntimeManifestReader.IsManifestException(exception))
        {
            return CreateUnavailable(localRoot, "The embedded Pi runtime trust manifest is invalid.");
        }

        var bundledDirectory = Path.Combine(AppContext.BaseDirectory, "AgentRuntime");
        if (PiRuntimePathSecurity.EntryExistsOrCannotBeProvedMissing(bundledDirectory))
        {
            return CreateBundled(localRoot, bundledDirectory, trustedManifest);
        }

        return CreateExternalOrUnavailable(localRoot);
    }

    internal PiRuntimeLaunchLease OpenVerifiedRuntime()
    {
        if (!IsConfigured || ExecutablePath is null || ExecutableIdentity is null)
        {
            throw new InvalidOperationException("Pi Agent is not configured.");
        }

        if (ExecutableIdentity.RuntimeTree is not null)
        {
            return PiRuntimeTreeIntegrity.OpenVerified(
                ExecutablePath,
                ExecutableIdentity,
                ExecutableIdentity.RuntimeTree);
        }

        return new PiRuntimeLaunchLease(
            [PiExecutableIntegrity.OpenVerified(ExecutablePath, ExecutableIdentity)]);
    }

    private static PiAgentOptions CreateBundled(
        string localRoot,
        string bundledDirectory,
        PiRuntimeManifest trustedManifest)
    {
        if (!Directory.Exists(bundledDirectory))
        {
            return CreateUnavailable(localRoot, "The bundled Pi Agent runtime root is invalid.");
        }

        var packagedManifestPath = Path.Combine(bundledDirectory, "runtime.json");
        if (!File.Exists(packagedManifestPath))
        {
            return CreateUnavailable(
                localRoot,
                "The bundled Pi Agent runtime manifest is missing.");
        }

        PiRuntimeManifest packagedManifest;
        try
        {
            packagedManifest = PiRuntimeManifestReader.ReadFile(
                packagedManifestPath,
                bundledDirectory);
        }
        catch (Exception exception) when (PiRuntimeManifestReader.IsManifestException(exception))
        {
            return CreateUnavailable(
                localRoot,
                "The bundled Pi Agent runtime manifest is invalid.");
        }

        if (!trustedManifest.MatchesPackagedRuntime(packagedManifest))
        {
            return CreateUnavailable(
                localRoot,
                "The bundled Pi Agent runtime does not match the embedded trust manifest.");
        }

        string executablePath;
        try
        {
            executablePath = ResolveBundledEntryPoint(
                bundledDirectory,
                trustedManifest.Executable.RelativePath);
        }
        catch (Exception exception) when (
            exception is ArgumentException or InvalidDataException or NotSupportedException or PathTooLongException)
        {
            return CreateUnavailable(
                localRoot,
                "The bundled Pi Agent entry point is invalid.");
        }

        if (!File.Exists(executablePath))
        {
            return CreateUnavailable(localRoot, "The bundled Pi Agent executable is missing.");
        }

        try
        {
            PiRuntimePathSecurity.EnsureNoReparsePoints(bundledDirectory, executablePath);
        }
        catch (Exception exception) when (
            exception is IOException or UnauthorizedAccessException or ArgumentException or
            NotSupportedException or PathTooLongException or PiRuntimeIntegrityException)
        {
            return CreateUnavailable(
                localRoot,
                "The bundled Pi Agent runtime contains an unsafe path.");
        }

        return CreateConfigured(
            executablePath,
            new PiExecutableIdentity(
                trustedManifest.Executable.Sha256,
                trustedManifest.Executable.SizeBytes,
                bundledDirectory,
                new PiRuntimeTreeIdentity(
                    trustedManifest.Archive.TreeReceiptFile,
                    trustedManifest.Archive.TreeReceiptBytes,
                    trustedManifest.Archive.TreeSha256,
                    trustedManifest.Archive.FileCount,
                    trustedManifest.Archive.UncompressedBytes,
                    trustedManifest.DocumentSizeBytes,
                    trustedManifest.DocumentSha256)),
            localRoot);
    }

    private static PiAgentOptions CreateExternalOrUnavailable(string localRoot)
    {
        var allowExternal = Environment.GetEnvironmentVariable(AllowExternalEnvironmentVariable);
        var configuredPath = Environment.GetEnvironmentVariable(ExecutableEnvironmentVariable);
        var configuredSha256 = Environment.GetEnvironmentVariable(ExecutableSha256EnvironmentVariable);

        if (!string.Equals(allowExternal, "1", StringComparison.Ordinal))
        {
            if (!string.IsNullOrWhiteSpace(configuredPath) ||
                !string.IsNullOrWhiteSpace(configuredSha256))
            {
                return CreateUnavailable(
                    localRoot,
                    $"External Pi runtimes require {AllowExternalEnvironmentVariable}=1.");
            }

            return CreateUnavailable(localRoot, "Pi Agent is not configured.");
        }

        if (string.IsNullOrWhiteSpace(configuredPath))
        {
            return CreateUnavailable(
                localRoot,
                $"{ExecutableEnvironmentVariable} must contain an absolute native executable path.");
        }

        if (!PiExecutableIntegrity.TryNormalizeSha256(configuredSha256, out var expectedSha256))
        {
            return CreateUnavailable(
                localRoot,
                $"{ExecutableSha256EnvironmentVariable} must contain exactly 64 hexadecimal characters.");
        }

        string fullPath;
        try
        {
            fullPath = ValidateNativeExecutablePath(configuredPath.Trim());
        }
        catch (Exception exception) when (
            exception is ArgumentException or InvalidDataException or NotSupportedException or PathTooLongException)
        {
            return CreateUnavailable(
                localRoot,
                $"{ExecutableEnvironmentVariable} must contain an absolute path to a native .exe file.");
        }

        if (!File.Exists(fullPath))
        {
            return CreateUnavailable(
                localRoot,
                $"The configured Pi Agent executable does not exist: {fullPath}");
        }

        return CreateConfigured(
            fullPath,
            new PiExecutableIdentity(expectedSha256, SizeBytes: null),
            localRoot);
    }

    private static PiAgentOptions CreateConfigured(
        string executablePath,
        PiExecutableIdentity executableIdentity,
        string localRoot) =>
        new(
            ExecutablePath: executablePath,
            ExecutableIdentity: executableIdentity,
            AgentDirectory: localRoot,
            PackageDirectory: Path.Combine(localRoot, "Packages"),
            WorkingDirectory: Path.Combine(localRoot, "Runtime"),
            PermissionMode: "chat-only",
            MaximumJsonLineBytes: 1024 * 1024,
            CommandTimeout: TimeSpan.FromSeconds(6),
            AbortTimeout: TimeSpan.FromSeconds(2),
            TurnTimeout: TimeSpan.FromMinutes(5),
            ConfigurationIssue: null);

    private static PiAgentOptions CreateUnavailable(string localRoot, string issue) =>
        new(
            ExecutablePath: null,
            ExecutableIdentity: null,
            AgentDirectory: localRoot,
            PackageDirectory: Path.Combine(localRoot, "Packages"),
            WorkingDirectory: Path.Combine(localRoot, "Runtime"),
            PermissionMode: "chat-only",
            MaximumJsonLineBytes: 1024 * 1024,
            CommandTimeout: TimeSpan.FromSeconds(6),
            AbortTimeout: TimeSpan.FromSeconds(2),
            TurnTimeout: TimeSpan.FromMinutes(5),
            ConfigurationIssue: issue);

    private static string ResolveBundledEntryPoint(string bundledDirectory, string entryPoint)
    {
        if (string.IsNullOrWhiteSpace(entryPoint) || Path.IsPathFullyQualified(entryPoint))
        {
            throw new InvalidDataException("The Pi runtime entry point must be relative.");
        }

        var root = Path.GetFullPath(bundledDirectory)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var candidate = Path.GetFullPath(Path.Combine(root, entryPoint));
        var rootPrefix = root + Path.DirectorySeparatorChar;
        if (!candidate.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("The Pi runtime entry point escapes AgentRuntime.");
        }

        if (!Path.GetExtension(candidate).Equals(".exe", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("The Pi runtime entry point must be a native .exe file.");
        }

        return candidate;
    }

    private static string ValidateNativeExecutablePath(string executablePath)
    {
        if (!Path.IsPathFullyQualified(executablePath))
        {
            throw new InvalidDataException("The Pi executable path must be absolute.");
        }

        var fullPath = Path.GetFullPath(executablePath);
        if (!Path.GetExtension(fullPath).Equals(".exe", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("The Pi executable path must identify a native .exe file.");
        }

        return fullPath;
    }
}

internal sealed record PiExecutableIdentity(
    string Sha256,
    long? SizeBytes,
    string? TrustedRootDirectory = null,
    PiRuntimeTreeIdentity? RuntimeTree = null);

internal sealed record PiRuntimeTreeIdentity(
    string ReceiptRelativePath,
    long ReceiptSizeBytes,
    string ReceiptSha256,
    int FileCount,
    long UpstreamBytes,
    long ManifestSizeBytes,
    string ManifestSha256);

internal static class PiExecutableIntegrity
{
    public static bool TryNormalizeSha256(string? value, out string normalized)
    {
        normalized = string.Empty;
        if (value is null || value.Length != 64)
        {
            return false;
        }

        foreach (var character in value)
        {
            var isAsciiHex =
                (character >= '0' && character <= '9') ||
                (character >= 'a' && character <= 'f') ||
                (character >= 'A' && character <= 'F');
            if (!isAsciiHex)
            {
                return false;
            }
        }

        normalized = value.ToLowerInvariant();
        return true;
    }

    public static FileStream OpenVerified(string executablePath, PiExecutableIdentity expected)
    {
        FileStream? stream = null;
        try
        {
            if (expected.TrustedRootDirectory is not null)
            {
                PiRuntimePathSecurity.EnsureNoReparsePoints(
                    expected.TrustedRootDirectory,
                    executablePath);
            }
            else
            {
                PiRuntimePathSecurity.EnsureLeafIsNotReparsePoint(executablePath);
            }

            stream = new FileStream(
                executablePath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                bufferSize: 128 * 1024,
                FileOptions.SequentialScan);

            if (expected.SizeBytes is long expectedSize && stream.Length != expectedSize)
            {
                throw new PiRuntimeIntegrityException(
                    "The Pi Agent executable size does not match its trusted manifest.");
            }

            var actualHash = SHA256.HashData(stream);
            var expectedHash = Convert.FromHexString(expected.Sha256);
            if (!CryptographicOperations.FixedTimeEquals(actualHash, expectedHash))
            {
                throw new PiRuntimeIntegrityException(
                    "The Pi Agent executable hash does not match its trusted manifest.");
            }

            stream.Position = 0;
            var verified = stream;
            stream = null;
            return verified;
        }
        catch (FormatException exception)
        {
            throw new PiRuntimeIntegrityException(
                "The trusted Pi Agent executable hash is invalid.",
                exception);
        }
        finally
        {
            stream?.Dispose();
        }
    }
}

internal sealed class PiRuntimeLaunchLease : IDisposable
{
    private readonly IDisposable[] _leases;
    private bool _disposed;

    public PiRuntimeLaunchLease(IEnumerable<IDisposable> leases)
    {
        _leases = leases.ToArray();
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        for (var index = _leases.Length - 1; index >= 0; index--)
        {
            _leases[index].Dispose();
        }
    }
}

internal static class PiRuntimeTreeIntegrity
{
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);
    private static readonly HashSet<string> JarvisOwnedFiles = new(StringComparer.Ordinal)
    {
        "runtime.json",
        "LICENSE-Pi.txt",
        "PROVENANCE.txt",
        "RUNTIME-SHA256SUMS.txt"
    };
    private static readonly HashSet<string> JarvisOwnedFilesIgnoreCase = new(
        JarvisOwnedFiles,
        StringComparer.OrdinalIgnoreCase);

    public static PiRuntimeLaunchLease OpenVerified(
        string executablePath,
        PiExecutableIdentity executableIdentity,
        PiRuntimeTreeIdentity treeIdentity)
    {
        var runtimeRoot = executableIdentity.TrustedRootDirectory
            ?? throw new PiRuntimeIntegrityException("The bundled Pi runtime root is missing.");
        var receiptPath = PiRuntimePathSecurity.ResolveContainedRelativePath(
            runtimeRoot,
            treeIdentity.ReceiptRelativePath);

        FileStream? receiptLease = null;
        var upstreamLeases = new List<FileStream>(treeIdentity.FileCount);
        var executableVerified = false;
        try
        {
            PiRuntimePathSecurity.EnsureNoReparsePoints(runtimeRoot, receiptPath);
            receiptLease = OpenReadLease(receiptPath);
            if (receiptLease.Length != treeIdentity.ReceiptSizeBytes ||
                receiptLease.Length > int.MaxValue)
            {
                throw new PiRuntimeIntegrityException(
                    "The Pi runtime tree receipt size does not match its trusted manifest.");
            }

            var receiptBytes = new byte[checked((int)receiptLease.Length)];
            receiptLease.ReadExactly(receiptBytes);
            if (!HashMatches(receiptBytes, treeIdentity.ReceiptSha256))
            {
                throw new PiRuntimeIntegrityException(
                    "The Pi runtime tree receipt hash does not match its trusted manifest.");
            }
            receiptLease.Position = 0;

            VerifyTrustedManifestFile(runtimeRoot, treeIdentity);

            var entries = ParseReceipt(receiptBytes, treeIdentity.FileCount);
            var executableRelativePath = Path.GetRelativePath(runtimeRoot, executablePath)
                .Replace(Path.DirectorySeparatorChar, '/');
            if (!entries.TryGetValue(executableRelativePath, out var executableReceiptHash) ||
                !executableReceiptHash.Equals(executableIdentity.Sha256, StringComparison.Ordinal))
            {
                throw new PiRuntimeIntegrityException(
                    "The Pi runtime receipt does not contain the trusted executable identity.");
            }

            long verifiedUpstreamBytes = 0;
            foreach (var entry in entries)
            {
                var fullPath = PiRuntimePathSecurity.ResolveContainedRelativePath(
                    runtimeRoot,
                    entry.Key);
                PiRuntimePathSecurity.EnsureNoReparsePoints(runtimeRoot, fullPath);

                var stream = OpenReadLease(fullPath);
                try
                {
                    verifiedUpstreamBytes = checked(verifiedUpstreamBytes + stream.Length);
                    if (entry.Key.Equals(executableRelativePath, StringComparison.Ordinal) &&
                        executableIdentity.SizeBytes is long executableSize &&
                        stream.Length != executableSize)
                    {
                        throw new PiRuntimeIntegrityException(
                            "The Pi Agent executable size does not match its trusted manifest.");
                    }

                    var actualHash = SHA256.HashData(stream);
                    var expectedHash = Convert.FromHexString(entry.Value);
                    if (!CryptographicOperations.FixedTimeEquals(actualHash, expectedHash))
                    {
                        throw new PiRuntimeIntegrityException(
                            $"Pi runtime file '{entry.Key}' failed integrity verification.");
                    }

                    if (entry.Key.Equals(executableRelativePath, StringComparison.Ordinal))
                    {
                        executableVerified = true;
                    }
                    stream.Position = 0;
                    upstreamLeases.Add(stream);
                    stream = null;
                }
                finally
                {
                    stream?.Dispose();
                }
            }

            if (verifiedUpstreamBytes != treeIdentity.UpstreamBytes)
            {
                throw new PiRuntimeIntegrityException(
                    "The Pi runtime tree size does not match its trusted manifest.");
            }

            if (!executableVerified)
            {
                throw new PiRuntimeIntegrityException(
                    "The trusted Pi Agent executable was not verified.");
            }

            VerifyRuntimeFileSet(runtimeRoot, entries.Keys, treeIdentity.ReceiptRelativePath);

            var verifiedReceipt = receiptLease ?? throw new PiRuntimeIntegrityException(
                "The Pi runtime receipt was not verified.");
            var verifiedLeases = new List<IDisposable>(upstreamLeases.Count + 1)
            {
                verifiedReceipt
            };
            verifiedLeases.AddRange(upstreamLeases);
            receiptLease = null;
            upstreamLeases.Clear();
            return new PiRuntimeLaunchLease(verifiedLeases);
        }
        catch (FormatException exception)
        {
            throw new PiRuntimeIntegrityException(
                "The Pi runtime receipt contains an invalid SHA-256 value.",
                exception);
        }
        catch (DecoderFallbackException exception)
        {
            throw new PiRuntimeIntegrityException(
                "The Pi runtime receipt is not valid UTF-8.",
                exception);
        }
        finally
        {
            foreach (var lease in upstreamLeases)
            {
                lease.Dispose();
            }
            receiptLease?.Dispose();
        }
    }

    internal static IReadOnlyDictionary<string, string> ParseReceipt(
        ReadOnlySpan<byte> receiptBytes,
        int expectedFileCount)
    {
        var hasUtf8Bom = receiptBytes.Length >= 3 &&
            receiptBytes[0] == 0xef &&
            receiptBytes[1] == 0xbb &&
            receiptBytes[2] == 0xbf;
        if (receiptBytes.Length == 0 || receiptBytes[^1] != (byte)'\n' ||
            receiptBytes.IndexOf((byte)'\r') >= 0 || hasUtf8Bom)
        {
            throw new PiRuntimeIntegrityException(
                "The Pi runtime receipt must be UTF-8 without BOM and use LF records.");
        }

        var text = StrictUtf8.GetString(receiptBytes);
        var lines = text.Split('\n');
        if (lines[^1].Length != 0)
        {
            throw new PiRuntimeIntegrityException("The Pi runtime receipt is not LF terminated.");
        }

        var entries = new Dictionary<string, string>(StringComparer.Ordinal);
        var caseInsensitivePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        string? previousPath = null;
        for (var index = 0; index < lines.Length - 1; index++)
        {
            var line = lines[index];
            if (line.Length < 67 || line[64] != ' ' || line[65] != ' ')
            {
                throw new PiRuntimeIntegrityException(
                    "The Pi runtime receipt contains a malformed record.");
            }

            var hash = line[..64];
            if (!PiExecutableIntegrity.TryNormalizeSha256(hash, out var normalizedHash) ||
                !hash.Equals(normalizedHash, StringComparison.Ordinal))
            {
                throw new PiRuntimeIntegrityException(
                    "The Pi runtime receipt hash must be lowercase SHA-256.");
            }

            var relativePath = line[66..];
            ValidateReceiptRelativePath(relativePath);
            if (JarvisOwnedFilesIgnoreCase.Contains(relativePath))
            {
                throw new PiRuntimeIntegrityException(
                    "The Pi runtime receipt cannot claim a JARVIS-owned metadata file.");
            }
            if (previousPath is not null &&
                StringComparer.Ordinal.Compare(previousPath, relativePath) >= 0)
            {
                throw new PiRuntimeIntegrityException(
                    "The Pi runtime receipt paths must be unique and ordinally sorted.");
            }
            if (!caseInsensitivePaths.Add(relativePath) ||
                !entries.TryAdd(relativePath, normalizedHash))
            {
                throw new PiRuntimeIntegrityException(
                    "The Pi runtime receipt contains duplicate Windows paths.");
            }

            previousPath = relativePath;
        }

        if (entries.Count != expectedFileCount)
        {
            throw new PiRuntimeIntegrityException(
                "The Pi runtime receipt file count does not match its trusted manifest.");
        }

        return entries;
    }

    private static void VerifyRuntimeFileSet(
        string runtimeRoot,
        IEnumerable<string> receiptPaths,
        string receiptRelativePath)
    {
        var expectedUpstreamFiles = new HashSet<string>(receiptPaths, StringComparer.Ordinal);
        var actualFiles = EnumerateRuntimeFiles(runtimeRoot);
        foreach (var requiredFile in JarvisOwnedFiles)
        {
            if (!actualFiles.Contains(requiredFile))
            {
                throw new PiRuntimeIntegrityException(
                    $"The bundled Pi runtime metadata file '{requiredFile}' is missing.");
            }
        }
        if (!receiptRelativePath.Equals("RUNTIME-SHA256SUMS.txt", StringComparison.Ordinal))
        {
            throw new PiRuntimeIntegrityException(
                "The bundled Pi runtime receipt name is unsupported.");
        }

        foreach (var actualPath in actualFiles)
        {
            if (!expectedUpstreamFiles.Contains(actualPath) &&
                !JarvisOwnedFiles.Contains(actualPath))
            {
                throw new PiRuntimeIntegrityException(
                    $"The bundled Pi runtime contains unexpected file '{actualPath}'.");
            }
        }
    }

    private static void VerifyTrustedManifestFile(
        string runtimeRoot,
        PiRuntimeTreeIdentity treeIdentity)
    {
        var manifestPath = PiRuntimePathSecurity.ResolveContainedRelativePath(
            runtimeRoot,
            "runtime.json");
        PiRuntimePathSecurity.EnsureNoReparsePoints(runtimeRoot, manifestPath);
        using var stream = OpenReadLease(manifestPath);
        if (stream.Length != treeIdentity.ManifestSizeBytes)
        {
            throw new PiRuntimeIntegrityException(
                "The packaged Pi runtime manifest size changed after validation.");
        }

        var actualHash = SHA256.HashData(stream);
        var expectedHash = Convert.FromHexString(treeIdentity.ManifestSha256);
        if (!CryptographicOperations.FixedTimeEquals(actualHash, expectedHash))
        {
            throw new PiRuntimeIntegrityException(
                "The packaged Pi runtime manifest changed after validation.");
        }
    }

    private static HashSet<string> EnumerateRuntimeFiles(string runtimeRoot)
    {
        var files = new HashSet<string>(StringComparer.Ordinal);
        var pathsIgnoreCase = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var pendingDirectories = new Stack<string>();
        PiRuntimePathSecurity.EnsureLeafIsNotReparsePoint(runtimeRoot);
        pendingDirectories.Push(runtimeRoot);

        while (pendingDirectories.Count > 0)
        {
            var directory = pendingDirectories.Pop();
            foreach (var entry in Directory.EnumerateFileSystemEntries(directory))
            {
                PiRuntimePathSecurity.EnsureLeafIsNotReparsePoint(entry);
                var attributes = File.GetAttributes(entry);
                if ((attributes & FileAttributes.Directory) != 0)
                {
                    pendingDirectories.Push(entry);
                    continue;
                }

                var relativePath = Path.GetRelativePath(runtimeRoot, entry)
                    .Replace(Path.DirectorySeparatorChar, '/');
                ValidateReceiptRelativePath(relativePath);
                if (!files.Add(relativePath) || !pathsIgnoreCase.Add(relativePath))
                {
                    throw new PiRuntimeIntegrityException(
                        "The Pi runtime contains duplicate Windows paths.");
                }
            }
        }

        return files;
    }

    private static void ValidateReceiptRelativePath(string relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath) ||
            relativePath.StartsWith("/", StringComparison.Ordinal) ||
            relativePath.EndsWith("/", StringComparison.Ordinal) ||
            relativePath.Contains('\\'))
        {
            throw new PiRuntimeIntegrityException(
                "The Pi runtime receipt contains an unsafe relative path.");
        }

        foreach (var component in relativePath.Split('/'))
        {
            if (component.Length == 0 || component is "." or ".." ||
                component.EndsWith(' ') || component.EndsWith('.') ||
                component.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 ||
                IsReservedWindowsName(component))
            {
                throw new PiRuntimeIntegrityException(
                    "The Pi runtime receipt contains an unsafe Windows path.");
            }
        }
    }

    private static bool IsReservedWindowsName(string component)
    {
        var stem = component.Split('.')[0];
        if (stem.Equals("CON", StringComparison.OrdinalIgnoreCase) ||
            stem.Equals("PRN", StringComparison.OrdinalIgnoreCase) ||
            stem.Equals("AUX", StringComparison.OrdinalIgnoreCase) ||
            stem.Equals("NUL", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (stem.Length == 4 &&
            (stem.StartsWith("COM", StringComparison.OrdinalIgnoreCase) ||
             stem.StartsWith("LPT", StringComparison.OrdinalIgnoreCase)) &&
            stem[3] is >= '1' and <= '9')
        {
            return true;
        }

        return false;
    }

    private static FileStream OpenReadLease(string path) =>
        new(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 128 * 1024,
            FileOptions.SequentialScan);

    private static bool HashMatches(ReadOnlySpan<byte> bytes, string expectedSha256)
    {
        var actualHash = SHA256.HashData(bytes);
        var expectedHash = Convert.FromHexString(expectedSha256);
        return CryptographicOperations.FixedTimeEquals(actualHash, expectedHash);
    }
}

internal static class PiRuntimePathSecurity
{
    public static bool EntryExistsOrCannotBeProvedMissing(string path)
    {
        try
        {
            _ = File.GetAttributes(path);
            return true;
        }
        catch (FileNotFoundException)
        {
            try
            {
                return new DirectoryInfo(path).LinkTarget is not null;
            }
            catch (Exception exception) when (
                exception is IOException or UnauthorizedAccessException or NotSupportedException)
            {
                return true;
            }
        }
        catch (DirectoryNotFoundException)
        {
            return false;
        }
        catch (Exception exception) when (
            exception is IOException or UnauthorizedAccessException or NotSupportedException)
        {
            return true;
        }
    }

    public static string ResolveContainedRelativePath(string trustedRoot, string relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath) || Path.IsPathFullyQualified(relativePath))
        {
            throw new PiRuntimeIntegrityException(
                "The Pi runtime path must be relative to its trusted root.");
        }

        var root = Path.GetFullPath(trustedRoot)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var candidate = Path.GetFullPath(Path.Combine(root, relativePath));
        var rootPrefix = root + Path.DirectorySeparatorChar;
        if (!candidate.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
        {
            throw new PiRuntimeIntegrityException(
                "The Pi runtime path escapes its trusted root.");
        }

        return candidate;
    }

    public static void EnsureNoReparsePoints(string trustedRoot, string targetPath)
    {
        var root = Path.GetFullPath(trustedRoot)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var target = Path.GetFullPath(targetPath);
        var rootPrefix = root + Path.DirectorySeparatorChar;
        if (!target.Equals(root, StringComparison.OrdinalIgnoreCase) &&
            !target.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
        {
            throw new PiRuntimeIntegrityException(
                "The Pi Agent runtime path escapes its trusted root.");
        }

        EnsureLeafIsNotReparsePoint(root);
        if (target.Equals(root, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        var relative = Path.GetRelativePath(root, target);
        var current = root;
        foreach (var component in relative.Split(
                     [Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar],
                     StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, component);
            EnsureLeafIsNotReparsePoint(current);
        }
    }

    public static void EnsureLeafIsNotReparsePoint(string path)
    {
        var attributes = File.GetAttributes(path);
        if ((attributes & FileAttributes.ReparsePoint) != 0)
        {
            throw new PiRuntimeIntegrityException(
                "The Pi Agent runtime cannot contain symbolic links, junctions, or reparse points.");
        }
    }
}

internal sealed class PiRuntimeIntegrityException : InvalidOperationException
{
    public PiRuntimeIntegrityException(string message)
        : base(message)
    {
    }

    public PiRuntimeIntegrityException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}

internal sealed record PiRuntimeManifest(
    int SchemaVersion,
    string Id,
    string Version,
    string Runtime,
    string Architecture,
    string SourceRepository,
    string SourceRevision,
    string SourceCommit,
    string SourcePackage,
    PiRuntimeArchive Archive,
    PiRuntimeExecutable Executable,
    PiRuntimePolicies Policies,
    long DocumentSizeBytes,
    string DocumentSha256)
{
    public bool MatchesPackagedRuntime(PiRuntimeManifest packaged) =>
        SchemaVersion == packaged.SchemaVersion &&
        string.Equals(Id, packaged.Id, StringComparison.Ordinal) &&
        string.Equals(Version, packaged.Version, StringComparison.Ordinal) &&
        string.Equals(Runtime, packaged.Runtime, StringComparison.Ordinal) &&
        string.Equals(Architecture, packaged.Architecture, StringComparison.Ordinal) &&
        string.Equals(SourceRepository, packaged.SourceRepository, StringComparison.Ordinal) &&
        string.Equals(SourceRevision, packaged.SourceRevision, StringComparison.Ordinal) &&
        string.Equals(SourceCommit, packaged.SourceCommit, StringComparison.Ordinal) &&
        string.Equals(SourcePackage, packaged.SourcePackage, StringComparison.Ordinal) &&
        Archive == packaged.Archive &&
        string.Equals(Executable.RelativePath, packaged.Executable.RelativePath, StringComparison.Ordinal) &&
        Executable.SizeBytes == packaged.Executable.SizeBytes &&
        string.Equals(Executable.Sha256, packaged.Executable.Sha256, StringComparison.Ordinal) &&
        Policies == packaged.Policies &&
        DocumentSizeBytes == packaged.DocumentSizeBytes &&
        string.Equals(DocumentSha256, packaged.DocumentSha256, StringComparison.Ordinal);
}

internal sealed record PiRuntimeArchive(
    int FileCount,
    long UncompressedBytes,
    string TreeReceiptFile,
    long TreeReceiptBytes,
    string TreeSha256);

internal sealed record PiRuntimeExecutable(
    string RelativePath,
    long SizeBytes,
    string Sha256);

internal sealed record PiRuntimePolicies(
    string Extraction,
    string PermissionMode,
    bool AutoUpdate,
    string RpcProtocol);

internal static class PiRuntimeManifestReader
{
    private const int MaximumManifestBytes = 256 * 1024;

    public static PiRuntimeManifest ReadEmbedded(string resourceName)
    {
        using var stream = typeof(PiAgentOptions).Assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidDataException("The Pi runtime trust manifest resource is missing.");
        return Read(stream, resourceName);
    }

    public static PiRuntimeManifest ReadFile(string path, string trustedRoot)
    {
        PiRuntimePathSecurity.EnsureNoReparsePoints(trustedRoot, path);

        using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 16 * 1024,
            FileOptions.SequentialScan);
        return Read(stream, path);
    }

    public static bool IsManifestException(Exception exception) =>
        exception is IOException or UnauthorizedAccessException or InvalidDataException or
        JsonException or ArgumentException or NotSupportedException or PathTooLongException or
        PiRuntimeIntegrityException;

    private static PiRuntimeManifest Read(Stream stream, string source)
    {
        if (stream.CanSeek && stream.Length > MaximumManifestBytes)
        {
            throw new InvalidDataException("The Pi runtime manifest exceeds its size limit.");
        }

        using var manifestBuffer = new MemoryStream();
        stream.CopyTo(manifestBuffer);
        if (manifestBuffer.Length == 0 || manifestBuffer.Length > MaximumManifestBytes)
        {
            throw new InvalidDataException("The Pi runtime manifest size is invalid.");
        }
        var manifestBytes = manifestBuffer.ToArray();
        var documentSha256 = Convert.ToHexString(SHA256.HashData(manifestBytes))
            .ToLowerInvariant();

        using var document = JsonDocument.Parse(
            manifestBytes,
            new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 32
            });
        EnsureNoDuplicateProperties(document.RootElement);

        var root = RequireObject(document.RootElement, source);
        var schemaVersion = RequireInt32(root, "schemaVersion");
        if (schemaVersion != 1)
        {
            throw new InvalidDataException("The Pi runtime manifest schema is unsupported.");
        }

        var id = RequireNonEmptyString(root, "id");
        var version = RequireNonEmptyString(root, "version");
        var runtimeName = RequireNonEmptyString(root, "runtime");
        if (!runtimeName.Equals(WindowsX64RuntimeName, StringComparison.Ordinal))
        {
            throw new InvalidDataException("The bundled Pi runtime must target win-x64.");
        }

        var architecture = RequireNonEmptyString(root, "architecture");
        if (!architecture.Equals("x64", StringComparison.Ordinal))
        {
            throw new InvalidDataException("The bundled Pi runtime architecture must be x64.");
        }

        var sourceManifest = RequireObjectProperty(root, "source");
        var sourceRepository = RequireNonEmptyString(sourceManifest, "repository");
        var sourceRevision = RequireNonEmptyString(sourceManifest, "revision");
        var sourceCommit = RequireLowerHex(sourceManifest, "commit", 40);
        var sourcePackage = RequireNonEmptyString(sourceManifest, "package");

        var archiveManifest = RequireObjectProperty(root, "archive");
        var fileCount = RequireInt32(archiveManifest, "fileCount");
        var uncompressedBytes = RequireInt64(archiveManifest, "uncompressedBytes");
        var treeReceiptFile = RequireNonEmptyString(archiveManifest, "treeReceiptFile");
        var treeReceiptBytes = RequireInt64(archiveManifest, "treeReceiptBytes");
        var treeSha256 = RequireSha256(archiveManifest, "treeSha256");
        if (fileCount <= 0 || uncompressedBytes <= 0 ||
            treeReceiptBytes <= 0 || treeReceiptBytes > MaximumManifestBytes)
        {
            throw new InvalidDataException("The Pi runtime tree receipt limits are invalid.");
        }

        var executableManifest = RequireObjectProperty(root, "executable");
        var relativePath = RequireNonEmptyString(executableManifest, "relativePath");
        var executableSizeBytes = RequireInt64(executableManifest, "sizeBytes");
        if (executableSizeBytes <= 0)
        {
            throw new InvalidDataException("The Pi runtime entry-point size must be positive.");
        }

        var executableSha256 = RequireSha256(executableManifest, "sha256");
        var peMachine = RequireNonEmptyString(executableManifest, "peMachine");
        if (!peMachine.Equals("amd64", StringComparison.Ordinal))
        {
            throw new InvalidDataException("The bundled Pi executable must target amd64.");
        }

        var policiesManifest = RequireObjectProperty(root, "policies");
        var extraction = RequireNonEmptyString(policiesManifest, "extraction");
        var permissionMode = RequireNonEmptyString(policiesManifest, "permissionMode");
        var autoUpdate = RequireBoolean(policiesManifest, "autoUpdate");
        var rpcProtocol = RequireNonEmptyString(policiesManifest, "rpcProtocol");
        if (!extraction.Equals("full-archive", StringComparison.Ordinal) ||
            !permissionMode.Equals("chat-only", StringComparison.Ordinal) ||
            autoUpdate ||
            !rpcProtocol.Equals("jsonl-stdin-stdout", StringComparison.Ordinal))
        {
            throw new InvalidDataException("The bundled Pi runtime policy is unsupported.");
        }

        var limitsManifest = RequireObjectProperty(root, "limits");
        var maxEntries = RequireInt32(limitsManifest, "maxEntries");
        var maxUncompressedBytes = RequireInt64(limitsManifest, "maxUncompressedBytes");
        var maxSingleEntryBytes = RequireInt64(limitsManifest, "maxSingleEntryBytes");
        if (maxEntries <= 0 || maxUncompressedBytes <= 0 || maxSingleEntryBytes <= 0 ||
            fileCount > maxEntries || uncompressedBytes > maxUncompressedBytes ||
            executableSizeBytes > maxSingleEntryBytes)
        {
            throw new InvalidDataException("The Pi runtime manifest exceeds its extraction limits.");
        }

        return new PiRuntimeManifest(
            schemaVersion,
            id,
            version,
            runtimeName,
            architecture,
            sourceRepository,
            sourceRevision,
            sourceCommit,
            sourcePackage,
            new PiRuntimeArchive(
                fileCount,
                uncompressedBytes,
                treeReceiptFile,
                treeReceiptBytes,
                treeSha256),
            new PiRuntimeExecutable(
                relativePath,
                executableSizeBytes,
                executableSha256),
            new PiRuntimePolicies(
                extraction,
                permissionMode,
                autoUpdate,
                rpcProtocol),
            manifestBytes.LongLength,
            documentSha256);
    }

    private const string WindowsX64RuntimeName = "win-x64";

    private static JsonElement RequireObject(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException($"Pi runtime manifest '{name}' must be an object.");
        }

        return element;
    }

    private static JsonElement RequireObjectProperty(JsonElement parent, string name)
    {
        if (!parent.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException($"Pi runtime manifest property '{name}' must be an object.");
        }

        return value;
    }

    private static string RequireNonEmptyString(JsonElement parent, string name)
    {
        if (!parent.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String)
        {
            throw new InvalidDataException($"Pi runtime manifest property '{name}' must be a string.");
        }

        var result = value.GetString();
        if (string.IsNullOrWhiteSpace(result))
        {
            throw new InvalidDataException($"Pi runtime manifest property '{name}' cannot be empty.");
        }

        return result;
    }

    private static string RequireLowerHex(JsonElement parent, string name, int length)
    {
        var value = RequireNonEmptyString(parent, name);
        if (value.Length != length || value.Any(character =>
                !((character >= '0' && character <= '9') ||
                  (character >= 'a' && character <= 'f'))))
        {
            throw new InvalidDataException(
                $"Pi runtime manifest property '{name}' must be lowercase hexadecimal.");
        }

        return value;
    }

    private static string RequireSha256(JsonElement parent, string name)
    {
        var value = RequireNonEmptyString(parent, name);
        if (!PiExecutableIntegrity.TryNormalizeSha256(value, out var normalized) ||
            !value.Equals(normalized, StringComparison.Ordinal))
        {
            throw new InvalidDataException(
                $"Pi runtime manifest property '{name}' must be lowercase SHA-256.");
        }

        return normalized;
    }

    private static bool RequireBoolean(JsonElement parent, string name)
    {
        if (!parent.TryGetProperty(name, out var value) ||
            value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            throw new InvalidDataException($"Pi runtime manifest property '{name}' must be a boolean.");
        }

        return value.GetBoolean();
    }

    private static int RequireInt32(JsonElement parent, string name)
    {
        if (!parent.TryGetProperty(name, out var value) ||
            value.ValueKind != JsonValueKind.Number ||
            !value.TryGetInt32(out var result))
        {
            throw new InvalidDataException($"Pi runtime manifest property '{name}' must be an integer.");
        }

        return result;
    }

    private static long RequireInt64(JsonElement parent, string name)
    {
        if (!parent.TryGetProperty(name, out var value) ||
            value.ValueKind != JsonValueKind.Number ||
            !value.TryGetInt64(out var result))
        {
            throw new InvalidDataException($"Pi runtime manifest property '{name}' must be an integer.");
        }

        return result;
    }

    private static void EnsureNoDuplicateProperties(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                {
                    var names = new HashSet<string>(StringComparer.Ordinal);
                    foreach (var property in element.EnumerateObject())
                    {
                        if (!names.Add(property.Name))
                        {
                            throw new InvalidDataException(
                                $"Pi runtime manifest contains duplicate property '{property.Name}'.");
                        }
                        EnsureNoDuplicateProperties(property.Value);
                    }
                    break;
                }
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    EnsureNoDuplicateProperties(item);
                }
                break;
        }
    }
}
