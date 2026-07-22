using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Services;

internal static class TaskbarWatchdog
{
    private const string ModeArgument = "--taskbar-watchdog";
    private const string PidArgument = "--host-pid";
    private const string StartTicksArgument = "--host-start-ticks";
    private const string ReadyEventArgument = "--ready-event";
    private const string ActivateEventArgument = "--activate-event";
    private const string HiddenEventArgument = "--hidden-event";
    private const string RestoreEventArgument = "--restore-event";
    private const string ReplacementWindowArgument = "--replacement-window";
    private const string EventNamePrefix = @"Local\JARVIS.Taskbar.";

    public static bool TryParse(string[] arguments, out WatchdogTarget target)
    {
        target = default;
        if (!arguments.Contains(ModeArgument, StringComparer.Ordinal))
        {
            return false;
        }

        var pidText = ReadValue(arguments, PidArgument);
        var ticksText = ReadValue(arguments, StartTicksArgument);
        var readyEvent = ReadValue(arguments, ReadyEventArgument);
        var activateEvent = ReadValue(arguments, ActivateEventArgument);
        var hiddenEvent = ReadValue(arguments, HiddenEventArgument);
        var restoreEvent = ReadValue(arguments, RestoreEventArgument);
        var replacementWindowText = ReadValue(arguments, ReplacementWindowArgument);
        if (!int.TryParse(pidText, NumberStyles.None, CultureInfo.InvariantCulture, out var pid) ||
            pid <= 0 ||
            !long.TryParse(ticksText, NumberStyles.None, CultureInfo.InvariantCulture, out var ticks) ||
            ticks <= 0 ||
            !IsValidEventName(readyEvent) ||
            !IsValidEventName(activateEvent) ||
            !IsValidEventName(hiddenEvent) ||
            !IsValidEventName(restoreEvent) ||
            !long.TryParse(
                replacementWindowText,
                NumberStyles.Integer,
                CultureInfo.InvariantCulture,
                out var replacementWindow) ||
            replacementWindow == 0)
        {
            return false;
        }

        target = new WatchdogTarget(
            pid,
            ticks,
            readyEvent!,
            activateEvent!,
            hiddenEvent!,
            restoreEvent!,
            replacementWindow);
        return true;
    }

    public static TaskbarWatchdogChannel StartForCurrentProcess(IntPtr replacementWindowHandle)
    {
        using var current = Process.GetCurrentProcess();
        var token = Guid.NewGuid().ToString("N", CultureInfo.InvariantCulture);
        var readyEventName = $"{EventNamePrefix}{token}.Ready";
        var activateEventName = $"{EventNamePrefix}{token}.Activate";
        var hiddenEventName = $"{EventNamePrefix}{token}.Hidden";
        var restoreEventName = $"{EventNamePrefix}{token}.Restore";
        var readyEvent = new EventWaitHandle(
            false,
            EventResetMode.ManualReset,
            readyEventName);
        var activateEvent = new EventWaitHandle(
            false,
            EventResetMode.ManualReset,
            activateEventName);
        var hiddenEvent = new EventWaitHandle(
            false,
            EventResetMode.ManualReset,
            hiddenEventName);
        var restoreEvent = new EventWaitHandle(
            false,
            EventResetMode.ManualReset,
            restoreEventName);

        try
        {
            var processPath = Environment.ProcessPath ??
                              throw new InvalidOperationException("The JARVIS executable path is unavailable.");
            var startInfo = new ProcessStartInfo
            {
                FileName = processPath,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };

            if (Path.GetFileNameWithoutExtension(processPath).Equals("dotnet", StringComparison.OrdinalIgnoreCase))
            {
                startInfo.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
            }

            AddArgument(startInfo, ModeArgument);
            AddArgument(startInfo, PidArgument, current.Id.ToString(CultureInfo.InvariantCulture));
            AddArgument(
                startInfo,
                StartTicksArgument,
                current.StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture));
            AddArgument(startInfo, ReadyEventArgument, readyEventName);
            AddArgument(startInfo, ActivateEventArgument, activateEventName);
            AddArgument(startInfo, HiddenEventArgument, hiddenEventName);
            AddArgument(startInfo, RestoreEventArgument, restoreEventName);
            AddArgument(
                startInfo,
                ReplacementWindowArgument,
                replacementWindowHandle.ToInt64().ToString(CultureInfo.InvariantCulture));

            var process = Process.Start(startInfo) ??
                          throw new InvalidOperationException("The taskbar recovery watchdog could not be started.");
            return new TaskbarWatchdogChannel(
                process,
                readyEvent,
                activateEvent,
                hiddenEvent,
                restoreEvent);
        }
        catch
        {
            readyEvent.Dispose();
            activateEvent.Dispose();
            hiddenEvent.Dispose();
            restoreEvent.Dispose();
            throw;
        }
    }

    public static Task RunAsync(WatchdogTarget target) => Task.Run(() => RunBlocking(target));

    private static void RunBlocking(WatchdogTarget target)
    {
        try
        {
            using var readyEvent = EventWaitHandle.OpenExisting(target.ReadyEventName);
            using var activateEvent = EventWaitHandle.OpenExisting(target.ActivateEventName);
            using var hiddenEvent = EventWaitHandle.OpenExisting(target.HiddenEventName);
            using var restoreEvent = EventWaitHandle.OpenExisting(target.RestoreEventName);
            using var host = Process.GetProcessById(target.ProcessId);
            if (host.StartTime.ToUniversalTime().Ticks != target.StartTimeUtcTicks)
            {
                return;
            }

            _ = readyEvent.Set();
            while (!host.HasExited && !restoreEvent.WaitOne(0) && !activateEvent.WaitOne(200))
            {
                host.Refresh();
            }

            if (host.HasExited || restoreEvent.WaitOne(0) || !NativeTaskbarController.HidePrimary())
            {
                return;
            }

            var hidden = false;
            for (var attempt = 0; attempt < 20; attempt++)
            {
                if (host.HasExited || restoreEvent.WaitOne(50))
                {
                    return;
                }

                if (!NativeTaskbarController.IsPrimaryVisible())
                {
                    hidden = true;
                    break;
                }
            }

            if (!hidden)
            {
                return;
            }

            _ = hiddenEvent.Set();
            var unresponsiveChecks = 0;
            while (!host.HasExited && !restoreEvent.WaitOne(500))
            {
                host.Refresh();
                if (host.HasExited)
                {
                    break;
                }

                if (restoreEvent.WaitOne(0))
                {
                    break;
                }

                if (NativeTaskbarController.IsPrimaryVisible() && !NativeTaskbarController.HidePrimary())
                {
                    HostLog.Warning("The watchdog could not hide a recreated primary taskbar.");
                    break;
                }

                if (host.MainWindowHandle != IntPtr.Zero && !host.Responding)
                {
                    unresponsiveChecks++;
                    if (unresponsiveChecks >= 6)
                    {
                        HostLog.Warning(
                            "Taskbar watchdog detected an unresponsive host and is terminating only the JARVIS host process for recovery.");
                        TerminateUnresponsiveHost(host);
                        break;
                    }
                }
                else
                {
                    unresponsiveChecks = 0;
                }
            }
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or
                                   System.ComponentModel.Win32Exception or WaitHandleCannotBeOpenedException)
        {
            HostLog.Error("The watchdog could not monitor the host process.", ex);
        }
        finally
        {
            var appearanceRecovery = NativeWindowAppearanceRecovery.RestoreStaleSnapshot();
            if (appearanceRecovery.PendingWindows > 0)
            {
                HostLog.Warning(
                    $"Taskbar watchdog left {appearanceRecovery.PendingWindows} native window appearance target(s) pending.");
            }

            NativeTaskbarController.HideReplacementWindow(
                new IntPtr(target.ReplacementWindowHandle),
                target.ProcessId);
            HostLog.Info("Taskbar watchdog restoring the primary Windows taskbar.");
            NativeTaskbarController.RestorePrimary();
        }
    }

    private static void TerminateUnresponsiveHost(Process host)
    {
        try
        {
            if (host.HasExited)
            {
                return;
            }

            host.Kill(entireProcessTree: false);
            if (!host.WaitForExit(3000))
            {
                HostLog.Warning("The unresponsive JARVIS host did not exit within the recovery timeout.");
            }
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception or
                                   NotSupportedException)
        {
            HostLog.Error("The watchdog could not terminate the unresponsive JARVIS host.", ex);
        }
    }

    private static void AddArgument(ProcessStartInfo startInfo, string name, string? value = null)
    {
        startInfo.ArgumentList.Add(name);
        if (value is not null)
        {
            startInfo.ArgumentList.Add(value);
        }
    }

    private static bool IsValidEventName(string? value) =>
        !string.IsNullOrWhiteSpace(value) &&
        value.Length <= 180 &&
        value.StartsWith(EventNamePrefix, StringComparison.Ordinal);

    private static string? ReadValue(string[] arguments, string name)
    {
        var index = Array.FindIndex(arguments, argument => argument.Equals(name, StringComparison.Ordinal));
        return index >= 0 && index + 1 < arguments.Length ? arguments[index + 1] : null;
    }
}

internal sealed class TaskbarWatchdogChannel : IDisposable
{
    private readonly EventWaitHandle _readyEvent;
    private readonly EventWaitHandle _activateEvent;
    private readonly EventWaitHandle _hiddenEvent;
    private readonly EventWaitHandle _restoreEvent;
    private bool _disposed;

    public TaskbarWatchdogChannel(
        Process process,
        EventWaitHandle readyEvent,
        EventWaitHandle activateEvent,
        EventWaitHandle hiddenEvent,
        EventWaitHandle restoreEvent)
    {
        Process = process;
        _readyEvent = readyEvent;
        _activateEvent = activateEvent;
        _hiddenEvent = hiddenEvent;
        _restoreEvent = restoreEvent;
    }

    public Process Process { get; }

    public async Task<bool> ArmAndHideAsync(CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var ready = await Task.Run(
            () => _readyEvent.WaitOne(TimeSpan.FromSeconds(3)),
            cancellationToken);
        if (!ready || Process.HasExited)
        {
            return false;
        }

        _ = _activateEvent.Set();
        var hidden = await Task.Run(
            () => _hiddenEvent.WaitOne(TimeSpan.FromSeconds(3)),
            cancellationToken);
        return hidden && !Process.HasExited && !NativeTaskbarController.IsPrimaryVisible();
    }

    public void RequestRestore()
    {
        if (!_disposed)
        {
            _ = _restoreEvent.Set();
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Process.Dispose();
        _readyEvent.Dispose();
        _activateEvent.Dispose();
        _hiddenEvent.Dispose();
        _restoreEvent.Dispose();
    }
}

internal readonly record struct WatchdogTarget(
    int ProcessId,
    long StartTimeUtcTicks,
    string ReadyEventName,
    string ActivateEventName,
    string HiddenEventName,
    string RestoreEventName,
    long ReplacementWindowHandle);
