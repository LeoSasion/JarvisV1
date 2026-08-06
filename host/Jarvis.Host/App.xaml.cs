using System.Windows;
using System.Windows.Threading;
using Jarvis.Host.Infrastructure;
using Jarvis.Host.Services;
using Microsoft.Web.WebView2.Core;

namespace Jarvis.Host;

public partial class App : Application
{
    private SingleInstanceGuard? _singleInstance;
    private bool _mayRestoreTaskbar;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        if (LifecycleProbeOptions.IsRequested(e.Args))
        {
            ShutdownMode = ShutdownMode.OnExplicitShutdown;
            _ = RunLifecycleProbeAsync(e.Args);
            return;
        }

        if (TaskbarWatchdog.TryParse(e.Args, out var watchdogTarget))
        {
            _mayRestoreTaskbar = true;
            HostLog.Info($"Taskbar watchdog started for host process {watchdogTarget.ProcessId}.");
            _ = RunWatchdogAsync(watchdogTarget);
            return;
        }

        _singleInstance = SingleInstanceGuard.TryAcquire();
        if (!_singleInstance.IsAcquired)
        {
            MessageBox.Show(
                "JARVIS 已在当前 Windows 会话中运行。",
                "JARVIS",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            Shutdown(2);
            return;
        }

        var staleAppearanceRecovery = NativeWindowAppearanceRecovery.RestoreStaleSnapshot();
        if (staleAppearanceRecovery.PendingWindows > 0)
        {
            Environment.SetEnvironmentVariable("JARVIS_KEEP_NATIVE_TASKBAR", "1");
            HostLog.Warning(
                $"Native window appearance recovery still has " +
                $"{staleAppearanceRecovery.PendingWindows} pending target(s); " +
                "this session was downgraded to native-taskbar-safe mode.");
        }

        var webViewVersion = TryGetWebViewVersion();
        if (string.IsNullOrWhiteSpace(webViewVersion))
        {
            HostLog.Error("Microsoft Edge WebView2 Runtime is not installed.");
            MessageBox.Show(
                "JARVIS 需要 Microsoft Edge WebView2 Runtime。请安装 Evergreen Runtime 后重新启动。\n\nWindows 原生桌面与任务栏未被修改。",
                "JARVIS 启动检查",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Shutdown(3);
            return;
        }

        if (e.Args.Any(argument => argument.Equals("--startup", StringComparison.OrdinalIgnoreCase)))
        {
            HostLog.Info("JARVIS was launched by the current-user Windows startup registration.");
        }

        ConfigureDiagnostics(e.Args);

        _mayRestoreTaskbar = true;
        HostLog.Info("JARVIS native host starting in primary-taskbar replacement mode.");
        DispatcherUnhandledException += OnDispatcherUnhandledException;
        AppDomain.CurrentDomain.UnhandledException += OnUnhandledException;
        TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;
        AppDomain.CurrentDomain.ProcessExit += OnProcessExit;

        var mainWindow = new MainWindow();
        MainWindow = mainWindow;
        mainWindow.Closed += (_, _) => Shutdown();
        mainWindow.Show();
    }

    private async Task RunLifecycleProbeAsync(IReadOnlyList<string> arguments)
    {
        if (!LifecycleProbeOptions.TryParse(arguments, out var options, out _))
        {
            Shutdown(64);
            return;
        }

        var exitCode = await LifecycleProbeRunner.RunAsync(options!);
        Shutdown(exitCode);
    }

    private static string? TryGetWebViewVersion()
    {
        try
        {
            return CoreWebView2Environment.GetAvailableBrowserVersionString();
        }
        catch (Exception exception)
        {
            HostLog.Error("Microsoft Edge WebView2 Runtime preflight failed.", exception);
            return null;
        }
    }

    private static void ConfigureDiagnostics(IReadOnlyList<string> arguments)
    {
        const string flyoutArgument = "--taskbar-diagnostic-flyout=";
        var argument = arguments.FirstOrDefault(value =>
            value.StartsWith(flyoutArgument, StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrWhiteSpace(argument))
        {
            var requestedProcess = argument[flyoutArgument.Length..].Trim();
            if (!string.IsNullOrWhiteSpace(requestedProcess))
            {
                Environment.SetEnvironmentVariable(
                    "JARVIS_TASKBAR_DIAGNOSTIC_FLYOUT_PROCESS",
                    requestedProcess);
                HostLog.Info($"Taskbar diagnostic flyout requested for process {requestedProcess}.");
            }
        }

        if (arguments.Any(value =>
                value.Equals("--window-switcher-diagnostic", StringComparison.OrdinalIgnoreCase)))
        {
            Environment.SetEnvironmentVariable("JARVIS_WINDOW_SWITCHER_DIAGNOSTIC", "1");
            HostLog.Info("Persistent window-switcher diagnostics requested.");
        }
    }

    private async Task RunWatchdogAsync(WatchdogTarget target)
    {
        await TaskbarWatchdog.RunAsync(target);
        await Dispatcher.InvokeAsync(() => Shutdown());
    }

    private void OnDispatcherUnhandledException(
        object sender,
        DispatcherUnhandledExceptionEventArgs e)
    {
        HostLog.Error("Unhandled UI exception.", e.Exception);
        RestoreWindowAppearanceIfOwned();
        RestoreTaskbarIfOwned();
        MessageBox.Show(
            "JARVIS 宿主遇到错误，已恢复 Windows 原生任务栏并安全退出。",
            "JARVIS",
            MessageBoxButton.OK,
            MessageBoxImage.Error);
        e.Handled = true;
        Current.Shutdown(-1);
    }

    private void OnUnhandledException(object sender, UnhandledExceptionEventArgs e)
    {
        HostLog.Error("Unhandled process exception.", e.ExceptionObject as Exception);
        RestoreWindowAppearanceIfOwned();
        RestoreTaskbarIfOwned();
    }

    private static void OnUnobservedTaskException(object? sender, UnobservedTaskExceptionEventArgs e)
    {
        HostLog.Error("Unobserved task exception.", e.Exception);
        e.SetObserved();
    }

    private void OnProcessExit(object? sender, EventArgs e)
    {
        RestoreWindowAppearanceIfOwned();
        RestoreTaskbarIfOwned();
    }

    private void RestoreWindowAppearanceIfOwned()
    {
        if (MainWindow is Jarvis.Host.MainWindow mainWindow)
        {
            mainWindow.EmergencyRestoreNativeAppearance();
        }

        var recovery = NativeWindowAppearanceRecovery.RestoreStaleSnapshot(force: true);
        if (recovery.PendingWindows > 0)
        {
            HostLog.Warning(
                $"Emergency native window appearance restore left {recovery.PendingWindows} pending target(s).");
        }
    }

    private void RestoreTaskbarIfOwned()
    {
        if (_mayRestoreTaskbar)
        {
            NativeTaskbarController.RestoreOwnedPrimary();
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        RestoreTaskbarIfOwned();
        AppDomain.CurrentDomain.ProcessExit -= OnProcessExit;
        AppDomain.CurrentDomain.UnhandledException -= OnUnhandledException;
        TaskScheduler.UnobservedTaskException -= OnUnobservedTaskException;
        _singleInstance?.Dispose();
        _singleInstance = null;
        base.OnExit(e);
    }
}
