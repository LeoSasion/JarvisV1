using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using Jarvis.Host.Bridge;
using Jarvis.Host.Infrastructure;
using Jarvis.Host.Services;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace Jarvis.Host;

public partial class MainWindow : Window
{
    private static readonly int TaskbarCreatedMessage = RegisterWindowMessage("TaskbarCreated");

    private readonly TaskbarReplacementSession _taskbarReplacement = new();
    private readonly TaskbarModeService _taskbarModeService = new();
    private readonly WindowTaskbarService _taskbarService = new();
    private readonly TerminalSessionService _terminalSessionService = new();
    private readonly RuntimeSnapshotFeed _snapshotFeed;
    private readonly AudioEndpointService _audioEndpointService;
    private readonly TrayStatusService _trayStatusService;
    private readonly SystemFeedService _systemFeedService;
    private readonly TaskbarLifecycleMachine _taskbarLifecycle = new();
    private readonly NativeWindowAppearanceService _windowAppearanceService;
    private GlobalSafetyHotkey? _safetyHotkey;
    private WebBridge? _bridge;
    private HwndSource? _windowSource;
    private TaskbarWindow? _taskbarWindow;
    private CancellationTokenSource? _taskbarRebindCancellation;
    private long _taskbarGeneration;
    private bool _isClosing;
    private bool _diagnosticPanelShown;
    private bool _desktopReady;

    public MainWindow()
    {
        _snapshotFeed = new RuntimeSnapshotFeed(new SystemSnapshotService(), _taskbarService);
        _audioEndpointService = new AudioEndpointService();
        _trayStatusService = new TrayStatusService(_snapshotFeed, _audioEndpointService);
        _systemFeedService = new SystemFeedService(_trayStatusService);
        _windowAppearanceService = new NativeWindowAppearanceService(Dispatcher);
        InitializeComponent();
        _taskbarReplacement.ReplacementLost += OnTaskbarReplacementLost;
        _taskbarModeService.RequestedModeChanged += OnRequestedTaskbarModeChanged;
        SystemEvents.DisplaySettingsChanged += OnDisplaySettingsChanged;
        SystemEvents.PowerModeChanged += OnPowerModeChanged;
        SystemEvents.SessionSwitch += OnSessionSwitch;
    }

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        _safetyHotkey = new GlobalSafetyHotkey(this, RequestSafeExit);
        _ = _safetyHotkey.Register();
        _windowAppearanceService.Start();
        var handle = new WindowInteropHelper(this).Handle;
        _windowSource = handle == IntPtr.Zero ? null : HwndSource.FromHwnd(handle);
        _windowSource?.AddHook(WindowProcedure);
        if (!NativeDisplay.TryGetPrimaryMonitorBounds(out var bounds) ||
            !NativeDisplay.PositionWindow(this, bounds))
        {
            HostLog.Warning("The desktop host could not be fitted to the primary monitor bounds.");
        }
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            HostLog.Info("Desktop window loaded; initializing WebView2.");
            await InitializeWebViewAsync();
            HostLog.Info("Desktop WebView2 initialization completed; awaiting navigation.");
        }
        catch (Exception ex)
        {
            HostLog.Error("WebView2 initialization failed.", ex);
            StatusText.Text = $"HOST STARTUP FAILED · {ex.Message}";
        }
    }

    private async Task InitializeWebViewAsync()
    {
        var frontendDirectory = FrontendLocator.FindDistributionDirectory();
        var environment = await WebViewEnvironmentProvider.GetAsync();
        StatusText.Text = $"WEBVIEW2 {environment.BrowserVersionString} · LOADING INTERFACE";
        await WebView.EnsureCoreWebView2Async(environment);

        WebViewHostConfiguration.Apply(
            WebView.CoreWebView2,
            frontendDirectory,
            "desktop",
            args =>
            {
                HostLog.Error($"WebView2 process failed: {args.ProcessFailedKind}.");
                Dispatcher.Invoke(() =>
                {
                    DisableTaskbarReplacement();
                    LoadingOverlay.Visibility = Visibility.Visible;
                    StatusText.Text = "WEBVIEW PROCESS FAILED · PRESS ESC TO EXIT";
                });
            });

        var desktopService = new DesktopService();
        var shellService = new ShellService(desktopService);
        _bridge = new WebBridge(
            WebView.CoreWebView2,
            Dispatcher,
            _snapshotFeed,
            desktopService,
            shellService,
            new FileExplorerService(),
            _terminalSessionService,
            _taskbarService,
            _windowAppearanceService,
            _taskbarModeService,
            _trayStatusService,
            _systemFeedService,
            new RuntimeDiagnosticsService(
                new StartupRegistrationService(),
                _windowAppearanceService,
                _snapshotFeed,
                _taskbarModeService,
                CaptureTaskbarLifecycle),
            RequestSafeExit,
            ShowDesktop);
        _bridge.Attach();

        WebView.CoreWebView2.NavigationCompleted += OnNavigationCompleted;
        var source = WebViewHostConfiguration.CreateAppUri("surface=desktop&taskbar=external");
        HostLog.Info($"Navigating desktop surface to {source}.");
        WebView.Source = source;
    }

    private async void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (!e.IsSuccess)
        {
            HostLog.Error($"Desktop surface navigation failed: {e.WebErrorStatus}.");
            StatusText.Text = $"INTERFACE LOAD FAILED · {e.WebErrorStatus}";
            return;
        }

        HostLog.Info("Desktop surface navigation completed; awaiting the desktop renderer.");
        try
        {
            if (!await WaitForDesktopSurfaceAsync())
            {
                HostLog.Error("Desktop renderer did not become ready within the startup deadline.");
                StatusText.Text = "INTERFACE STARTUP TIMED OUT · PRESS ESC TO EXIT";
                return;
            }

            LoadingOverlay.Visibility = Visibility.Collapsed;
            if (_bridge is not null)
            {
                await _bridge.StartTelemetryAsync();
            }

            _desktopReady = true;
            HostLog.Info("Desktop surface is ready; evaluating the requested taskbar mode.");
            QueueTaskbarRebind("desktop-ready", TimeSpan.Zero);
            _ = ShowDiagnosticShellPanelAsync();
        }
        catch (Exception ex)
        {
            if (_isClosing)
            {
                return;
            }

            HostLog.Error("Desktop renderer readiness check failed.", ex);
            StatusText.Text = $"INTERFACE STARTUP FAILED · {ex.Message}";
        }
    }

    private async Task<bool> WaitForDesktopSurfaceAsync()
    {
        const int maximumAttempts = 40;
        for (var attempt = 0; attempt < maximumAttempts && !_isClosing; attempt++)
        {
            var result = await WebView.CoreWebView2.ExecuteScriptAsync(
                "Boolean(document.querySelector('.jarvis-shell'));"
            );
            if (string.Equals(result, "true", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            await Task.Delay(50);
        }

        return false;
    }

    private async Task ShowDiagnosticShellPanelAsync()
    {
        var requestedPanel = Environment.GetEnvironmentVariable("JARVIS_DIAGNOSTIC_SHELL_PANEL");
        if (_diagnosticPanelShown || string.IsNullOrWhiteSpace(requestedPanel))
        {
            return;
        }

        var normalizedPanel = requestedPanel.Trim().ToLowerInvariant();
        if (normalizedPanel is not ("start" or "quick-settings" or "notifications" or "command" or "explorer" or "settings" or "terminal"))
        {
            HostLog.Warning($"Ignored unsupported diagnostic shell panel: {requestedPanel}.");
            return;
        }

        _diagnosticPanelShown = true;
        await Task.Delay(300);
        if (_isClosing || !_desktopReady)
        {
            return;
        }

        HostLog.Info($"Opening diagnostic shell panel: {normalizedPanel}.");
        ShowDesktop(normalizedPanel);
    }

    private void CreateTaskbarSurface(
        long generation,
        TaskbarMode mode,
        PixelRect bounds,
        PixelRect? notificationAreaBounds,
        bool hybridAvailable)
    {
        if (_isClosing ||
            !_desktopReady ||
            generation != Volatile.Read(ref _taskbarGeneration) ||
            _taskbarWindow is not null)
        {
            return;
        }

        HostLog.Info(
            $"Taskbar surface target detected for {TaskbarModeService.ToWireValue(mode)} mode: " +
            $"{bounds.Left},{bounds.Top} {bounds.Width}x{bounds.Height}.");
        _taskbarWindow = new TaskbarWindow(
            bounds,
            mode,
            notificationAreaBounds,
            _snapshotFeed,
            _taskbarService,
            _terminalSessionService,
            _windowAppearanceService,
            _taskbarModeService,
            _trayStatusService,
            _systemFeedService,
            () => OnTaskbarSurfaceReady(generation, mode, hybridAvailable),
            () => OnTaskbarSurfaceFailed(generation, mode, hybridAvailable),
            RequestSafeExit,
            ShowDesktop);
        _taskbarWindow.Show();
        HostLog.Info("Taskbar surface window created; awaiting renderer readiness.");
    }

    private void OnTaskbarSurfaceFailed(
        long generation,
        TaskbarMode mode,
        bool hybridAvailable)
    {
        if (_isClosing || generation != Volatile.Read(ref _taskbarGeneration))
        {
            return;
        }

        DisableTaskbarReplacement();
        SetTaskbarLifecycleState(TaskbarLifecycleState.NativeFallback, "taskbar surface failed");
        _taskbarModeService.ReportEffectiveMode(
            TaskbarMode.Native,
            hybridAvailable,
            mode == TaskbarMode.Hybrid
                ? "The hybrid taskbar surface could not safely yield the native notification area."
                : "The full replacement renderer did not become ready.");
    }

    private async void OnTaskbarSurfaceReady(
        long generation,
        TaskbarMode mode,
        bool hybridAvailable)
    {
        if (_isClosing ||
            generation != Volatile.Read(ref _taskbarGeneration) ||
            _taskbarWindow is null)
        {
            return;
        }

        if (mode == TaskbarMode.Hybrid)
        {
            _taskbarWindow.Reveal();
            SetTaskbarLifecycleState(TaskbarLifecycleState.ReplacementActive, "hybrid surface ready");
            _taskbarModeService.ReportEffectiveMode(TaskbarMode.Hybrid, hybridAvailable, null);
            HostLog.Info("JARVIS hybrid taskbar surface revealed; Explorer notification area remains active.");
            return;
        }

        var taskbarHandle = _taskbarWindow.NativeHandle;
        HostLog.Info($"Taskbar renderer is ready; activating replacement for window 0x{taskbarHandle.ToInt64():X}.");
        if (await _taskbarReplacement.ActivateAsync(taskbarHandle))
        {
            if (_isClosing ||
                generation != Volatile.Read(ref _taskbarGeneration) ||
                _taskbarWindow is null)
            {
                _taskbarReplacement.Restore();
                return;
            }

            _taskbarWindow?.Reveal();
            SetTaskbarLifecycleState(TaskbarLifecycleState.ReplacementActive, "full surface ready");
            _taskbarModeService.ReportEffectiveMode(TaskbarMode.Full, hybridAvailable, null);
            HostLog.Info("JARVIS taskbar surface revealed.");
        }
        else
        {
            DisableTaskbarReplacement();
            SetTaskbarLifecycleState(TaskbarLifecycleState.NativeFallback, "full activation failed");
            _taskbarModeService.ReportEffectiveMode(
                TaskbarMode.Native,
                hybridAvailable,
                "The full replacement watchdog did not confirm a safe activation.");
            HostLog.Warning("JARVIS taskbar surface remained concealed because activation was not confirmed.");
        }
    }

    private void OnTaskbarReplacementLost()
    {
        QueueTaskbarRebind("watchdog-lost", TimeSpan.FromMilliseconds(750));
    }

    private void OnDisplaySettingsChanged(object? sender, EventArgs e)
    {
        QueueTaskbarRebind("display-settings-changed", TimeSpan.FromMilliseconds(900));
    }

    private void OnRequestedTaskbarModeChanged()
    {
        QueueTaskbarRebind("requested-mode-changed", TimeSpan.Zero);
    }

    private void OnPowerModeChanged(object sender, PowerModeChangedEventArgs e)
    {
        if (e.Mode == PowerModes.Suspend)
        {
            QueueNativeRestore("system-suspend");
            return;
        }

        if (e.Mode == PowerModes.Resume)
        {
            QueueTaskbarRebind("system-resume", TimeSpan.FromSeconds(1));
        }
    }

    private void OnSessionSwitch(object sender, SessionSwitchEventArgs e)
    {
        if (e.Reason == SessionSwitchReason.SessionLock)
        {
            QueueNativeRestore("session-lock");
            return;
        }

        if (e.Reason == SessionSwitchReason.SessionUnlock)
        {
            QueueTaskbarRebind("session-unlock", TimeSpan.FromMilliseconds(750));
        }
    }

    private IntPtr WindowProcedure(
        IntPtr window,
        int message,
        IntPtr wordParameter,
        IntPtr longParameter,
        ref bool handled)
    {
        if (TaskbarCreatedMessage > 0 && message == TaskbarCreatedMessage)
        {
            QueueTaskbarRebind("explorer-taskbar-created", TimeSpan.FromMilliseconds(750));
        }

        return IntPtr.Zero;
    }

    private void QueueNativeRestore(string reason)
    {
        if (_isClosing)
        {
            return;
        }

        _ = Dispatcher.BeginInvoke(() =>
        {
            if (_isClosing)
            {
                return;
            }

            Interlocked.Increment(ref _taskbarGeneration);
            CancelPendingTaskbarRebind();
            SetTaskbarLifecycleState(TaskbarLifecycleState.Recovering, reason);
            DisableTaskbarReplacement();
            SetTaskbarLifecycleState(TaskbarLifecycleState.NativeVisible, reason);
            _taskbarModeService.ReportEffectiveMode(
                TaskbarMode.Native,
                hybridAvailable: false,
                $"The native taskbar is active during {reason}.");
        });
    }

    private void QueueTaskbarRebind(string reason, TimeSpan delay)
    {
        if (_isClosing)
        {
            return;
        }

        var generation = Interlocked.Increment(ref _taskbarGeneration);
        var cancellation = new CancellationTokenSource();
        var previous = Interlocked.Exchange(ref _taskbarRebindCancellation, cancellation);
        previous?.Cancel();
        previous?.Dispose();
        _ = Dispatcher.BeginInvoke(
            () => _ = RebindTaskbarAsync(generation, reason, delay, cancellation.Token));
    }

    private async Task RebindTaskbarAsync(
        long generation,
        string reason,
        TimeSpan delay,
        CancellationToken cancellationToken)
    {
        try
        {
            if (delay > TimeSpan.Zero)
            {
                await Task.Delay(delay, cancellationToken);
            }

            if (_isClosing ||
                !_desktopReady ||
                generation != Volatile.Read(ref _taskbarGeneration))
            {
                return;
            }

            SetTaskbarLifecycleState(TaskbarLifecycleState.Rebinding, reason);
            DisableTaskbarReplacement();

            if (!NativeDisplay.TryGetPrimaryMonitorBounds(out var desktopBounds) ||
                !NativeDisplay.PositionWindow(this, desktopBounds))
            {
                SetTaskbarLifecycleState(TaskbarLifecycleState.NativeFallback, "desktop positioning failed");
                _taskbarModeService.ReportEffectiveMode(
                    TaskbarMode.Native,
                    hybridAvailable: false,
                    "The desktop host could not be positioned on the primary monitor.");
                return;
            }

            var requestedMode = _taskbarModeService.RequestedMode;
            if (requestedMode == TaskbarMode.Native ||
                Environment.GetEnvironmentVariable("JARVIS_KEEP_NATIVE_TASKBAR") == "1")
            {
                SetTaskbarLifecycleState(TaskbarLifecycleState.NativeVisible, reason);
                _taskbarModeService.ReportEffectiveMode(
                    TaskbarMode.Native,
                    hybridAvailable: false,
                    requestedMode == TaskbarMode.Native
                        ? null
                        : "JARVIS_KEEP_NATIVE_TASKBAR=1 keeps the native Windows taskbar active.");
                return;
            }

            if (requestedMode == TaskbarMode.Hybrid)
            {
                if (!NativeShellSurfaceService.TryCapture(out var shellSurface, out var failureReason))
                {
                    SetTaskbarLifecycleState(TaskbarLifecycleState.NativeFallback, "hybrid probe failed");
                    _taskbarModeService.ReportEffectiveMode(
                        TaskbarMode.Native,
                        hybridAvailable: false,
                        failureReason ?? "Explorer's notification area is unavailable.");
                    return;
                }

                SetTaskbarLifecycleState(TaskbarLifecycleState.Preparing, "hybrid probe ready");
                CreateTaskbarSurface(
                    generation,
                    TaskbarMode.Hybrid,
                    shellSurface.TaskbarBounds,
                    shellSurface.NotificationAreaBounds,
                    hybridAvailable: true);
                return;
            }

            if (!_taskbarReplacement.TryGetTargetBounds(out var taskbarBounds))
            {
                SetTaskbarLifecycleState(TaskbarLifecycleState.NativeFallback, "full target unavailable");
                _taskbarModeService.ReportEffectiveMode(
                    TaskbarMode.Native,
                    hybridAvailable: NativeShellSurfaceService.TryCapture(out _, out _),
                    "The visible bottom-aligned primary taskbar is unavailable for full replacement.");
                return;
            }

            SetTaskbarLifecycleState(TaskbarLifecycleState.Preparing, "full target ready");
            CreateTaskbarSurface(
                generation,
                TaskbarMode.Full,
                taskbarBounds,
                notificationAreaBounds: null,
                hybridAvailable: NativeShellSurfaceService.TryCapture(out _, out _));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // A newer lifecycle generation superseded this rebind.
        }
        catch (Exception ex)
        {
            HostLog.Error($"Taskbar rebind failed after {reason}.", ex);
            DisableTaskbarReplacement();
            SetTaskbarLifecycleState(TaskbarLifecycleState.NativeFallback, "rebind exception");
            _taskbarModeService.ReportEffectiveMode(
                TaskbarMode.Native,
                hybridAvailable: false,
                "The taskbar lifecycle coordinator encountered an error and restored Windows.");
        }
    }

    private void SetTaskbarLifecycleState(TaskbarLifecycleState state, string reason)
    {
        var transition = _taskbarLifecycle.Transition(state, reason);
        if (!transition.Changed && !transition.ForcedFallback)
        {
            return;
        }

        HostLog.Info(
            $"Taskbar lifecycle: {transition.PreviousState} -> {transition.State} " +
            $"({transition.Reason}).");
        if (transition.ForcedFallback)
        {
            DisableTaskbarReplacement();
            _taskbarModeService.ReportEffectiveMode(
                TaskbarMode.Native,
                hybridAvailable: false,
                transition.Reason);
        }

        var effectiveState = transition.State;
        _systemFeedService.Add(
            $"taskbar.{effectiveState.ToString().ToLowerInvariant()}",
            effectiveState == TaskbarLifecycleState.NativeFallback ? "warning" : "info",
            effectiveState switch
            {
                TaskbarLifecycleState.ReplacementActive => "Taskbar surface active",
                TaskbarLifecycleState.NativeFallback => "Native taskbar fallback active",
                TaskbarLifecycleState.Rebinding => "Taskbar rebind started",
                _ => $"Taskbar state: {effectiveState}"
            },
            transition.Reason,
            effectiveState == TaskbarLifecycleState.NativeFallback ? "open-runtime-settings" : null,
            $"taskbar:{effectiveState}:{transition.Reason}");
    }

    private TaskbarLifecycleSnapshot CaptureTaskbarLifecycle() => new(
        _taskbarLifecycle.State.ToString(),
        Volatile.Read(ref _taskbarGeneration),
        _taskbarWindow is not null,
        NativeTaskbarController.IsPrimaryVisible());

    private void CancelPendingTaskbarRebind()
    {
        var cancellation = Interlocked.Exchange(ref _taskbarRebindCancellation, null);
        cancellation?.Cancel();
        cancellation?.Dispose();
    }

    private void DisableTaskbarReplacement()
    {
        _taskbarReplacement.Restore();
        var taskbarWindow = _taskbarWindow;
        _taskbarWindow = null;
        taskbarWindow?.Conceal();
        taskbarWindow?.CloseFromHost();
    }

    private void ShowDesktop(string? panel)
    {
        if (_isClosing)
        {
            return;
        }

        if (WindowState == WindowState.Minimized)
        {
            WindowState = WindowState.Normal;
        }

        Show();
        _ = Activate();

        if (!string.IsNullOrWhiteSpace(panel) && WebView.CoreWebView2 is not null)
        {
            var serializedPanel = JsonSerializer.Serialize(panel);
            _ = WebView.CoreWebView2.ExecuteScriptAsync(
                $"window.dispatchEvent(new CustomEvent('jarvis:open-shell-panel', {{ detail: {serializedPanel} }}));");
        }
    }

    private async void OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            e.Handled = true;
            await ForwardEscapeToWebAsync();
            return;
        }

        var isSafetyChord = e.Key == Key.Q &&
                            Keyboard.Modifiers.HasFlag(ModifierKeys.Control) &&
                            Keyboard.Modifiers.HasFlag(ModifierKeys.Shift);
        if (isSafetyChord)
        {
            e.Handled = true;
            RequestSafeExit();
        }
    }

    private async Task ForwardEscapeToWebAsync()
    {
        if (WebView.CoreWebView2 is null || _isClosing)
        {
            return;
        }

        try
        {
            await WebView.CoreWebView2.ExecuteScriptAsync(
                "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));");
        }
        catch (InvalidOperationException) when (_isClosing)
        {
            // WebView disposal can race a final keyboard event during shutdown.
        }
    }

    private void RequestSafeExit()
    {
        if (_isClosing)
        {
            return;
        }

        Dispatcher.BeginInvoke(Close);
    }

    internal void EmergencyRestoreNativeAppearance()
    {
        _windowAppearanceService.EmergencyRestore();
    }

    private void OnClosing(object? sender, CancelEventArgs e)
    {
        _isClosing = true;
        Interlocked.Increment(ref _taskbarGeneration);
        CancelPendingTaskbarRebind();
        SystemEvents.DisplaySettingsChanged -= OnDisplaySettingsChanged;
        SystemEvents.PowerModeChanged -= OnPowerModeChanged;
        SystemEvents.SessionSwitch -= OnSessionSwitch;
        _taskbarReplacement.ReplacementLost -= OnTaskbarReplacementLost;
        _taskbarModeService.RequestedModeChanged -= OnRequestedTaskbarModeChanged;
        _windowSource?.RemoveHook(WindowProcedure);
        _windowSource = null;
        _bridge?.Dispose();
        _safetyHotkey?.Dispose();
        _safetyHotkey = null;
        // Restore third-party DWM values and remove the recovery snapshot before
        // asking the taskbar watchdog to finish its own recovery pass.
        _windowAppearanceService.Dispose();
        _taskbarReplacement.Dispose();
        _taskbarWindow?.CloseFromHost();
        _taskbarWindow = null;
        _systemFeedService.Dispose();
        _trayStatusService.Dispose();
        _snapshotFeed.Dispose();
        _audioEndpointService.Dispose();
        _terminalSessionService.Dispose();
        WebView.Dispose();
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int RegisterWindowMessage(string messageName);
}
