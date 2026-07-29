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
    private const int GwlExStyle = -20;
    private const int SwShowNoActivate = 4;
    private const long WsExToolWindow = 0x00000080L;
    private const long WsExAppWindow = 0x00040000L;

    private readonly TaskbarReplacementSession _taskbarReplacement = new();
    private readonly TaskbarModeService _taskbarModeService = new();
    private readonly QuickSearchShortcutSettingsService _quickSearchShortcutSettings = new();
    private readonly WindowTaskbarService _taskbarService = new();
    private readonly DesktopService _desktopService = new();
    private readonly ShellService _shellService;
    private readonly TerminalSessionService _terminalSessionService = new();
    private readonly RuntimeSnapshotFeed _snapshotFeed;
    private readonly AudioEndpointService _audioEndpointService;
    private readonly TrayStatusService _trayStatusService;
    private readonly SystemFeedService _systemFeedService;
    private readonly TaskbarLifecycleMachine _taskbarLifecycle = new();
    private readonly TaskbarRebindEpoch _taskbarRebindEpoch = new();
    private readonly TaskbarRecoveryCircuit _taskbarRecoveryCircuit = new();
    private readonly NativeWindowAppearanceService _windowAppearanceService;
    private GlobalSafetyHotkey? _safetyHotkey;
    private GlobalQuickSearchHotkey? _quickSearchHotkey;
    private WebBridge? _bridge;
    private HwndSource? _windowSource;
    private TaskbarWindow? _taskbarWindow;
    private WindowSwitcherWindow? _windowSwitcherWindow;
    private WindowSwitcherController? _windowSwitcherController;
    private QuickSearchWindow? _quickSearchWindow;
    private CancellationTokenSource? _taskbarRebindCancellation;
    private CancellationTokenSource? _taskbarStabilityCancellation;
    private bool _isClosing;
    private bool _diagnosticPanelShown;
    private bool _diagnosticWindowSwitcherShown;
    private bool _desktopReady;
    private bool _windowSwitcherEnabled;

    public MainWindow()
    {
        _shellService = new ShellService(_desktopService);
        _snapshotFeed = new RuntimeSnapshotFeed(new SystemSnapshotService(), _taskbarService);
        _audioEndpointService = new AudioEndpointService();
        _trayStatusService = new TrayStatusService(_snapshotFeed, _audioEndpointService);
        _systemFeedService = new SystemFeedService(_trayStatusService);
        _windowAppearanceService = new NativeWindowAppearanceService(Dispatcher);
        InitializeComponent();
        _taskbarReplacement.ReplacementLost += OnTaskbarReplacementLost;
        _taskbarModeService.RequestedModeChanged += OnRequestedTaskbarModeChanged;
        _taskbarModeService.RetryRequested += OnTaskbarRetryRequested;
        _taskbarModeService.StateChanged += OnTaskbarModeStateChanged;
        _quickSearchShortcutSettings.EnabledChanged += OnQuickSearchShortcutPreferenceChanged;
        _snapshotFeed.SnapshotAvailable += OnRuntimeSnapshotAvailable;
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
        if (handle != IntPtr.Zero && !ApplyDesktopSurfaceStyles(handle))
        {
            HostLog.Warning("The desktop host could not be excluded from the Windows task switcher.");
        }
        _windowSource = handle == IntPtr.Zero ? null : HwndSource.FromHwnd(handle);
        _windowSource?.AddHook(WindowProcedure);
        if (!TryPositionDesktopSurface(TaskbarMode.Native))
        {
            HostLog.Warning("The desktop host could not be fitted to the primary monitor bounds.");
        }
    }

    private static bool ApplyDesktopSurfaceStyles(IntPtr handle)
    {
        var currentStyle = GetWindowLongPtr(handle, GwlExStyle).ToInt64();
        var desktopStyle = (currentStyle | WsExToolWindow) & ~WsExAppWindow;
        if (desktopStyle != currentStyle)
        {
            _ = SetWindowLongPtr(handle, GwlExStyle, new IntPtr(desktopStyle));
        }

        var appliedStyle = GetWindowLongPtr(handle, GwlExStyle).ToInt64();
        return (appliedStyle & WsExToolWindow) != 0 &&
               (appliedStyle & WsExAppWindow) == 0;
    }

    private void OnDesktopWindowStateChanged(object? sender, EventArgs e)
    {
        if (_isClosing || WindowState != WindowState.Minimized)
        {
            return;
        }

        // JARVIS is the desktop surface, not a task-switchable application window.
        // Win+D and shell transitions may try to minimize every top-level window;
        // restore this one without activation so Explorer's desktop never flashes
        // between ordinary application-window transitions.
        _ = Dispatcher.BeginInvoke(() =>
        {
            if (_isClosing || WindowState != WindowState.Minimized)
            {
                return;
            }

            var handle = new WindowInteropHelper(this).Handle;
            if (handle != IntPtr.Zero)
            {
                _ = ShowWindow(handle, SwShowNoActivate);
            }

            _ = TryPositionDesktopSurface(ResolveDesktopSurfaceMode());
        });
    }

    private void OnRuntimeSnapshotAvailable(RuntimeTelemetrySnapshot snapshot)
    {
        if (_isClosing || !snapshot.TaskbarChanged)
        {
            return;
        }

        try
        {
            _ = Dispatcher.BeginInvoke(() =>
            {
                if (_isClosing)
                {
                    return;
                }

                var suppress =
                    snapshot.Taskbar.ForegroundFullscreen &&
                    _taskbarLifecycle.State == TaskbarLifecycleState.ReplacementActive;
                _taskbarWindow?.SetFullscreenSuppressed(
                    suppress,
                    snapshot.Taskbar.ForegroundWindowId);
            });
        }
        catch (InvalidOperationException) when (_isClosing)
        {
            // The dispatcher may stop while the final telemetry snapshot is being published.
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

        _bridge = new WebBridge(
            WebView.CoreWebView2,
            Dispatcher,
            _snapshotFeed,
            _desktopService,
            _shellService,
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
                CaptureTaskbarLifecycle,
                _quickSearchShortcutSettings),
            RequestSafeExit,
            ShowDesktop,
            quickSearchShortcutSettings: _quickSearchShortcutSettings);
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
            ReconcileWindowSwitcherRuntime("desktop-ready");
            ReconcileGlobalQuickSearchShortcut();
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
            !_taskbarRebindEpoch.IsCurrent(generation) ||
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
            _desktopService,
            _shellService,
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
        if (_isClosing || !_taskbarRebindEpoch.IsCurrent(generation))
        {
            return;
        }

        DisableTaskbarReplacement();
        SetTaskbarLifecycleState(TaskbarLifecycleState.NativeFallback, "taskbar surface failed");
        ReportTaskbarOutcome(
            generation,
            TaskbarMode.Native,
            hybridAvailable,
            mode == TaskbarMode.Hybrid
                ? "The hybrid taskbar surface could not safely yield the native notification area."
                : "The full replacement renderer did not become ready.",
            "taskbar surface failed",
            countFailure: true);
    }

    private async void OnTaskbarSurfaceReady(
        long generation,
        TaskbarMode mode,
        bool hybridAvailable)
    {
        if (_isClosing ||
            !_taskbarRebindEpoch.IsCurrent(generation) ||
            _taskbarWindow is null)
        {
            return;
        }

        if (mode == TaskbarMode.Hybrid)
        {
            var taskbarSnapshot = _snapshotFeed.GetTaskbarSnapshot();
            _taskbarWindow.SetFullscreenSuppressed(
                taskbarSnapshot.ForegroundFullscreen,
                taskbarSnapshot.ForegroundWindowId);
            _taskbarWindow.Reveal();
            SetTaskbarLifecycleState(TaskbarLifecycleState.ReplacementActive, "hybrid surface ready");
            ReportTaskbarOutcome(
                generation,
                TaskbarMode.Hybrid,
                hybridAvailable,
                fallbackReason: null,
                transitionReason: "hybrid surface ready",
                countFailure: false);
            ScheduleStableTaskbarSuccess(generation);
            HostLog.Info("JARVIS hybrid taskbar surface revealed; Explorer notification area remains active.");
            return;
        }

        var taskbarHandle = _taskbarWindow.NativeHandle;
        HostLog.Info($"Taskbar renderer is ready; activating replacement for window 0x{taskbarHandle.ToInt64():X}.");
        if (await _taskbarReplacement.ActivateAsync(taskbarHandle))
        {
            if (_isClosing ||
                !_taskbarRebindEpoch.IsCurrent(generation) ||
                _taskbarWindow is null)
            {
                _taskbarReplacement.Restore();
                return;
            }

            if (!TryPositionDesktopSurface(TaskbarMode.Full))
            {
                DisableTaskbarReplacement();
                SetTaskbarLifecycleState(
                    TaskbarLifecycleState.NativeFallback,
                    "full desktop positioning failed");
                ReportTaskbarOutcome(
                    generation,
                    TaskbarMode.Native,
                    hybridAvailable,
                    fallbackReason: "The desktop host could not expand after the full replacement was activated.",
                    transitionReason: "full desktop positioning failed",
                    countFailure: true);
                return;
            }

            var taskbarSnapshot = _snapshotFeed.GetTaskbarSnapshot();
            _taskbarWindow.SetFullscreenSuppressed(
                taskbarSnapshot.ForegroundFullscreen,
                taskbarSnapshot.ForegroundWindowId);
            _taskbarWindow.Reveal();
            SetTaskbarLifecycleState(TaskbarLifecycleState.ReplacementActive, "full surface ready");
            ReportTaskbarOutcome(
                generation,
                TaskbarMode.Full,
                hybridAvailable,
                fallbackReason: null,
                transitionReason: "full surface ready",
                countFailure: false);
            ScheduleStableTaskbarSuccess(generation);
            HostLog.Info("JARVIS taskbar surface revealed.");
        }
        else
        {
            DisableTaskbarReplacement();
            SetTaskbarLifecycleState(TaskbarLifecycleState.NativeFallback, "full activation failed");
            ReportTaskbarOutcome(
                generation,
                TaskbarMode.Native,
                hybridAvailable,
                "The full replacement watchdog did not confirm a safe activation.",
                "full activation failed",
                countFailure: true);
            HostLog.Warning("JARVIS taskbar surface remained concealed because activation was not confirmed.");
        }
    }

    private void OnTaskbarReplacementLost()
    {
        _ = Dispatcher.BeginInvoke(HandleTaskbarReplacementLost);
    }

    private void HandleTaskbarReplacementLost()
    {
        if (_isClosing)
        {
            return;
        }

        CancelTaskbarStabilityConfirmation();
        var generation = _taskbarRebindEpoch.Current;
        var recovery = _taskbarRecoveryCircuit.ReportFailure(DateTimeOffset.UtcNow);
        SetTaskbarLifecycleState(TaskbarLifecycleState.NativeFallback, "watchdog-lost");
        _taskbarModeService.ReportEffectiveMode(
            generation,
            TaskbarMode.Native,
            hybridAvailable: NativeShellSurfaceService.TryCapture(out _, out _),
            fallbackReason: "The taskbar recovery watchdog exited unexpectedly.",
            transitionReason: "watchdog-lost",
            recovery: recovery);
        if (recovery.IsOpen)
        {
            if (recovery.RetryAfterUtc is { } retryAfterUtc)
            {
                HostLog.Warning(
                    $"Automatic taskbar reactivation is cooling down until {retryAfterUtc:O}.");
            }

            return;
        }

        QueueTaskbarRebind("watchdog-lost", TimeSpan.FromMilliseconds(750));
    }

    private TaskbarModeState ReportTaskbarOutcome(
        long generation,
        TaskbarMode effectiveMode,
        bool hybridAvailable,
        string? fallbackReason,
        string transitionReason,
        bool countFailure)
    {
        if (!_taskbarRebindEpoch.IsCurrent(generation))
        {
            return _taskbarModeService.GetState();
        }

        if (countFailure)
        {
            CancelTaskbarStabilityConfirmation();
        }

        var recovery = countFailure
            ? _taskbarRecoveryCircuit.ReportFailure(DateTimeOffset.UtcNow)
            : _taskbarRecoveryCircuit.Capture(DateTimeOffset.UtcNow);
        return _taskbarModeService.ReportEffectiveMode(
            generation,
            effectiveMode,
            hybridAvailable,
            fallbackReason,
            transitionReason,
            recovery);
    }

    private void ScheduleStableTaskbarSuccess(long generation)
    {
        CancelTaskbarStabilityConfirmation();
        var cancellation = new CancellationTokenSource();
        _taskbarStabilityCancellation = cancellation;
        _ = ConfirmStableTaskbarSuccessAsync(generation, cancellation);
    }

    private async Task ConfirmStableTaskbarSuccessAsync(
        long generation,
        CancellationTokenSource cancellation)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(30), cancellation.Token);
            await Dispatcher.InvokeAsync(() =>
            {
                if (_isClosing ||
                    cancellation.IsCancellationRequested ||
                    !_taskbarRebindEpoch.IsCurrent(generation) ||
                    _taskbarLifecycle.State != TaskbarLifecycleState.ReplacementActive)
                {
                    return;
                }

                var recovery = _taskbarRecoveryCircuit.ReportStableSuccess();
                _taskbarModeService.ReportRecoverySnapshot(generation, recovery);
                HostLog.Info("Taskbar replacement remained stable for 30 seconds; recovery failures cleared.");
            });
        }
        catch (OperationCanceledException) when (
            cancellation.IsCancellationRequested ||
            _isClosing ||
            Dispatcher.HasShutdownStarted)
        {
            // A newer taskbar transition owns stability confirmation.
        }
        catch (InvalidOperationException) when (_isClosing || Dispatcher.HasShutdownStarted)
        {
            // The host dispatcher can reject the final stability callback during exit.
        }
        finally
        {
            if (ReferenceEquals(
                    Interlocked.CompareExchange(
                        ref _taskbarStabilityCancellation,
                        null,
                        cancellation),
                    cancellation))
            {
                cancellation.Dispose();
            }
        }
    }

    private void CancelTaskbarStabilityConfirmation()
    {
        var cancellation = Interlocked.Exchange(ref _taskbarStabilityCancellation, null);
        cancellation?.Cancel();
        cancellation?.Dispose();
    }

    private void OnDisplaySettingsChanged(object? sender, EventArgs e)
    {
        _bridge?.PublishDisplayTopology();
        QueueTaskbarRebind("display-settings-changed", TimeSpan.FromMilliseconds(900));
    }

    private void ReconcileWindowSwitcherRuntime(string reason)
    {
        if (_isClosing || !_desktopReady)
        {
            return;
        }

        var state = _taskbarModeService.GetState();
        var decision = WindowSwitcherRuntimePolicy.Evaluate(
            _taskbarModeService.RequestedMode,
            state.SafeMode,
            IsWindowSwitcherDiagnosticEnabled());
        if (!decision.ShouldExist)
        {
            ReleaseWindowSwitcher($"{reason}; {decision.Reason}");
            return;
        }

        EnsureWindowSwitcher($"{reason}; {decision.Reason}");
    }

    private void EnsureWindowSwitcher(string reason)
    {
        if (_isClosing || _windowSwitcherWindow is not null)
        {
            return;
        }

        _windowSwitcherWindow = new WindowSwitcherWindow(
            () =>
            {
                UpdateWindowSwitcherAvailability();
                _ = ShowDiagnosticWindowSwitcherAsync();
            },
            status =>
            {
                HostLog.Warning($"JARVIS window switcher is unavailable: {status}.");
                SetWindowSwitcherEnabled(false);
            });
        _windowSwitcherController = new WindowSwitcherController(
            Dispatcher,
            _snapshotFeed,
            _taskbarService,
            _windowSwitcherWindow);
        if (!_windowSwitcherController.Start())
        {
            HostLog.Warning("Native Alt+Tab remains active because the JARVIS hook did not start.");
            ReleaseWindowSwitcher("hook registration failed");
            return;
        }

        // Create the HWND and warm WebView2 while fully transparent. Input is not
        // intercepted until both this renderer and full taskbar replacement report ready.
        _windowSwitcherWindow.Show();
        HostLog.Info($"JARVIS window-switcher runtime created ({reason}).");
    }

    private void ReleaseWindowSwitcher(string reason)
    {
        if (_windowSwitcherController is null && _windowSwitcherWindow is null)
        {
            return;
        }

        SetWindowSwitcherEnabled(false);
        var controller = _windowSwitcherController;
        var window = _windowSwitcherWindow;
        _windowSwitcherController = null;
        _windowSwitcherWindow = null;
        controller?.Dispose();
        window?.CloseFromHost();
        HostLog.Info($"JARVIS window-switcher runtime released ({reason}).");
    }

    private void EnsureQuickSearch()
    {
        if (_isClosing ||
            !_quickSearchShortcutSettings.Enabled ||
            _quickSearchWindow is not null)
        {
            return;
        }

        _quickSearchWindow = new QuickSearchWindow(
            _snapshotFeed,
            _desktopService,
            _shellService,
            _terminalSessionService,
            _taskbarService,
            _windowAppearanceService,
            _taskbarModeService,
            _trayStatusService,
            _systemFeedService,
            ReconcileGlobalQuickSearchShortcut,
            HandleGlobalQuickSearchFailure,
            ShowDesktop);

        // Warm WebView2 while the search surface is fully transparent. The
        // shortcut is registered only after the renderer reports ready.
        _quickSearchWindow.Show();
    }

    private void RegisterGlobalQuickSearchHotkey()
    {
        if (_isClosing ||
            !_quickSearchShortcutSettings.Enabled ||
            _quickSearchWindow?.IsReady != true ||
            _quickSearchHotkey is not null)
        {
            return;
        }

        _quickSearchHotkey = new GlobalQuickSearchHotkey(this, ToggleGlobalQuickSearch);
        if (_quickSearchHotkey.Register())
        {
            _quickSearchShortcutSettings.ReportRuntimeSettled();
            return;
        }

        _quickSearchHotkey.Dispose();
        _quickSearchHotkey = null;
        _quickSearchShortcutSettings.ReportRuntimeSettled();
    }

    private void OnQuickSearchShortcutPreferenceChanged()
    {
        if (Dispatcher.CheckAccess())
        {
            ReconcileGlobalQuickSearchShortcut();
            return;
        }

        Dispatcher.Invoke(ReconcileGlobalQuickSearchShortcut);
    }

    private void ReconcileGlobalQuickSearchShortcut()
    {
        if (_isClosing || !_desktopReady)
        {
            return;
        }

        if (!_quickSearchShortcutSettings.Enabled)
        {
            _quickSearchHotkey?.Dispose();
            _quickSearchHotkey = null;
            _quickSearchWindow?.Dismiss(restoreForeground: false);
            _quickSearchWindow?.CloseFromHost();
            _quickSearchWindow = null;
            HostLog.Info(
                "Global Ctrl+Alt+J Quick Search is disabled; its hidden renderer was released.");
            return;
        }

        if (_quickSearchWindow is null)
        {
            _quickSearchShortcutSettings.ReportRuntimeStarting();
            EnsureQuickSearch();
            return;
        }

        if (_quickSearchWindow.IsReady)
        {
            RegisterGlobalQuickSearchHotkey();
        }
    }

    private void HandleGlobalQuickSearchFailure(string status)
    {
        HostLog.Warning($"JARVIS global Quick Search is unavailable: {status}.");
        _quickSearchShortcutSettings.ReportRuntimeSettled();
        _quickSearchHotkey?.Dispose();
        _quickSearchHotkey = null;
        GlobalQuickSearchHotkey.ReportUnavailable(status);
        var failedWindow = _quickSearchWindow;
        _quickSearchWindow = null;
        failedWindow?.CloseFromHost();
    }

    private void ToggleGlobalQuickSearch()
    {
        if (_isClosing || _quickSearchWindow?.IsReady != true)
        {
            return;
        }

        _ = Dispatcher.BeginInvoke(() =>
        {
            if (!_isClosing && _quickSearchWindow?.IsReady == true)
            {
                _ = _quickSearchWindow.ToggleAsync();
            }
        });
    }

    private void OnTaskbarModeStateChanged(TaskbarModeState state)
    {
        _ = state;
        _ = Dispatcher.BeginInvoke(UpdateWindowSwitcherAvailability);
    }

    private void UpdateWindowSwitcherAvailability()
    {
        if (_isClosing)
        {
            return;
        }

        var state = _taskbarModeService.GetState();
        var enabled = _desktopReady &&
                      _windowSwitcherWindow?.IsReady == true &&
                      state.EffectiveMode.Equals("full", StringComparison.OrdinalIgnoreCase) &&
                      !state.SafeMode;
        SetWindowSwitcherEnabled(enabled);
    }

    private void SetWindowSwitcherEnabled(bool enabled)
    {
        _windowSwitcherController?.SetEnabled(enabled);
        if (_windowSwitcherEnabled == enabled)
        {
            return;
        }

        _windowSwitcherEnabled = enabled;
        HostLog.Info(enabled
            ? "JARVIS Alt+Tab interception is active."
            : "JARVIS Alt+Tab interception is inactive; Windows keeps the shortcut.");
    }

    private async Task ShowDiagnosticWindowSwitcherAsync()
    {
        if (_diagnosticWindowSwitcherShown ||
            !IsWindowSwitcherDiagnosticEnabled() ||
            _windowSwitcherWindow?.IsReady != true)
        {
            return;
        }

        _diagnosticWindowSwitcherShown = true;
        await Task.Delay(250);
        var selection = new WindowSwitcherSelectionMachine();
        var state = selection.Begin(_snapshotFeed.GetTaskbarSnapshot(), reverse: false);
        if (state is null)
        {
            HostLog.Warning("Window-switcher diagnostics found no eligible application windows.");
            return;
        }

        HostLog.Info("Opening persistent JARVIS window-switcher diagnostic surface.");
        await _windowSwitcherWindow.PresentAsync(state);
    }

    private static bool IsWindowSwitcherDiagnosticEnabled() =>
        Environment.GetEnvironmentVariable("JARVIS_WINDOW_SWITCHER_DIAGNOSTIC") == "1";

    private void OnPreviewDragOver(object sender, DragEventArgs e)
    {
        if (!e.Data.GetDataPresent(DataFormats.FileDrop))
        {
            return;
        }

        e.Effects = DragDropEffects.Copy;
        e.Handled = true;
    }

    private void OnPreviewDrop(object sender, DragEventArgs e)
    {
        if (!e.Data.GetDataPresent(DataFormats.FileDrop))
        {
            return;
        }

        if (e.Data.GetData(DataFormats.FileDrop) is not string[] droppedPaths)
        {
            e.Effects = DragDropEffects.None;
            e.Handled = true;
            return;
        }

        try
        {
            var paths = FileExplorerService.NormalizeOperationPaths(droppedPaths);
            var position = e.GetPosition(WebView);
            _bridge?.PublishExternalFileDrop(paths, position.X, position.Y);
            e.Effects = DragDropEffects.Copy;
        }
        catch (BridgeFaultException ex)
        {
            HostLog.Warning($"Rejected external file drop: {ex.Message}");
            e.Effects = DragDropEffects.None;
        }

        e.Handled = true;
    }

    private void OnRequestedTaskbarModeChanged()
    {
        CancelTaskbarStabilityConfirmation();
        _ = _taskbarRecoveryCircuit.Reset();
        QueueTaskbarRebind(
            "requested-mode-changed",
            TimeSpan.Zero,
            () => ReconcileWindowSwitcherRuntime("requested-mode-changed"));
    }

    private void OnTaskbarRetryRequested()
    {
        CancelTaskbarStabilityConfirmation();
        _ = _taskbarRecoveryCircuit.Reset();
        QueueTaskbarRebind(
            "manual-retry",
            TimeSpan.Zero,
            () => ReconcileWindowSwitcherRuntime("manual-retry"));
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

        var generation = _taskbarRebindEpoch.Next();
        CancelTaskbarStabilityConfirmation();
        _taskbarModeService.BeginTransition(
            generation,
            reason,
            _taskbarRecoveryCircuit.Capture(DateTimeOffset.UtcNow));
        CancelPendingTaskbarRebind();
        _ = Dispatcher.BeginInvoke(() =>
        {
            if (_isClosing)
            {
                return;
            }

            SetTaskbarLifecycleState(TaskbarLifecycleState.Recovering, reason);
            DisableTaskbarReplacement();
            SetTaskbarLifecycleState(TaskbarLifecycleState.NativeVisible, reason);
            ReportTaskbarOutcome(
                generation,
                TaskbarMode.Native,
                hybridAvailable: false,
                fallbackReason: $"The native taskbar is active during {reason}.",
                transitionReason: reason,
                countFailure: false);
        });
    }

    private void QueueTaskbarRebind(
        string reason,
        TimeSpan delay,
        Action? prepare = null)
    {
        if (_isClosing)
        {
            return;
        }

        var generation = _taskbarRebindEpoch.Next();
        CancelTaskbarStabilityConfirmation();
        _taskbarModeService.BeginTransition(
            generation,
            reason,
            _taskbarRecoveryCircuit.Capture(DateTimeOffset.UtcNow));
        var cancellation = new CancellationTokenSource();
        var previous = Interlocked.Exchange(ref _taskbarRebindCancellation, cancellation);
        previous?.Cancel();
        previous?.Dispose();
        _ = Dispatcher.BeginInvoke(
            () => _ = RebindTaskbarAsync(
                generation,
                reason,
                delay,
                prepare,
                cancellation.Token));
    }

    private async Task RebindTaskbarAsync(
        long generation,
        string reason,
        TimeSpan delay,
        Action? prepare,
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
                !_taskbarRebindEpoch.IsCurrent(generation))
            {
                return;
            }

            prepare?.Invoke();
            if (_isClosing || !_taskbarRebindEpoch.IsCurrent(generation))
            {
                return;
            }

            SetTaskbarLifecycleState(TaskbarLifecycleState.Rebinding, reason);
            DisableTaskbarReplacement();

            var requestedMode = _taskbarModeService.RequestedMode;
            if (!TryPositionDesktopSurface(TaskbarMode.Native))
            {
                SetTaskbarLifecycleState(TaskbarLifecycleState.NativeFallback, "desktop positioning failed");
                ReportTaskbarOutcome(
                    generation,
                    TaskbarMode.Native,
                    hybridAvailable: false,
                    fallbackReason: "The desktop host could not be positioned on the primary monitor.",
                    transitionReason: "desktop positioning failed",
                    countFailure: true);
                return;
            }

            var recovery = _taskbarRecoveryCircuit.Capture(DateTimeOffset.UtcNow);
            if (requestedMode != TaskbarMode.Native && recovery.IsOpen)
            {
                SetTaskbarLifecycleState(TaskbarLifecycleState.NativeFallback, "recovery cooldown active");
                _taskbarModeService.ReportEffectiveMode(
                    generation,
                    TaskbarMode.Native,
                    hybridAvailable: NativeShellSurfaceService.TryCapture(out _, out _),
                    fallbackReason: "Automatic taskbar replacement is paused after repeated failures.",
                    transitionReason: "recovery cooldown active",
                    recovery: recovery);
                return;
            }

            if (requestedMode == TaskbarMode.Native ||
                Environment.GetEnvironmentVariable("JARVIS_KEEP_NATIVE_TASKBAR") == "1")
            {
                SetTaskbarLifecycleState(TaskbarLifecycleState.NativeVisible, reason);
                ReportTaskbarOutcome(
                    generation,
                    TaskbarMode.Native,
                    hybridAvailable: false,
                    fallbackReason: requestedMode == TaskbarMode.Native
                        ? null
                        : "JARVIS_KEEP_NATIVE_TASKBAR=1 keeps the native Windows taskbar active.",
                    transitionReason: reason,
                    countFailure: false);
                return;
            }

            if (requestedMode == TaskbarMode.Hybrid)
            {
                if (!NativeShellSurfaceService.TryCapture(out var shellSurface, out var failureReason))
                {
                    SetTaskbarLifecycleState(TaskbarLifecycleState.NativeFallback, "hybrid probe failed");
                    ReportTaskbarOutcome(
                        generation,
                        TaskbarMode.Native,
                        hybridAvailable: false,
                        fallbackReason: failureReason ?? "Explorer's notification area is unavailable.",
                        transitionReason: "hybrid probe failed",
                        countFailure: true);
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
                ReportTaskbarOutcome(
                    generation,
                    TaskbarMode.Native,
                    hybridAvailable: NativeShellSurfaceService.TryCapture(out _, out _),
                    fallbackReason: "The visible bottom-aligned primary taskbar is unavailable for full replacement.",
                    transitionReason: "full target unavailable",
                    countFailure: true);
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
            if (!_taskbarRebindEpoch.IsCurrent(generation))
            {
                return;
            }

            HostLog.Error($"Taskbar rebind failed after {reason}.", ex);
            DisableTaskbarReplacement();
            SetTaskbarLifecycleState(TaskbarLifecycleState.NativeFallback, "rebind exception");
            ReportTaskbarOutcome(
                generation,
                TaskbarMode.Native,
                hybridAvailable: false,
                fallbackReason: "The taskbar lifecycle coordinator encountered an error and restored Windows.",
                transitionReason: "rebind exception",
                countFailure: true);
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
                _taskbarRebindEpoch.Current,
                TaskbarMode.Native,
                hybridAvailable: false,
                fallbackReason: transition.Reason,
                transitionReason: "unsafe lifecycle transition",
                recovery: _taskbarRecoveryCircuit.Capture(DateTimeOffset.UtcNow));
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
        _taskbarRebindEpoch.Current,
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
        SetWindowSwitcherEnabled(false);
        _taskbarReplacement.Restore();
        _ = TryPositionDesktopSurface(TaskbarMode.Native);
        var taskbarWindow = _taskbarWindow;
        _taskbarWindow = null;
        taskbarWindow?.Conceal();
        taskbarWindow?.CloseFromHost();
    }

    private TaskbarMode ResolveDesktopSurfaceMode()
    {
        var state = _taskbarModeService.GetState();
        return _taskbarLifecycle.State == TaskbarLifecycleState.ReplacementActive &&
               TaskbarModeService.TryParseMode(state.EffectiveMode, out var effectiveMode) &&
               effectiveMode == TaskbarMode.Full
            ? TaskbarMode.Full
            : TaskbarMode.Native;
    }

    private bool TryPositionDesktopSurface(TaskbarMode effectiveMode)
    {
        if (!NativeDisplay.TryGetPrimaryMonitor(out var monitor))
        {
            return false;
        }

        var keepNativeTaskbar =
            Environment.GetEnvironmentVariable("JARVIS_KEEP_NATIVE_TASKBAR") == "1";
        var bounds = DesktopSurfacePlacementPolicy.Resolve(
            monitor,
            effectiveMode,
            keepNativeTaskbar);
        return NativeDisplay.PositionWindow(this, bounds);
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
        _taskbarRebindEpoch.Invalidate();
        CancelPendingTaskbarRebind();
        CancelTaskbarStabilityConfirmation();
        SystemEvents.DisplaySettingsChanged -= OnDisplaySettingsChanged;
        SystemEvents.PowerModeChanged -= OnPowerModeChanged;
        SystemEvents.SessionSwitch -= OnSessionSwitch;
        _taskbarReplacement.ReplacementLost -= OnTaskbarReplacementLost;
        _taskbarModeService.RequestedModeChanged -= OnRequestedTaskbarModeChanged;
        _taskbarModeService.RetryRequested -= OnTaskbarRetryRequested;
        _taskbarModeService.StateChanged -= OnTaskbarModeStateChanged;
        _quickSearchShortcutSettings.EnabledChanged -= OnQuickSearchShortcutPreferenceChanged;
        _snapshotFeed.SnapshotAvailable -= OnRuntimeSnapshotAvailable;
        _windowSource?.RemoveHook(WindowProcedure);
        _windowSource = null;
        _bridge?.Dispose();
        _safetyHotkey?.Dispose();
        _safetyHotkey = null;
        _quickSearchHotkey?.Dispose();
        _quickSearchHotkey = null;
        _quickSearchWindow?.CloseFromHost();
        _quickSearchWindow = null;
        ReleaseWindowSwitcher("host shutdown");
        // Restore third-party DWM values and remove the recovery snapshot before
        // asking the taskbar watchdog to finish its own recovery pass.
        _windowAppearanceService.Dispose();
        _taskbarReplacement.Dispose();
        _taskbarWindow?.CloseFromHost();
        _taskbarWindow = null;
        _systemFeedService.Dispose();
        _trayStatusService.Dispose();
        _snapshotFeed.Dispose();
        _taskbarService.Dispose();
        _audioEndpointService.Dispose();
        _terminalSessionService.Dispose();
        _shellService.Dispose();
        _desktopService.Dispose();
        WebView.Dispose();
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int RegisterWindowMessage(string messageName);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(IntPtr window, int command);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr64(IntPtr window, int index);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern IntPtr GetWindowLong32(IntPtr window, int index);

    private static IntPtr GetWindowLongPtr(IntPtr window, int index) =>
        IntPtr.Size == 8 ? GetWindowLongPtr64(window, index) : GetWindowLong32(window, index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr64(IntPtr window, int index, IntPtr newValue);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
    private static extern IntPtr SetWindowLong32(IntPtr window, int index, IntPtr newValue);

    private static IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr newValue) =>
        IntPtr.Size == 8
            ? SetWindowLongPtr64(window, index, newValue)
            : SetWindowLong32(window, index, newValue);
}
