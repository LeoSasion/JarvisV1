using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using Jarvis.Host.Bridge;
using Jarvis.Host.Infrastructure;
using Jarvis.Host.Services;
using Microsoft.Web.WebView2.Core;

namespace Jarvis.Host;

public partial class QuickSearchWindow : Window
{
    private const int GwlExStyle = -20;
    private const long WsExToolWindow = 0x00000080L;
    private const long WsExAppWindow = 0x00040000L;
    private static readonly IntPtr HwndTopmost = new(-1);

    private readonly RuntimeSnapshotFeed _snapshotFeed;
    private readonly DesktopService _desktopService;
    private readonly ShellService _shellService;
    private readonly TerminalSessionService _terminalSessionService;
    private readonly WindowTaskbarService _taskbarService;
    private readonly NativeWindowAppearanceService _windowAppearanceService;
    private readonly TaskbarModeService _taskbarModeService;
    private readonly TrayStatusService _trayStatusService;
    private readonly SystemFeedService _systemFeedService;
    private readonly Action _ready;
    private readonly Action<string> _failed;
    private readonly Action<string?> _showDesktop;
    private readonly CancellationTokenSource _shutdown = new();

    private WebBridge? _bridge;
    private IntPtr _previousForegroundWindow;
    private bool _allowClose;
    private bool _isClosing;
    private bool _dismissing;
    private bool _failureReported;
    private bool _readyReported;
    private int _readyState;

    internal QuickSearchWindow(
        RuntimeSnapshotFeed snapshotFeed,
        DesktopService desktopService,
        ShellService shellService,
        TerminalSessionService terminalSessionService,
        WindowTaskbarService taskbarService,
        NativeWindowAppearanceService windowAppearanceService,
        TaskbarModeService taskbarModeService,
        TrayStatusService trayStatusService,
        SystemFeedService systemFeedService,
        Action ready,
        Action<string> failed,
        Action<string?> showDesktop)
    {
        _snapshotFeed = snapshotFeed;
        _desktopService = desktopService;
        _shellService = shellService;
        _terminalSessionService = terminalSessionService;
        _taskbarService = taskbarService;
        _windowAppearanceService = windowAppearanceService;
        _taskbarModeService = taskbarModeService;
        _trayStatusService = trayStatusService;
        _systemFeedService = systemFeedService;
        _ready = ready;
        _failed = failed;
        _showDesktop = showDesktop;
        InitializeComponent();
    }

    internal bool IsReady => Volatile.Read(ref _readyState) == 1;

    internal async Task ToggleAsync()
    {
        if (_isClosing || !IsReady)
        {
            return;
        }

        if (IsVisible && Opacity > 0)
        {
            Dismiss(restoreForeground: true);
            return;
        }

        await PresentAsync();
    }

    internal void Dismiss(bool restoreForeground)
    {
        if (_isClosing || _dismissing)
        {
            return;
        }

        _dismissing = true;
        try
        {
            IsHitTestVisible = false;
            Opacity = 0;
            Hide();
            if (restoreForeground)
            {
                RestorePreviousForegroundWindow();
            }
        }
        finally
        {
            _previousForegroundWindow = IntPtr.Zero;
            _dismissing = false;
        }
    }

    internal void CloseFromHost()
    {
        _allowClose = true;
        Close();
    }

    private async Task PresentAsync()
    {
        if (WebView.CoreWebView2 is null)
        {
            ReportFailure("RENDERER UNAVAILABLE");
            return;
        }

        var handle = new WindowInteropHelper(this).Handle;
        if (handle == IntPtr.Zero)
        {
            ReportFailure("WINDOW HANDLE UNAVAILABLE");
            return;
        }

        var foreground = GetForegroundWindow();
        _previousForegroundWindow = foreground != handle ? foreground : IntPtr.Zero;
        var usedPrimaryFallback = !NativeDisplay.TryGetMonitorForWindow(
            _previousForegroundWindow,
            out var targetMonitor);
        if (usedPrimaryFallback &&
            !NativeDisplay.TryGetPrimaryMonitor(out targetMonitor))
        {
            ReportFailure("DISPLAY WORK AREA UNAVAILABLE");
            return;
        }

        if (!QuickSearchPlacement.TryCalculate(
                targetMonitor.WorkArea,
                targetMonitor.ScalePercent,
                out var windowBounds))
        {
            ReportFailure("DISPLAY WORK AREA UNSUPPORTED");
            return;
        }

        HostLog.Info(
            $"Global Quick Search placement: " +
            $"source={(usedPrimaryFallback ? "primary-fallback" : "foreground")} " +
            $"monitor={targetMonitor.DeviceName} " +
            $"primary={targetMonitor.IsPrimary} " +
            $"scale={targetMonitor.ScalePercent}% " +
            $"workArea={FormatRect(targetMonitor.WorkArea)} " +
            $"window={FormatRect(windowBounds)}.");
        if (usedPrimaryFallback)
        {
            _systemFeedService.Add(
                "quick-search.monitor-fallback",
                "warning",
                "Quick Search used the primary display",
                "The foreground application monitor was unavailable; the local search HUD used the primary monitor.",
                actionId: null,
                deduplicationKey: "quick-search.monitor-fallback");
        }

        IsHitTestVisible = true;
        Show();
        if (!SetWindowPos(
                handle,
                HwndTopmost,
                windowBounds.Left,
                windowBounds.Top,
                windowBounds.Width,
                windowBounds.Height,
                0))
        {
            ReportFailure("POSITIONING FAILED");
            return;
        }

        Opacity = 1;
        _ = Activate();
        _ = SetForegroundWindow(handle);
        _ = WebView.Focus();

        try
        {
            await WebView.CoreWebView2.ExecuteScriptAsync(
                "window.dispatchEvent(new CustomEvent('jarvis:global-search-open'));");
        }
        catch (Exception ex)
        {
            HostLog.Error("The global Quick Search renderer could not start a session.", ex);
            ReportFailure("SESSION START FAILED");
        }
    }

    private static string FormatRect(PixelRect rectangle) =>
        $"{rectangle.Left},{rectangle.Top}," +
        $"{rectangle.Width}x{rectangle.Height}";

    private void RestorePreviousForegroundWindow()
    {
        var previous = _previousForegroundWindow;
        if (previous == IntPtr.Zero ||
            !IsWindow(previous) ||
            !IsWindowVisible(previous))
        {
            return;
        }

        _ = SetForegroundWindow(previous);
    }

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        var handle = new WindowInteropHelper(this).Handle;
        if (handle == IntPtr.Zero)
        {
            ReportFailure("WINDOW HANDLE UNAVAILABLE");
            return;
        }

        var extendedStyle = GetWindowLongPtr(handle, GwlExStyle).ToInt64();
        var quickSearchStyle = (extendedStyle | WsExToolWindow) & ~WsExAppWindow;
        _ = SetWindowLongPtr(handle, GwlExStyle, new IntPtr(quickSearchStyle));
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            await InitializeWebViewAsync();
        }
        catch (Exception ex)
        {
            HostLog.Error("Global Quick Search WebView2 initialization failed.", ex);
            ReportFailure($"STARTUP FAILED · {ex.Message}");
        }
    }

    private async Task InitializeWebViewAsync()
    {
        var frontendDirectory = FrontendLocator.FindDistributionDirectory();
        var environment = await WebViewEnvironmentProvider.GetAsync();
        await WebView.EnsureCoreWebView2Async(environment);
        WebViewHostConfiguration.Apply(
            WebView.CoreWebView2,
            frontendDirectory,
            "global-quick-search",
            args =>
            {
                HostLog.Error($"Global Quick Search WebView2 process failed: {args.ProcessFailedKind}.");
                Dispatcher.BeginInvoke(() => ReportFailure("RENDERER PROCESS FAILED"));
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
            requestExit: () => { },
            showDesktop: _showDesktop,
            terminalEnabled: false,
            profile: WebBridgeProfile.GlobalSearch,
            dismissSurface: restoreForeground =>
                Dispatcher.BeginInvoke(() => Dismiss(restoreForeground)));
        _bridge.Attach();

        WebView.CoreWebView2.NavigationCompleted += OnNavigationCompleted;
        WebView.Source = WebViewHostConfiguration.CreateAppUri("surface=search");
    }

    private async void OnNavigationCompleted(
        object? sender,
        CoreWebView2NavigationCompletedEventArgs e)
    {
        if (!e.IsSuccess)
        {
            ReportFailure($"LOAD FAILED · {e.WebErrorStatus}");
            return;
        }

        try
        {
            const string readinessScript = """
                Boolean(document.querySelector('.jarvis-global-search'));
                """;
            var ready = false;
            for (var attempt = 0; attempt < 40 && !ready; attempt++)
            {
                var result = await WebView.CoreWebView2
                    .ExecuteScriptAsync(readinessScript)
                    .WaitAsync(TimeSpan.FromSeconds(1), _shutdown.Token);
                ready = result.Equals("true", StringComparison.OrdinalIgnoreCase);
                if (!ready)
                {
                    await Task.Delay(50, _shutdown.Token);
                }
            }

            if (!ready)
            {
                ReportFailure("DOM NOT READY");
                return;
            }

            if (_bridge is not null)
            {
                await _bridge.StartTelemetryAsync();
            }

            LoadingOverlay.Visibility = Visibility.Collapsed;
            Volatile.Write(ref _readyState, 1);
            Dismiss(restoreForeground: false);
            if (!_readyReported)
            {
                _readyReported = true;
                HostLog.Info("JARVIS global Quick Search surface is ready.");
                _ready();
            }
        }
        catch (OperationCanceledException) when (_shutdown.IsCancellationRequested)
        {
            // Expected during shutdown.
        }
        catch (Exception ex)
        {
            HostLog.Error("Global Quick Search readiness probe failed.", ex);
            ReportFailure("READINESS CHECK FAILED");
        }
    }

    private void OnDeactivated(object? sender, EventArgs e)
    {
        if (IsVisible && Opacity > 0)
        {
            Dismiss(restoreForeground: false);
        }
    }

    private void OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Escape)
        {
            return;
        }

        e.Handled = true;
        Dismiss(restoreForeground: true);
    }

    private void ReportFailure(string status)
    {
        if (_isClosing)
        {
            return;
        }

        StatusText.Text = status;
        LoadingOverlay.Visibility = Visibility.Visible;
        Volatile.Write(ref _readyState, 0);
        Dismiss(restoreForeground: true);
        if (!_failureReported)
        {
            _failureReported = true;
            _failed(status);
        }
    }

    private void OnClosing(object? sender, CancelEventArgs e)
    {
        if (!_allowClose)
        {
            e.Cancel = true;
            Dismiss(restoreForeground: true);
            return;
        }

        _isClosing = true;
        Volatile.Write(ref _readyState, 0);
        _shutdown.Cancel();
        _bridge?.Dispose();
        _bridge = null;
        WebView.Dispose();
        _shutdown.Dispose();
    }

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

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(
        IntPtr window,
        IntPtr insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags);
}
