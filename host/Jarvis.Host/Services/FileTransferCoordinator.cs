using System.Diagnostics;
using System.IO;
using Jarvis.Host.Bridge;
using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Services;

internal sealed class FileTransferCoordinator : IDisposable
{
    private const int CopyBufferSize = 1024 * 1024;
    private const int MaximumRecentJobs = 8;
    private static readonly TimeSpan ProgressPublishInterval = TimeSpan.FromMilliseconds(75);

    private readonly object _gate = new();
    private readonly List<TransferJob> _recentJobs = [];
    private TransferJob? _currentJob;
    private bool _disposed;

    public event EventHandler<ExplorerTransferSnapshot>? TransferChanged;

    public ExplorerTransferPreflight Preflight(
        IReadOnlyList<string> requestedPaths,
        string requestedDestinationPath,
        string requestedMode)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var mode = NormalizeMode(requestedMode);
        var destinationPath = FileExplorerService.NormalizeDirectoryPath(requestedDestinationPath);
        var sourcePaths = FileExplorerService.NormalizeOperationPaths(requestedPaths);
        var conflicts = new List<ExplorerTransferConflict>();
        var crossesVolumes = false;

        foreach (var sourcePath in sourcePaths)
        {
            var isDirectory = Directory.Exists(sourcePath);
            if (isDirectory && FileExplorerService.IsPathWithin(destinationPath, sourcePath))
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
                continue;
            }

            var targetPath = Path.Combine(destinationPath, Path.GetFileName(sourcePath));
            if (PathExists(targetPath))
            {
                var attributes = File.GetAttributes(targetPath);
                if (attributes.HasFlag(FileAttributes.ReparsePoint))
                {
                    throw new BridgeFaultException(
                        "TARGET_NOT_ALLOWED",
                        "A linked destination item cannot be replaced or renamed by JARVIS Explorer.");
                }

                conflicts.Add(new ExplorerTransferConflict(
                    sourcePath,
                    targetPath,
                    Path.GetFileName(sourcePath),
                    isDirectory,
                    attributes.HasFlag(FileAttributes.Directory)));
            }

            crossesVolumes |= !SameVolume(sourcePath, destinationPath);
        }

        return new ExplorerTransferPreflight(
            mode,
            destinationPath,
            sourcePaths.Count,
            conflicts,
            crossesVolumes);
    }

    public ExplorerTransferSnapshot Start(
        IReadOnlyList<string> requestedPaths,
        string requestedDestinationPath,
        string requestedMode,
        string requestedConflictPolicy)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var preflight = Preflight(requestedPaths, requestedDestinationPath, requestedMode);
        var conflictPolicy = NormalizeConflictPolicy(requestedConflictPolicy);
        var sourcePaths = FileExplorerService.NormalizeOperationPaths(requestedPaths);
        TransferJob job;

        lock (_gate)
        {
            if (_currentJob is not null && !_currentJob.IsTerminal)
            {
                throw new BridgeFaultException(
                    "TRANSFER_BUSY",
                    "Another JARVIS file transfer is still active.");
            }

            job = new TransferJob(
                Guid.NewGuid().ToString("N"),
                sourcePaths,
                preflight.DestinationPath,
                preflight.Mode,
                conflictPolicy);
            _currentJob = job;
        }

        Publish(job);
        _ = Task.Run(() => Execute(job));
        return Snapshot(job);
    }

    public ExplorerTransferSnapshot Cancel(string requestedJobId)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var jobId = NormalizeJobId(requestedJobId);
        TransferJob job;
        lock (_gate)
        {
            job = FindJob(jobId);
            if (job.IsTerminal)
            {
                return SnapshotUnsafe(job);
            }

            job.Status = "cancelling";
            job.UpdatedAt = DateTimeOffset.UtcNow;
            job.Cancellation.Cancel();
        }

        Publish(job, force: true);
        return Snapshot(job);
    }

    public ExplorerTransferCollection GetTransfers()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        lock (_gate)
        {
            var jobs = new List<ExplorerTransferSnapshot>();
            if (_currentJob is not null)
            {
                jobs.Add(SnapshotUnsafe(_currentJob));
            }

            jobs.AddRange(_recentJobs
                .Where(job => !ReferenceEquals(job, _currentJob))
                .OrderByDescending(job => job.UpdatedAt)
                .Select(SnapshotUnsafe));
            return new ExplorerTransferCollection(jobs);
        }
    }

    private void Execute(TransferJob job)
    {
        try
        {
            Update(job, current =>
            {
                current.Status = "scanning";
                current.CurrentItem = null;
            }, force: true);

            var plans = new List<TransferItemPlan>();
            foreach (var sourcePath in job.SourcePaths)
            {
                job.Cancellation.Token.ThrowIfCancellationRequested();
                Update(job, current => current.CurrentItem = Path.GetFileName(sourcePath));
                try
                {
                    plans.Add(ScanEntry(sourcePath, job.Cancellation.Token));
                }
                catch (BridgeFaultException exception)
                {
                    Update(job, current => current.Failures.Add(new ExplorerOperationFailure(
                        sourcePath,
                        exception.Code,
                        exception.Message)));
                }
                catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
                {
                    Update(job, current => current.Failures.Add(new ExplorerOperationFailure(
                        sourcePath,
                        "TRANSFER_SCAN_FAILED",
                        exception.Message)));
                }
            }

            Update(job, current =>
            {
                current.TotalBytes = plans.Sum(plan => plan.Bytes);
                current.FailedItems = current.Failures.Count;
                current.Status = "transferring";
                current.CurrentItem = null;
            }, force: true);

            foreach (var plan in plans)
            {
                job.Cancellation.Token.ThrowIfCancellationRequested();
                TransferPlannedItem(job, plan);
            }

            Complete(job, job.Failures.Count > 0 ? "completed-with-errors" : "completed");
        }
        catch (OperationCanceledException) when (job.Cancellation.IsCancellationRequested)
        {
            Complete(job, "cancelled");
        }
        catch (Exception exception)
        {
            Update(job, current =>
            {
                current.Failures.Add(new ExplorerOperationFailure(
                    current.CurrentItem ?? string.Empty,
                    "TRANSFER_FAILED",
                    exception.Message));
                current.FatalError = exception.Message;
            }, force: true);
            Complete(job, "failed");
        }
    }

    private void TransferPlannedItem(TransferJob job, TransferItemPlan plan)
    {
        var sourceParent = Path.GetDirectoryName(plan.SourcePath);
        if (job.Mode == "move" &&
            sourceParent is not null &&
            sourceParent.Equals(job.DestinationPath, StringComparison.OrdinalIgnoreCase))
        {
            Update(job, current =>
            {
                current.Completed.Add(new ExplorerOperationItem(
                    plan.SourcePath,
                    plan.SourcePath,
                    Path.GetFileName(plan.SourcePath)));
                current.CompletedItems++;
                current.BytesTransferred += plan.Bytes;
                current.CurrentItem = Path.GetFileName(plan.SourcePath);
            }, force: true);
            return;
        }

        var initialTargetPath = Path.Combine(job.DestinationPath, Path.GetFileName(plan.SourcePath));
        var conflict = PathExists(initialTargetPath);
        if (conflict && job.ConflictPolicy == "skip")
        {
            Update(job, current =>
            {
                current.Skipped.Add(new ExplorerOperationFailure(
                    plan.SourcePath,
                    "SKIPPED_CONFLICT",
                    "An item with the same name already exists."));
                current.SkippedItems++;
                current.CurrentItem = Path.GetFileName(plan.SourcePath);
            }, force: true);
            return;
        }

        var targetPath = conflict && job.ConflictPolicy == "rename"
            ? FileExplorerService.CreateUniqueDestinationPath(
                job.DestinationPath,
                Path.GetFileName(plan.SourcePath),
                plan.IsDirectory,
                job.Mode == "copy")
            : initialTargetPath;
        var bytesBeforeItem = job.BytesTransferred;

        try
        {
            var warning = TransferWithRollback(
                job,
                plan,
                targetPath,
                replaceExisting: conflict && job.ConflictPolicy == "replace");
            Update(job, current =>
            {
                current.Completed.Add(new ExplorerOperationItem(
                    plan.SourcePath,
                    targetPath,
                    Path.GetFileName(targetPath)));
                if (warning is not null)
                {
                    current.Failures.Add(warning);
                }
                current.CompletedItems++;
                current.FailedItems = current.Failures.Count;
                current.CurrentItem = Path.GetFileName(plan.SourcePath);
            }, force: true);
        }
        catch (OperationCanceledException)
        {
            Update(job, current => current.BytesTransferred = bytesBeforeItem, force: true);
            throw;
        }
        catch (BridgeFaultException exception)
        {
            Update(job, current =>
            {
                current.Failures.Add(new ExplorerOperationFailure(
                    plan.SourcePath,
                    exception.Code,
                    exception.Message));
                current.BytesTransferred = bytesBeforeItem;
                current.FailedItems++;
                current.CurrentItem = Path.GetFileName(plan.SourcePath);
            }, force: true);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            Update(job, current =>
            {
                current.Failures.Add(new ExplorerOperationFailure(
                    plan.SourcePath,
                    "TRANSFER_FAILED",
                    exception.Message));
                current.BytesTransferred = bytesBeforeItem;
                current.FailedItems++;
                current.CurrentItem = Path.GetFileName(plan.SourcePath);
            }, force: true);
        }
    }

    private ExplorerOperationFailure? TransferWithRollback(
        TransferJob job,
        TransferItemPlan plan,
        string targetPath,
        bool replaceExisting)
    {
        string? rollbackPath = null;
        var targetCreated = false;
        try
        {
            job.Cancellation.Token.ThrowIfCancellationRequested();
            if (replaceExisting)
            {
                var attributes = File.GetAttributes(targetPath);
                if (attributes.HasFlag(FileAttributes.ReparsePoint))
                {
                    throw new BridgeFaultException(
                        "TARGET_NOT_ALLOWED",
                        "Linked destination entries cannot be replaced.");
                }

                rollbackPath = Path.Combine(
                    job.DestinationPath,
                    $".jarvis-rollback-{Guid.NewGuid():N}");
                MovePath(targetPath, rollbackPath, attributes.HasFlag(FileAttributes.Directory));
            }

            if (job.Mode == "move" && SameVolume(plan.SourcePath, targetPath))
            {
                MovePath(plan.SourcePath, targetPath, plan.IsDirectory);
                targetCreated = true;
                AddTransferredBytes(job, plan.Bytes, force: true);
            }
            else
            {
                CopyEntry(job, plan.SourcePath, targetPath, plan.IsDirectory);
                targetCreated = true;
                var copied = ScanEntry(targetPath, job.Cancellation.Token);
                if (copied.Bytes != plan.Bytes || copied.FileCount != plan.FileCount)
                {
                    throw new BridgeFaultException(
                        "TRANSFER_VERIFICATION_FAILED",
                        "The copied destination did not match the scanned source size and file count.");
                }

                if (job.Mode == "move")
                {
                    job.Cancellation.Token.ThrowIfCancellationRequested();
                    try
                    {
                        DeletePath(plan.SourcePath, plan.IsDirectory);
                    }
                    catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
                    {
                        if (rollbackPath is not null)
                        {
                            try
                            {
                                DeletePath(rollbackPath, Directory.Exists(rollbackPath));
                            }
                            catch (Exception rollbackException) when (
                                rollbackException is IOException or UnauthorizedAccessException)
                            {
                                return new ExplorerOperationFailure(
                                    plan.SourcePath,
                                    "SOURCE_DELETE_INCOMPLETE",
                                    $"The verified destination and rollback copy were retained because Windows could not fully remove the source: {exception.Message}");
                            }
                            rollbackPath = null;
                        }

                        return new ExplorerOperationFailure(
                            plan.SourcePath,
                            "SOURCE_DELETE_INCOMPLETE",
                            $"The verified destination was retained, but Windows could not fully remove the source: {exception.Message}");
                    }
                }
            }

            if (rollbackPath is not null)
            {
                DeletePath(rollbackPath, Directory.Exists(rollbackPath));
                rollbackPath = null;
            }

            return null;
        }
        catch
        {
            if (targetCreated || PathExists(targetPath))
            {
                FileExplorerService.DeleteCreatedEntry(targetPath);
            }

            if (rollbackPath is not null && PathExists(rollbackPath) && !PathExists(targetPath))
            {
                MovePath(rollbackPath, targetPath, Directory.Exists(rollbackPath));
            }

            throw;
        }
    }

    private void CopyEntry(
        TransferJob job,
        string sourcePath,
        string targetPath,
        bool isDirectory)
    {
        try
        {
            if (isDirectory)
            {
                CopyDirectory(job, sourcePath, targetPath);
            }
            else
            {
                CopyFile(job, sourcePath, targetPath);
            }
        }
        catch
        {
            FileExplorerService.DeleteCreatedEntry(targetPath);
            throw;
        }
    }

    private void CopyDirectory(TransferJob job, string sourcePath, string targetPath)
    {
        var pending = new Stack<(string Source, string Target)>();
        pending.Push((sourcePath, targetPath));
        while (pending.TryPop(out var directory))
        {
            job.Cancellation.Token.ThrowIfCancellationRequested();
            var sourceInfo = new DirectoryInfo(directory.Source);
            if (sourceInfo.Attributes.HasFlag(FileAttributes.ReparsePoint))
            {
                throw LinkedEntryFault(sourceInfo.Name);
            }

            Directory.CreateDirectory(directory.Target);
            foreach (var entryPath in Directory.EnumerateFileSystemEntries(directory.Source))
            {
                job.Cancellation.Token.ThrowIfCancellationRequested();
                var attributes = File.GetAttributes(entryPath);
                if (attributes.HasFlag(FileAttributes.ReparsePoint))
                {
                    throw LinkedEntryFault(Path.GetFileName(entryPath));
                }

                var childTarget = Path.Combine(directory.Target, Path.GetFileName(entryPath));
                if (attributes.HasFlag(FileAttributes.Directory))
                {
                    pending.Push((entryPath, childTarget));
                }
                else
                {
                    CopyFile(job, entryPath, childTarget);
                }
            }
        }
    }

    private void CopyFile(TransferJob job, string sourcePath, string targetPath)
    {
        job.Cancellation.Token.ThrowIfCancellationRequested();
        var attributes = File.GetAttributes(sourcePath);
        if (attributes.HasFlag(FileAttributes.ReparsePoint))
        {
            throw LinkedEntryFault(Path.GetFileName(sourcePath));
        }

        using var source = new FileStream(
            sourcePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            CopyBufferSize,
            FileOptions.SequentialScan);
        using var target = new FileStream(
            targetPath,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            CopyBufferSize,
            FileOptions.SequentialScan);
        var buffer = new byte[CopyBufferSize];
        while (true)
        {
            job.Cancellation.Token.ThrowIfCancellationRequested();
            var bytesRead = source.Read(buffer, 0, buffer.Length);
            if (bytesRead == 0)
            {
                break;
            }

            target.Write(buffer, 0, bytesRead);
            AddTransferredBytes(job, bytesRead);
        }

        target.Flush(flushToDisk: true);
        File.SetLastWriteTimeUtc(targetPath, File.GetLastWriteTimeUtc(sourcePath));
    }

    private static TransferItemPlan ScanEntry(string sourcePath, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var attributes = File.GetAttributes(sourcePath);
        if (attributes.HasFlag(FileAttributes.ReparsePoint))
        {
            throw LinkedEntryFault(Path.GetFileName(sourcePath));
        }

        if (!attributes.HasFlag(FileAttributes.Directory))
        {
            return new TransferItemPlan(sourcePath, false, new FileInfo(sourcePath).Length, 1);
        }

        long bytes = 0;
        var fileCount = 0;
        var pending = new Stack<string>();
        pending.Push(sourcePath);
        while (pending.TryPop(out var directoryPath))
        {
            cancellationToken.ThrowIfCancellationRequested();
            foreach (var entryPath in Directory.EnumerateFileSystemEntries(directoryPath))
            {
                cancellationToken.ThrowIfCancellationRequested();
                var entryAttributes = File.GetAttributes(entryPath);
                if (entryAttributes.HasFlag(FileAttributes.ReparsePoint))
                {
                    throw LinkedEntryFault(Path.GetFileName(entryPath));
                }

                if (entryAttributes.HasFlag(FileAttributes.Directory))
                {
                    pending.Push(entryPath);
                }
                else
                {
                    bytes += new FileInfo(entryPath).Length;
                    fileCount++;
                }
            }
        }

        return new TransferItemPlan(sourcePath, true, bytes, fileCount);
    }

    private static BridgeFaultException LinkedEntryFault(string name) =>
        new(
            "TARGET_NOT_ALLOWED",
            $"Linked file-system entry blocked: {name}");

    private void AddTransferredBytes(TransferJob job, long bytes, bool force = false)
    {
        Update(job, current => current.BytesTransferred += bytes, force);
    }

    private void Complete(TransferJob job, string status)
    {
        Update(job, current =>
        {
            current.Status = status;
            current.CurrentItem = null;
            current.FailedItems = current.Failures.Count;
            current.SkippedItems = current.Skipped.Count;
            current.IsTerminal = true;
            if (status == "completed" && current.TotalBytes > current.BytesTransferred)
            {
                current.BytesTransferred = current.TotalBytes;
            }
        }, force: true);

        var disposeAfterCompletion = false;
        lock (_gate)
        {
            if (!_recentJobs.Contains(job))
            {
                _recentJobs.Insert(0, job);
            }

            if (_recentJobs.Count > MaximumRecentJobs)
            {
                var removed = _recentJobs[^1];
                _recentJobs.RemoveAt(_recentJobs.Count - 1);
                if (!ReferenceEquals(removed, _currentJob))
                {
                    removed.Dispose();
                }
            }

            disposeAfterCompletion = _disposed;
        }

        if (disposeAfterCompletion)
        {
            job.Dispose();
        }
    }

    private void Update(TransferJob job, Action<TransferJob> update, bool force = false)
    {
        lock (_gate)
        {
            update(job);
            job.UpdatedAt = DateTimeOffset.UtcNow;
        }

        Publish(job, force);
    }

    private void Publish(TransferJob job, bool force = false)
    {
        ExplorerTransferSnapshot snapshot;
        lock (_gate)
        {
            var now = Stopwatch.GetTimestamp();
            if (!force &&
                job.LastPublishedTimestamp != 0 &&
                Stopwatch.GetElapsedTime(job.LastPublishedTimestamp, now) < ProgressPublishInterval)
            {
                return;
            }

            job.LastPublishedTimestamp = now;
            snapshot = SnapshotUnsafe(job);
        }

        try
        {
            TransferChanged?.Invoke(this, snapshot);
        }
        catch (Exception exception)
        {
            HostLog.Warning($"File transfer progress listener failed: {exception.Message}");
        }
    }

    private ExplorerTransferSnapshot Snapshot(TransferJob job)
    {
        lock (_gate)
        {
            return SnapshotUnsafe(job);
        }
    }

    private static ExplorerTransferSnapshot SnapshotUnsafe(TransferJob job)
    {
        var processedItems = job.CompletedItems + job.FailedItems + job.SkippedItems;
        var percent = job.TotalBytes > 0
            ? Math.Clamp(job.BytesTransferred * 100d / job.TotalBytes, 0d, 100d)
            : job.Status is "completed" or "completed-with-errors"
                ? 100d
                : job.TotalItems > 0
                    ? Math.Clamp(processedItems * 100d / job.TotalItems, 0d, 100d)
                    : 0d;
        return new ExplorerTransferSnapshot(
            job.JobId,
            job.Mode,
            job.ConflictPolicy,
            job.Status,
            job.CurrentItem,
            job.TotalItems,
            job.CompletedItems,
            job.FailedItems,
            job.SkippedItems,
            job.TotalBytes,
            job.BytesTransferred,
            percent,
            job.StartedAt,
            job.UpdatedAt,
            job.FatalError,
            new ExplorerOperationResult(
                job.Mode,
                job.Completed.ToArray(),
                job.Failures.ToArray(),
                job.Skipped.ToArray()));
    }

    private TransferJob FindJob(string jobId)
    {
        if (_currentJob?.JobId.Equals(jobId, StringComparison.Ordinal) == true)
        {
            return _currentJob;
        }

        var job = _recentJobs.FirstOrDefault(
            candidate => candidate.JobId.Equals(jobId, StringComparison.Ordinal));
        return job ?? throw new BridgeFaultException(
            "TRANSFER_NOT_FOUND",
            "The requested file transfer is no longer available.");
    }

    private static string NormalizeMode(string requestedMode)
    {
        var mode = requestedMode.Trim().ToLowerInvariant();
        return mode is "copy" or "move"
            ? mode
            : throw new BridgeFaultException(
                "INVALID_OPERATION",
                "Transfer mode must be copy or move.");
    }

    private static string NormalizeConflictPolicy(string requestedPolicy)
    {
        var policy = requestedPolicy.Trim().ToLowerInvariant();
        return policy is "rename" or "skip" or "replace"
            ? policy
            : throw new BridgeFaultException(
                "INVALID_CONFLICT_POLICY",
                "Conflict policy must be rename, skip, or replace.");
    }

    private static string NormalizeJobId(string requestedJobId)
    {
        var jobId = requestedJobId.Trim();
        return jobId.Length is > 0 and <= 64 &&
               jobId.All(character => char.IsAsciiLetterOrDigit(character))
            ? jobId
            : throw new BridgeFaultException(
                "INVALID_TRANSFER_ID",
                "The transfer identifier is invalid.");
    }

    private static bool SameVolume(string leftPath, string rightPath) =>
        string.Equals(
            Path.GetPathRoot(leftPath),
            Path.GetPathRoot(rightPath),
            StringComparison.OrdinalIgnoreCase);

    private static bool PathExists(string path) =>
        File.Exists(path) || Directory.Exists(path);

    private static void MovePath(string sourcePath, string targetPath, bool isDirectory)
    {
        if (isDirectory)
        {
            Directory.Move(sourcePath, targetPath);
        }
        else
        {
            File.Move(sourcePath, targetPath);
        }
    }

    private static void DeletePath(string path, bool isDirectory)
    {
        if (isDirectory)
        {
            Directory.Delete(path, recursive: true);
        }
        else
        {
            File.Delete(path);
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        lock (_gate)
        {
            if (_currentJob is not null)
            {
                if (_currentJob.IsTerminal)
                {
                    _currentJob.Dispose();
                }
                else
                {
                    _currentJob.Cancellation.Cancel();
                }
            }
            foreach (var job in _recentJobs)
            {
                if (!ReferenceEquals(job, _currentJob))
                {
                    job.Dispose();
                }
            }
        }
    }

    private sealed class TransferJob(
        string jobId,
        IReadOnlyList<string> sourcePaths,
        string destinationPath,
        string mode,
        string conflictPolicy) : IDisposable
    {
        public string JobId { get; } = jobId;
        public IReadOnlyList<string> SourcePaths { get; } = sourcePaths;
        public string DestinationPath { get; } = destinationPath;
        public string Mode { get; } = mode;
        public string ConflictPolicy { get; } = conflictPolicy;
        public CancellationTokenSource Cancellation { get; } = new();
        public List<ExplorerOperationItem> Completed { get; } = [];
        public List<ExplorerOperationFailure> Failures { get; } = [];
        public List<ExplorerOperationFailure> Skipped { get; } = [];
        public string Status { get; set; } = "queued";
        public string? CurrentItem { get; set; }
        public int TotalItems { get; } = sourcePaths.Count;
        public int CompletedItems { get; set; }
        public int FailedItems { get; set; }
        public int SkippedItems { get; set; }
        public long TotalBytes { get; set; }
        public long BytesTransferred { get; set; }
        public DateTimeOffset StartedAt { get; } = DateTimeOffset.UtcNow;
        public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
        public string? FatalError { get; set; }
        public bool IsTerminal { get; set; }
        public long LastPublishedTimestamp { get; set; }

        public void Dispose() => Cancellation.Dispose();
    }

    private sealed record TransferItemPlan(
        string SourcePath,
        bool IsDirectory,
        long Bytes,
        int FileCount);
}

internal sealed record ExplorerTransferConflict(
    string Source,
    string Target,
    string Name,
    bool SourceIsDirectory,
    bool TargetIsDirectory);

internal sealed record ExplorerTransferPreflight(
    string Mode,
    string DestinationPath,
    int ItemCount,
    IReadOnlyList<ExplorerTransferConflict> Conflicts,
    bool CrossesVolumes);

internal sealed record ExplorerTransferSnapshot(
    string JobId,
    string Mode,
    string ConflictPolicy,
    string Status,
    string? CurrentItem,
    int TotalItems,
    int CompletedItems,
    int FailedItems,
    int SkippedItems,
    long TotalBytes,
    long BytesTransferred,
    double Percent,
    DateTimeOffset StartedAt,
    DateTimeOffset UpdatedAt,
    string? Error,
    ExplorerOperationResult Result);

internal sealed record ExplorerTransferCollection(
    IReadOnlyList<ExplorerTransferSnapshot> Jobs);
