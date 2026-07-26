using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Services;

internal sealed class TaskbarReplacementSession : IDisposable
{
    private readonly object _gate = new();
    private readonly CancellationTokenSource _shutdown = new();

    private TaskbarWatchdogChannel? _watchdog;
    private bool _watchdogExited;
    private bool _active;
    private bool _activating;
    private bool _disposed;
    private long _generation;

    public event Action? ReplacementLost;

    public bool TryGetTargetBounds(out PixelRect bounds)
    {
        if (Environment.GetEnvironmentVariable("JARVIS_KEEP_NATIVE_TASKBAR") == "1")
        {
            bounds = default;
            return false;
        }

        return NativeTaskbarController.TryGetVisiblePrimaryBounds(out bounds);
    }

    public async Task<bool> ActivateAsync(IntPtr replacementWindowHandle)
    {
        long generation;
        lock (_gate)
        {
            if (_disposed)
            {
                return false;
            }

            if (_active)
            {
                return true;
            }

            if (_activating)
            {
                return false;
            }

            _activating = true;
            _watchdogExited = false;
            generation = ++_generation;
        }

        TaskbarWatchdogChannel? watchdog = null;
        try
        {
            HostLog.Info(
                $"Taskbar replacement activation started for window 0x{replacementWindowHandle.ToInt64():X}.");
            if (!NativeTaskbarController.TryGetVisiblePrimaryBounds(out _))
            {
                HostLog.Warning("Taskbar replacement activation stopped because the native taskbar is not visible.");
                return false;
            }

            if (replacementWindowHandle == IntPtr.Zero)
            {
                HostLog.Warning("Taskbar replacement activation stopped because the replacement window handle is zero.");
                return false;
            }

            watchdog = TaskbarWatchdog.StartForCurrentProcess(replacementWindowHandle);
            HostLog.Info($"Taskbar watchdog process {watchdog.Process.Id} started; awaiting recovery handshake.");
            watchdog.Process.EnableRaisingEvents = true;
            watchdog.Process.Exited += OnWatchdogExited;

            lock (_gate)
            {
                if (_disposed || generation != _generation)
                {
                    watchdog.Process.Exited -= OnWatchdogExited;
                    watchdog.RequestRestore();
                    watchdog.Dispose();
                    return false;
                }

                _watchdog = watchdog;
            }

            if (!await watchdog.ArmAndHideAsync(_shutdown.Token))
            {
                HostLog.Warning(
                    "Taskbar replacement was not enabled because the watchdog did not confirm a hidden taskbar.");
                watchdog.RequestRestore();
                return false;
            }

            HostLog.Info("Taskbar watchdog confirmed that the native taskbar is hidden.");
            NativeTaskbarController.AcquireVisibilityLease();
            var activationFailed = false;
            lock (_gate)
            {
                activationFailed = _disposed ||
                                   generation != _generation ||
                                   _watchdogExited ||
                                   watchdog.Process.HasExited ||
                                   !ReferenceEquals(_watchdog, watchdog);
                if (!activationFailed)
                {
                    _active = true;
                }
            }

            if (activationFailed)
            {
                watchdog.RequestRestore();
                NativeTaskbarController.RestoreOwnedPrimary();
                HostLog.Warning("Taskbar replacement was rolled back because the watchdog exited during activation.");
                return false;
            }

            HostLog.Info("Primary Windows taskbar replacement is active.");
            return true;
        }
        catch (OperationCanceledException) when (_shutdown.IsCancellationRequested)
        {
            watchdog?.RequestRestore();
            NativeTaskbarController.RestoreOwnedPrimary();
            return false;
        }
        catch (Exception ex)
        {
            HostLog.Error("Taskbar replacement activation failed.", ex);
            watchdog?.RequestRestore();
            NativeTaskbarController.RestoreOwnedPrimary();
            return false;
        }
        finally
        {
            lock (_gate)
            {
                if (generation == _generation)
                {
                    _activating = false;
                }
            }
        }
    }

    public void Restore()
    {
        TaskbarWatchdogChannel? watchdog;
        lock (_gate)
        {
            _generation++;
            _active = false;
            _activating = false;
            watchdog = _watchdog;
            _watchdog = null;
        }

        if (watchdog is not null)
        {
            watchdog.Process.Exited -= OnWatchdogExited;
            watchdog.RequestRestore();
            watchdog.Dispose();
        }

        NativeTaskbarController.RestoreOwnedPrimary();
    }

    private void OnWatchdogExited(object? sender, EventArgs e)
    {
        var shouldDisable = false;
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            if (_watchdog is null || !ReferenceEquals(_watchdog.Process, sender))
            {
                return;
            }

            _watchdogExited = true;
            shouldDisable = _active;
        }

        if (shouldDisable)
        {
            DisableAfterFailure("The taskbar recovery watchdog exited unexpectedly.");
        }
    }

    private void DisableAfterFailure(string message)
    {
        HostLog.Warning(message);
        Restore();
        ReplacementLost?.Invoke();
    }

    public void Dispose()
    {
        TaskbarWatchdogChannel? watchdog;
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _generation++;
            _shutdown.Cancel();
            watchdog = _watchdog;
            _watchdog = null;
        }

        watchdog?.RequestRestore();
        NativeTaskbarController.RestoreOwnedPrimary();
        if (watchdog is not null)
        {
            watchdog.Process.Exited -= OnWatchdogExited;
            watchdog.Dispose();
        }

        _shutdown.Dispose();
    }
}
