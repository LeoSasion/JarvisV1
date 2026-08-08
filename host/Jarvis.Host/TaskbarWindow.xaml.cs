using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using Jarvis.Host.Bridge;
using Jarvis.Host.Infrastructure;
using Jarvis.Host.Services;
using Microsoft.Web.WebView2.Core;

namespace Jarvis.Host;

public partial class TaskbarWindow : Window
{
    private const int GwlExStyle = -20;
    private const long WsExNoActivate = 0x08000000L;
    private const int WmMouseActivate = 0x0021;
    private const int MaNoActivate = 3;

    private readonly PixelRect _bounds;
    private readonly TaskbarMode _mode;
    private readonly PixelRect? _notificationAreaBounds;
    private readonly Action _surfaceReady;
    private readonly Action _surfaceFailed;
    private readonly Action _requestExit;
    private readonly Action<string?> _showDesktop;
    private readonly CancellationTokenSource _healthShutdown = new();
    private readonly RuntimeSnapshotFeed _snapshotFeed;
    private readonly WindowTaskbarService _taskbarService;
    private readonly DesktopService _desktopService;
    private readonly ShellService _shellService;
    private readonly TerminalSessionService _terminalSessionService;
    private readonly NativeWindowAppearanceService _windowAppearanceService;
    private readonly TaskbarModeService _taskbarModeService;
    private readonly TrayStatusService _trayStatusService;
    private readonly SystemFeedService _systemFeedService;

    private WebBridge? _bridge;
    private TaskbarEdgeOverlayWindow? _edgeOverlayWindow;
    private TaskbarFlyoutWindow? _flyoutWindow;
    private HwndSource? _windowSource;
    private Task? _healthTask;
    private bool _allowClose;
    private bool _isClosing;
    private bool _diagnosticFlyoutShown;
    private bool _diagnosticShowDesktopSequenceStarted;
    private bool _reportedReady;
    private bool _reportedFailure;
    private bool _surfaceRevealed;
    private bool _fullscreenSuppressed;
    private string? _fullscreenSourceWindowId;

    internal TaskbarWindow(
        PixelRect bounds,
        TaskbarMode mode,
        PixelRect? notificationAreaBounds,
        RuntimeSnapshotFeed snapshotFeed,
        WindowTaskbarService taskbarService,
        DesktopService desktopService,
        ShellService shellService,
        TerminalSessionService terminalSessionService,
        NativeWindowAppearanceService windowAppearanceService,
        TaskbarModeService taskbarModeService,
        TrayStatusService trayStatusService,
        SystemFeedService systemFeedService,
        Action surfaceReady,
        Action surfaceFailed,
        Action requestExit,
        Action<string?> showDesktop)
    {
        _bounds = bounds;
        _mode = mode;
        _notificationAreaBounds = notificationAreaBounds;
        _snapshotFeed = snapshotFeed;
        _taskbarService = taskbarService;
        _desktopService = desktopService;
        _shellService = shellService;
        _terminalSessionService = terminalSessionService;
        _windowAppearanceService = windowAppearanceService;
        _taskbarModeService = taskbarModeService;
        _trayStatusService = trayStatusService;
        _systemFeedService = systemFeedService;
        _surfaceReady = surfaceReady;
        _surfaceFailed = surfaceFailed;
        _requestExit = requestExit;
        _showDesktop = showDesktop;
        InitializeComponent();
    }

    internal IntPtr NativeHandle => new WindowInteropHelper(this).Handle;

    public void Reveal()
    {
        _surfaceRevealed = true;
        ApplySurfaceVisibility();
    }

    public void Conceal()
    {
        _surfaceRevealed = false;
        ApplySurfaceVisibility();
    }

    public void SetFullscreenSuppressed(
        bool suppressed,
        string? foregroundWindowId = null)
    {
        if (_fullscreenSuppressed == suppressed)
        {
            return;
        }

        var sourceWindowId = suppressed
            ? foregroundWindowId
            : _fullscreenSourceWindowId;
        _fullscreenSuppressed = suppressed;
        _fullscreenSourceWindowId = suppressed
            ? foregroundWindowId
            : null;
        ApplySurfaceVisibility();
        var source = string.IsNullOrWhiteSpace(sourceWindowId)
            ? "unknown foreground"
            : sourceWindowId;
        HostLog.Info(suppressed
            ? $"JARVIS taskbar surface suppressed for primary-monitor fullscreen foreground {source}."
            : $"JARVIS taskbar surface restored after fullscreen foreground {source} ended.");
    }

    private bool ShouldShowSurface() =>
        TaskbarSurfaceVisibilityPolicy.ShouldShow(
            _surfaceRevealed,
            _fullscreenSuppressed);

    private void ApplySurfaceVisibility()
    {
        if (!ShouldShowSurface())
        {
            CloseTaskbarOverlays();
            HideTaskbarFlyout();
            IsHitTestVisible = false;
            Opacity = 0;
            Hide();
            return;
        }

        if (!IsVisible)
        {
            Show();
        }

        Opacity = 1;
        IsHitTestVisible = true;
        _ = ShowTaskbarOverlaysAsync();
        _ = ShowDiagnosticFlyoutAfterSurfaceReadyAsync();
        _ = RunDiagnosticShowDesktopSequenceAfterSurfaceReadyAsync();
    }

    public void CloseFromHost()
    {
        _allowClose = true;
        CloseTaskbarOverlays();
        Close();
    }

    private async Task ShowTaskbarOverlaysAsync()
    {
        if (!ShouldShowSurface() || _isClosing || WebView.CoreWebView2 is null)
        {
            return;
        }

        try
        {
            const string metricsScript = """
                (() => {
                  return {
                    ViewportWidth: window.innerWidth,
                    ViewportHeight: window.innerHeight
                  };
                })()
                """;
            var json = await WebView.CoreWebView2.ExecuteScriptAsync(metricsScript);
            var metrics = JsonSerializer.Deserialize<TaskbarOverlayMetrics>(json);
            if (metrics is null ||
                metrics.ViewportWidth <= 0 ||
                metrics.ViewportHeight <= 0 ||
                !ShouldShowSurface() ||
                _isClosing)
            {
                return;
            }

            var verticalScale = _bounds.Height / metrics.ViewportHeight;
            var horizontalScale = _bounds.Width / metrics.ViewportWidth;
            var edgeInset = Math.Max(1, checked((int)Math.Round(13 * horizontalScale)));
            var edgeHeight = Math.Max(5, checked((int)Math.Round(9 * verticalScale)));
            var edgeTop = _bounds.Top - edgeHeight / 2;
            var edgeBounds = new PixelRect(
                _bounds.Left + edgeInset,
                edgeTop,
                _bounds.Right - edgeInset,
                edgeTop + edgeHeight);
            _edgeOverlayWindow ??= new TaskbarEdgeOverlayWindow();
            if (!_edgeOverlayWindow.ShowAt(edgeBounds, NativeHandle))
            {
                HostLog.Warning("The taskbar edge overlay could not be positioned.");
            }
        }
        catch (InvalidOperationException) when (_isClosing || !ShouldShowSurface())
        {
            // The WebView or overlay may close while taskbar replacement is being restored.
        }
        catch (Exception ex)
        {
            HostLog.Error("The taskbar chrome overlays could not be shown.", ex);
            CloseTaskbarOverlays();
        }
    }

    private void CloseTaskbarOverlays()
    {
        var edgeOverlay = _edgeOverlayWindow;
        _edgeOverlayWindow = null;
        edgeOverlay?.Close();
    }

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        if (!NativeDisplay.PositionWindow(this, _bounds))
        {
            ReportFailure("TASKBAR POSITIONING FAILED");
            return;
        }
        else if (_mode == TaskbarMode.Hybrid &&
                 (!_notificationAreaBounds.HasValue ||
                  !NativeShellSurfaceService.ApplyNotificationAreaExclusion(
                      this,
                      _bounds,
                      _notificationAreaBounds.Value)))
        {
            ReportFailure("HYBRID NOTIFICATION REGION FAILED");
            return;
        }
        else if (_mode != TaskbarMode.Hybrid)
        {
            NativeShellSurfaceService.ClearWindowRegion(this);
        }

        var handle = new WindowInteropHelper(this).Handle;
        if (handle != IntPtr.Zero)
        {
            var extendedStyle = GetWindowLongPtr(handle, GwlExStyle).ToInt64();
            _ = SetWindowLongPtr(handle, GwlExStyle, new IntPtr(extendedStyle | WsExNoActivate));
            _windowSource = HwndSource.FromHwnd(handle);
            _windowSource?.AddHook(WindowProcedure);
        }
    }

    private static IntPtr WindowProcedure(
        IntPtr window,
        int message,
        IntPtr wordParameter,
        IntPtr longParameter,
        ref bool handled)
    {
        if (message == WmMouseActivate)
        {
            handled = true;
            return new IntPtr(MaNoActivate);
        }

        return IntPtr.Zero;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            HostLog.Info("Taskbar window loaded; initializing WebView2.");
            await InitializeWebViewAsync();
            HostLog.Info("Taskbar WebView2 initialization completed; awaiting navigation.");
        }
        catch (OperationCanceledException) when (_healthShutdown.IsCancellationRequested)
        {
            // A rebind can intentionally close a concealed surface during prewarming.
        }
        catch (Exception) when (_isClosing || _healthShutdown.IsCancellationRequested)
        {
            // Observe an initialization failure that raced intentional surface release.
        }
        catch (Exception ex)
        {
            HostLog.Error("Taskbar WebView2 initialization failed.", ex);
            ReportFailure($"TASKBAR STARTUP FAILED · {ex.Message}");
        }
    }

    private async Task InitializeWebViewAsync()
    {
        var frontendDirectory = FrontendLocator.FindDistributionDirectory();
        var environment = await WebViewEnvironmentProvider.GetAsync();
        _healthShutdown.Token.ThrowIfCancellationRequested();
        await WebView.EnsureCoreWebView2Async(environment);
        _healthShutdown.Token.ThrowIfCancellationRequested();

        WebViewHostConfiguration.Apply(
            WebView.CoreWebView2,
            frontendDirectory,
            "taskbar",
            args =>
            {
                HostLog.Error($"Taskbar WebView2 process failed: {args.ProcessFailedKind}.");
                Dispatcher.BeginInvoke(() => ReportFailure("TASKBAR RENDERER FAILED"));
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
                _taskbarModeService),
            _requestExit,
            _showDesktop,
            ShowTaskbarFlyout,
            HideTaskbarFlyout,
            terminalEnabled: false);
        _bridge.Attach();

        WebView.CoreWebView2.NavigationCompleted += OnNavigationCompleted;
        var source = WebViewHostConfiguration.CreateAppUri(
            $"surface=taskbar&taskbarMode={TaskbarModeService.ToWireValue(_mode)}");
        HostLog.Info($"Navigating taskbar surface to {source}.");
        WebView.Source = source;
    }

    private async void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (_reportedFailure)
        {
            return;
        }

        if (!e.IsSuccess)
        {
            HostLog.Error($"Taskbar surface navigation failed: {e.WebErrorStatus}.");
            ReportFailure($"TASKBAR LOAD FAILED · {e.WebErrorStatus}");
            return;
        }

        try
        {
            HostLog.Info("Taskbar surface navigation completed; probing DOM readiness.");
            // The taskbar bundle is loaded independently from the desktop bundle. Poll the
            // synchronous layout probe for a bounded period; requestAnimationFrame may be
            // suspended while this safety-critical window is fully transparent.
            const string readinessScript = """
                (() => {
                  const taskbar = document.querySelector('.jarvis-taskbar-surface .taskbar');
                  const rect = taskbar?.getBoundingClientRect();
                  return Boolean(rect && rect.width > 0 && rect.height > 0);
                })()
                """;
            var ready = false;
            for (var attempt = 0; attempt < 40 && !ready; attempt++)
            {
                var result = await WebView.CoreWebView2
                    .ExecuteScriptAsync(readinessScript)
                    .WaitAsync(TimeSpan.FromSeconds(1), _healthShutdown.Token);
                ready = result.Equals("true", StringComparison.OrdinalIgnoreCase);
                if (!ready)
                {
                    await Task.Delay(50, _healthShutdown.Token);
                }
            }

            if (!ready)
            {
                ReportFailure("TASKBAR DOM NOT READY");
                return;
            }

            HostLog.Info("Taskbar DOM readiness confirmed.");
            LoadingOverlay.Visibility = Visibility.Collapsed;
            if (_bridge is not null)
            {
                await _bridge.StartTelemetryAsync();
            }

            _healthShutdown.Token.ThrowIfCancellationRequested();
            _healthTask ??= MonitorTaskbarSurfaceAsync(_healthShutdown.Token);

            if (!_reportedReady)
            {
                _reportedReady = true;
                HostLog.Info("Taskbar surface reporting ready to the desktop host.");
                _surfaceReady();
            }
        }
        catch (OperationCanceledException) when (_healthShutdown.IsCancellationRequested)
        {
            // Expected when the host is closed while the renderer readiness probe is active.
        }
        catch (Exception ex)
        {
            if (_isClosing)
            {
                return;
            }

            HostLog.Error("Taskbar readiness check failed.", ex);
            ReportFailure("TASKBAR READINESS CHECK FAILED");
        }
    }

    private async Task MonitorTaskbarSurfaceAsync(CancellationToken cancellationToken)
    {
        try
        {
            while (true)
            {
                await Task.Delay(TimeSpan.FromSeconds(2), cancellationToken);
                var probe = WebView.CoreWebView2.ExecuteScriptAsync(
                    "Boolean(document.querySelector('.jarvis-taskbar-surface .taskbar'));");
                var result = await probe.WaitAsync(TimeSpan.FromSeconds(3), cancellationToken);
                if (!result.Equals("true", StringComparison.OrdinalIgnoreCase))
                {
                    ReportFailure("TASKBAR HEARTBEAT FAILED");
                    return;
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Expected during a normal host shutdown.
        }
        catch (Exception ex)
        {
            if (_isClosing || cancellationToken.IsCancellationRequested)
            {
                return;
            }

            HostLog.Error("Taskbar surface heartbeat failed.", ex);
            ReportFailure("TASKBAR HEARTBEAT FAILED");
        }
    }

    private void ShowTaskbarFlyout(TaskbarFlyoutRequest request) =>
        ShowTaskbarFlyout(
            request,
            autoDismiss: !TaskbarFlyoutWindow.IsKeyboardInteractiveMode(request.Mode));

    private void ShowTaskbarFlyout(TaskbarFlyoutRequest request, bool autoDismiss)
    {
        HideTaskbarFlyout();

        var requestedIds = request.WindowIds.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var windows = _snapshotFeed.GetTaskbarSnapshot().Windows
            .Where(window => requestedIds.Contains(window.WindowId))
            .OrderByDescending(window => window.Active)
            .ThenBy(window => window.Minimized)
            .ToArray();
        if (windows.Length == 0 && request.Mode != "context" && request.OverflowItems.Count == 0)
        {
            return;
        }

        var relativeAnchor = Math.Clamp(request.AnchorX / request.ViewportWidth, 0d, 1d);
        var anchorScreenX = _bounds.Left + checked((int)Math.Round(relativeAnchor * _bounds.Width));
        _flyoutWindow = new TaskbarFlyoutWindow(
            windows,
            _taskbarService,
            _bounds,
            anchorScreenX,
            request,
            autoDismiss,
            ForwardTaskbarContextAction,
            () => _flyoutWindow = null);
        _flyoutWindow.Show();
    }

    private async void ForwardTaskbarContextAction(string itemId, string action, string? windowId = null)
    {
        if (_isClosing || WebView.CoreWebView2 is null)
        {
            return;
        }

        try
        {
            var detail = JsonSerializer.Serialize(new { itemId, action, windowId });
            await WebView.CoreWebView2.ExecuteScriptAsync(
                $"window.dispatchEvent(new CustomEvent('jarvis:taskbar-action', {{ detail: {detail} }}));");
        }
        catch (InvalidOperationException) when (_isClosing)
        {
            // The renderer may close after a context command is selected.
        }
        catch (Exception ex)
        {
            HostLog.Error("Taskbar context action could not be forwarded to the renderer.", ex);
        }
    }

    private void HideTaskbarFlyout()
    {
        var flyout = _flyoutWindow;
        _flyoutWindow = null;
        flyout?.Close();
    }

    private void ShowDiagnosticFlyout()
    {
        var requestedProcess = Environment.GetEnvironmentVariable(
            "JARVIS_TASKBAR_DIAGNOSTIC_FLYOUT_PROCESS");
        if (string.IsNullOrWhiteSpace(requestedProcess))
        {
            return;
        }

        if (_diagnosticFlyoutShown)
        {
            return;
        }

        HostLog.Info($"Taskbar diagnostic flyout is evaluating process {requestedProcess}.");

        try
        {
            var normalizedProcess = Path.GetFileNameWithoutExtension(requestedProcess.Trim());
            var windowIds = _snapshotFeed.GetTaskbarSnapshot().Windows
                .Where(window => Path.GetFileNameWithoutExtension(window.ProcessName)
                    .Equals(normalizedProcess, StringComparison.OrdinalIgnoreCase))
                .Select(window => window.WindowId)
                .Take(6)
                .ToArray();
            if (windowIds.Length == 0)
            {
                HostLog.Warning(
                    $"Taskbar diagnostic flyout found no windows for process {normalizedProcess}.");
                return;
            }

            _diagnosticFlyoutShown = true;
            ShowTaskbarFlyout(
                new TaskbarFlyoutRequest(
                    "windows",
                    windowIds,
                    Array.Empty<TaskbarOverflowItem>(),
                    _bounds.Width / 2d,
                    _bounds.Width,
                    null,
                    null,
                    Array.Empty<string>()),
                autoDismiss: false);
            HostLog.Info(
                $"Taskbar diagnostic flyout opened for {normalizedProcess} with {windowIds.Length} windows.");
            if (string.Equals(
                    Environment.GetEnvironmentVariable("JARVIS_TASKBAR_DIAGNOSTIC_TOGGLE_SEQUENCE"),
                    "1",
                    StringComparison.Ordinal))
            {
                _ = RunDiagnosticToggleSequenceAsync(windowIds[0]);
            }
        }
        catch (Exception ex)
        {
            HostLog.Error("Taskbar diagnostic flyout failed.", ex);
        }
    }

    private async Task RunDiagnosticToggleSequenceAsync(string windowId)
    {
        try
        {
            var firstResult = _taskbarService.Toggle(windowId);
            HostLog.Info($"Taskbar diagnostic toggle action: {firstResult.Action}.");
            await Task.Delay(350, _healthShutdown.Token);

            var secondResult = _taskbarService.Toggle(windowId);
            HostLog.Info($"Taskbar diagnostic second toggle action: {secondResult.Action}.");
            await Task.Delay(350, _healthShutdown.Token);

            var restoreResult = _taskbarService.Toggle(windowId);
            HostLog.Info($"Taskbar diagnostic restore action: {restoreResult.Action}.");
        }
        catch (OperationCanceledException) when (_healthShutdown.IsCancellationRequested)
        {
            // The diagnostic sequence is abandoned during normal shutdown.
        }
        catch (Exception ex)
        {
            HostLog.Error("Taskbar diagnostic toggle sequence failed.", ex);
        }
    }

    private async Task RunDiagnosticShowDesktopSequenceAfterSurfaceReadyAsync()
    {
        if (_diagnosticShowDesktopSequenceStarted ||
            !string.Equals(
                Environment.GetEnvironmentVariable(
                    "JARVIS_TASKBAR_DIAGNOSTIC_SHOW_DESKTOP_SEQUENCE"),
                "1",
                StringComparison.Ordinal))
        {
            return;
        }

        _diagnosticShowDesktopSequenceStarted = true;
        try
        {
            await Task.Delay(500, _healthShutdown.Token);
            var showResult = _taskbarService.ToggleDesktop(
                hasVisibleInternalWindow: false);
            HostLog.Info(
                "Show Desktop diagnostic hide action: " +
                $"{showResult.Action}; affected={showResult.AffectedWindowCount}; " +
                $"restoreAvailable={showResult.RestoreAvailable}.");

            await Task.Delay(500, _healthShutdown.Token);
            var restoreResult = _taskbarService.ToggleDesktop(
                hasVisibleInternalWindow: false);
            HostLog.Info(
                "Show Desktop diagnostic restore action: " +
                $"{restoreResult.Action}; affected={restoreResult.AffectedWindowCount}; " +
                $"restoreAvailable={restoreResult.RestoreAvailable}.");
        }
        catch (OperationCanceledException) when (_healthShutdown.IsCancellationRequested)
        {
            // The diagnostic sequence is abandoned during normal shutdown.
        }
        catch (Exception ex)
        {
            HostLog.Error("Show Desktop diagnostic sequence failed.", ex);
        }
    }

    private async Task ShowDiagnosticFlyoutAfterSurfaceReadyAsync()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(
                "JARVIS_TASKBAR_DIAGNOSTIC_FLYOUT_PROCESS")))
        {
            return;
        }

        // The taskbar React surface dismisses stale flyouts during its first mount.
        // Wait until Reveal, which only occurs after the native replacement handshake,
        // and then let that mount cleanup settle before opening the diagnostic preview.
        try
        {
            await Task.Delay(250, _healthShutdown.Token);
        }
        catch (OperationCanceledException) when (_healthShutdown.IsCancellationRequested)
        {
            return;
        }

        if (!_reportedFailure && !_allowClose && IsVisible)
        {
            ShowDiagnosticFlyout();
        }
    }

    private void ReportFailure(string status)
    {
        if (_isClosing)
        {
            return;
        }

        StatusText.Text = status;
        LoadingOverlay.Visibility = Visibility.Visible;
        if (_reportedFailure)
        {
            return;
        }

        _reportedFailure = true;
        _healthShutdown.Cancel();
        CloseTaskbarOverlays();
        HideTaskbarFlyout();
        _surfaceFailed();
    }

    private void OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        var isSafetyChord = e.Key == Key.Q &&
                            Keyboard.Modifiers.HasFlag(ModifierKeys.Control) &&
                            Keyboard.Modifiers.HasFlag(ModifierKeys.Shift);
        if (!isSafetyChord)
        {
            return;
        }

        e.Handled = true;
        _requestExit();
    }

    private void OnClosing(object? sender, CancelEventArgs e)
    {
        if (!_allowClose)
        {
            e.Cancel = true;
            _requestExit();
            return;
        }

        _isClosing = true;
        _healthShutdown.Cancel();
        CloseTaskbarOverlays();
        HideTaskbarFlyout();
        _windowSource?.RemoveHook(WindowProcedure);
        _windowSource = null;
        _bridge?.Dispose();
        WebView.Dispose();
    }

    private sealed record TaskbarOverlayMetrics(
        double ViewportWidth,
        double ViewportHeight);

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
