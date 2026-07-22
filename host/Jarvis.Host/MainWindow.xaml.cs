using System.ComponentModel;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using Jarvis.Host.Bridge;
using Jarvis.Host.Infrastructure;
using Jarvis.Host.Services;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace Jarvis.Host;

public partial class MainWindow : Window
{
    private readonly TaskbarReplacementSession _taskbarReplacement = new();
    private readonly WindowTaskbarService _taskbarService = new();
    private readonly TerminalSessionService _terminalSessionService = new();
    private readonly RuntimeSnapshotFeed _snapshotFeed;
    private readonly NativeWindowAppearanceService _windowAppearanceService;
    private GlobalSafetyHotkey? _safetyHotkey;
    private WebBridge? _bridge;
    private TaskbarWindow? _taskbarWindow;
    private bool _isClosing;
    private bool _diagnosticPanelShown;
    private bool _desktopReady;

    public MainWindow()
    {
        _snapshotFeed = new RuntimeSnapshotFeed(new SystemSnapshotService(), _taskbarService);
        _windowAppearanceService = new NativeWindowAppearanceService(Dispatcher);
        InitializeComponent();
        _taskbarReplacement.ReplacementLost += OnTaskbarReplacementLost;
        SystemEvents.DisplaySettingsChanged += OnDisplaySettingsChanged;
    }

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        _safetyHotkey = new GlobalSafetyHotkey(this, RequestSafeExit);
        _ = _safetyHotkey.Register();
        _windowAppearanceService.Start();
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
            new RuntimeDiagnosticsService(
                new StartupRegistrationService(),
                _windowAppearanceService,
                _snapshotFeed),
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
            HostLog.Info("Desktop surface is ready; creating the native taskbar surface.");
            CreateTaskbarSurface();
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

    private void CreateTaskbarSurface()
    {
        if (_isClosing || !_desktopReady || _taskbarWindow is not null)
        {
            return;
        }

        if (!_taskbarReplacement.TryGetTargetBounds(out var bounds))
        {
            HostLog.Warning(
                "Native taskbar replacement was skipped because the taskbar is unavailable, vertical, already hidden, or safe mode is enabled.");
            return;
        }

        HostLog.Info(
            $"Native taskbar target bounds detected: {bounds.Left},{bounds.Top} {bounds.Width}x{bounds.Height}.");
        _taskbarWindow = new TaskbarWindow(
            bounds,
            _snapshotFeed,
            _taskbarService,
            _terminalSessionService,
            _windowAppearanceService,
            OnTaskbarSurfaceReady,
            DisableTaskbarReplacement,
            RequestSafeExit,
            ShowDesktop);
        _taskbarWindow.Show();
        HostLog.Info("Taskbar surface window created; awaiting renderer readiness.");
    }

    private async void OnTaskbarSurfaceReady()
    {
        if (_isClosing || _taskbarWindow is null)
        {
            return;
        }

        var taskbarHandle = _taskbarWindow.NativeHandle;
        HostLog.Info($"Taskbar renderer is ready; activating replacement for window 0x{taskbarHandle.ToInt64():X}.");
        if (await _taskbarReplacement.ActivateAsync(taskbarHandle))
        {
            _taskbarWindow?.Reveal();
            HostLog.Info("JARVIS taskbar surface revealed.");
        }
        else
        {
            DisableTaskbarReplacement();
            HostLog.Warning("JARVIS taskbar surface remained concealed because activation was not confirmed.");
        }
    }

    private void OnTaskbarReplacementLost()
    {
        Dispatcher.BeginInvoke(DisableTaskbarReplacement);
    }

    private void OnDisplaySettingsChanged(object? sender, EventArgs e)
    {
        _ = Dispatcher.BeginInvoke(() =>
        {
            if (_isClosing)
            {
                return;
            }

            HostLog.Warning(
                "Windows display settings changed; restoring the native taskbar until JARVIS is restarted.");
            DisableTaskbarReplacement();
            if (!NativeDisplay.TryGetPrimaryMonitorBounds(out var bounds) ||
                !NativeDisplay.PositionWindow(this, bounds))
            {
                HostLog.Warning("The desktop host could not be refitted after the display change.");
            }
        });
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
        SystemEvents.DisplaySettingsChanged -= OnDisplaySettingsChanged;
        _taskbarReplacement.ReplacementLost -= OnTaskbarReplacementLost;
        _bridge?.Dispose();
        _safetyHotkey?.Dispose();
        _safetyHotkey = null;
        // Restore third-party DWM values and remove the recovery snapshot before
        // asking the taskbar watchdog to finish its own recovery pass.
        _windowAppearanceService.Dispose();
        _taskbarReplacement.Dispose();
        _taskbarWindow?.CloseFromHost();
        _taskbarWindow = null;
        _snapshotFeed.Dispose();
        _terminalSessionService.Dispose();
        WebView.Dispose();
    }
}
