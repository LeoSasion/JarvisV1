using System.IO;
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
    private RendererSmokeOptions? _rendererSmokeOptions;

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

        if (RendererSmokeOptions.IsRequested(e.Args))
        {
            if (!RendererSmokeOptions.TryParse(e.Args, out _rendererSmokeOptions, out var error))
            {
                HostLog.Error($"Renderer smoke arguments are invalid. {error}");
                Shutdown(64);
                return;
            }

            Directory.CreateDirectory(_rendererSmokeOptions!.DataRoot);
            HostLog.UseIsolatedLogDirectory(Path.Combine(_rendererSmokeOptions.DataRoot, "Logs"));
            Environment.SetEnvironmentVariable("JARVIS_KEEP_NATIVE_TASKBAR", "1");
            WebViewEnvironmentProvider.UseIsolatedUserDataDirectory(
                Path.Combine(_rendererSmokeOptions.DataRoot, "WebView2"));
            HostLog.Info("Renderer smoke requested in isolated native-taskbar-safe mode.");
        }

        _singleInstance = SingleInstanceGuard.TryAcquire();
        if (!_singleInstance.IsAcquired)
        {
            if (_rendererSmokeOptions is not null)
            {
                TryWriteRendererSmokeFailure("another JARVIS instance is already running");
                Shutdown(73);
                return;
            }

            MessageBox.Show(
                "JARVIS 已在当前 Windows 会话中运行。",
                "JARVIS",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            Shutdown(2);
            return;
        }

        var staleAppearanceRecovery = _rendererSmokeOptions is null
            ? NativeWindowAppearanceRecovery.RestoreStaleSnapshot()
            : null;
        if (staleAppearanceRecovery?.RequiresSafeMode == true)
        {
            Environment.SetEnvironmentVariable("JARVIS_KEEP_NATIVE_TASKBAR", "1");
            HostLog.Warning(
                "Native window appearance recovery is not verified" +
                (staleAppearanceRecovery.PendingWindows > 0
                    ? $" and still has {staleAppearanceRecovery.PendingWindows} pending target(s)"
                    : string.Empty) +
                "; this session was downgraded to native-taskbar-safe mode." +
                (string.IsNullOrWhiteSpace(staleAppearanceRecovery.FailureReason)
                    ? string.Empty
                    : $" {staleAppearanceRecovery.FailureReason}"));
        }

        var webViewVersion = TryGetWebViewVersion();
        if (string.IsNullOrWhiteSpace(webViewVersion))
        {
            HostLog.Error("Microsoft Edge WebView2 Runtime is not installed.");
            if (_rendererSmokeOptions is not null)
            {
                TryWriteRendererSmokeFailure("Microsoft Edge WebView2 Runtime is unavailable");
            }
            else
            {
                MessageBox.Show(
                    "JARVIS 需要 Microsoft Edge WebView2 Runtime。请安装 Evergreen Runtime 后重新启动。\n\nWindows 原生桌面与任务栏未被修改。",
                    "JARVIS 启动检查",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error);
            }
            Shutdown(3);
            return;
        }

        if (e.Args.Any(argument => argument.Equals("--startup", StringComparison.OrdinalIgnoreCase)))
        {
            HostLog.Info("JARVIS was launched by the current-user Windows startup registration.");
        }

        ConfigureDiagnostics(e.Args);

        _mayRestoreTaskbar = _rendererSmokeOptions is null;
        HostLog.Info("JARVIS native host starting; the per-user taskbar mode will be evaluated after renderer readiness.");
        DispatcherUnhandledException += OnDispatcherUnhandledException;
        AppDomain.CurrentDomain.UnhandledException += OnUnhandledException;
        TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;
        AppDomain.CurrentDomain.ProcessExit += OnProcessExit;

        var mainWindow = new MainWindow(_rendererSmokeOptions);
        MainWindow = mainWindow;
        mainWindow.Closed += (_, _) => Shutdown(mainWindow.RendererSmokeExitCode ?? 0);
        mainWindow.Show();
    }

    private void TryWriteRendererSmokeFailure(string error)
    {
        if (_rendererSmokeOptions is null)
        {
            return;
        }

        try
        {
            RendererSmokeReceipt.Write(
                _rendererSmokeOptions,
                result: null,
                mainWindowCreated: false,
                error);
        }
        catch (Exception exception)
        {
            HostLog.Error("Renderer smoke failure receipt could not be written.", exception);
        }
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
        if (_rendererSmokeOptions is not null)
        {
            TryWriteRendererSmokeFailure(e.Exception.GetType().Name);
        }
        else
        {
            MessageBox.Show(
                "JARVIS 宿主遇到错误，已恢复 Windows 原生任务栏并安全退出。",
                "JARVIS",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
        }
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
        if (_rendererSmokeOptions is not null)
        {
            return;
        }

        if (MainWindow is Jarvis.Host.MainWindow mainWindow)
        {
            mainWindow.EmergencyRestoreNativeAppearance();
        }

        var recovery = NativeWindowAppearanceRecovery.RestoreStaleSnapshot(force: true);
        if (recovery.RequiresSafeMode)
        {
            HostLog.Warning(
                "Emergency native window appearance restore remains in safe mode" +
                (recovery.PendingWindows > 0
                    ? $" with {recovery.PendingWindows} pending target(s)"
                    : string.Empty) +
                "." +
                (string.IsNullOrWhiteSpace(recovery.FailureReason)
                    ? string.Empty
                    : $" {recovery.FailureReason}"));
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
