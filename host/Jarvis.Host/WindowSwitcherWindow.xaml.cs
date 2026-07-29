using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using Jarvis.Host.Infrastructure;
using Jarvis.Host.Services;
using Microsoft.Web.WebView2.Core;

namespace Jarvis.Host;

public partial class WindowSwitcherWindow : Window
{
    private const int GwlExStyle = -20;
    private const long WsExToolWindow = 0x00000080L;
    private const long WsExNoActivate = 0x08000000L;
    private const int WmMouseActivate = 0x0021;
    private const int MaNoActivate = 3;
    private const uint SwpNoActivate = 0x0010;
    private static readonly IntPtr HwndTopmost = new(-1);

    private readonly Action _ready;
    private readonly Action<string> _failed;
    private readonly CancellationTokenSource _shutdown = new();
    private readonly WindowSwitcherPresentationEpoch _presentationEpoch = new();

    private HwndSource? _windowSource;
    private WindowSwitcherPlacementDiagnostic? _placementDiagnostic;
    private bool _allowClose;
    private bool _isClosing;
    private bool _readyReported;
    private int _readyState;

    internal WindowSwitcherWindow(Action ready, Action<string> failed)
    {
        _ready = ready;
        _failed = failed;
        InitializeComponent();
    }

    internal bool IsReady => Volatile.Read(ref _readyState) == 1;

    internal async Task PresentAsync(WindowSwitcherPresentationState state)
    {
        if (!IsReady || _isClosing || WebView.CoreWebView2 is null)
        {
            return;
        }

        var presentationEpoch = _presentationEpoch.Begin();
        try
        {
            var payload = JsonSerializer.Serialize(state);
            await WebView.CoreWebView2.ExecuteScriptAsync(
                $"window.dispatchEvent(new CustomEvent('jarvis:window-switcher-state', " +
                $"{{ detail: {payload} }}));");
            if (_isClosing ||
                !_presentationEpoch.IsCurrent(presentationEpoch))
            {
                return;
            }

            PositionAndReveal();
        }
        catch (Exception) when (
            _isClosing ||
            !_presentationEpoch.IsCurrent(presentationEpoch))
        {
            // A dismissed or superseded renderer update no longer owns the HUD.
        }
        catch (Exception ex)
        {
            HostLog.Error("The window-switcher renderer could not accept a state update.", ex);
            ReportFailure("STATE UPDATE FAILED");
        }
    }

    internal void Dismiss()
    {
        if (_isClosing)
        {
            return;
        }

        _presentationEpoch.Invalidate();
        _placementDiagnostic = null;
        Opacity = 0;
        Hide();
    }

    internal void CloseFromHost()
    {
        _allowClose = true;
        Close();
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
        _ = SetWindowLongPtr(
            handle,
            GwlExStyle,
            new IntPtr(extendedStyle | WsExToolWindow | WsExNoActivate));
        _windowSource = HwndSource.FromHwnd(handle);
        _windowSource?.AddHook(WindowProcedure);
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            await InitializeWebViewAsync();
        }
        catch (OperationCanceledException) when (_shutdown.IsCancellationRequested)
        {
            // A taskbar-mode change can intentionally release the prewarmed runtime.
        }
        catch (Exception) when (_isClosing || _shutdown.IsCancellationRequested)
        {
            // Observe an initialization failure that raced intentional runtime release.
        }
        catch (Exception ex)
        {
            HostLog.Error("Window-switcher WebView2 initialization failed.", ex);
            ReportFailure($"STARTUP FAILED · {ex.Message}");
        }
    }

    private async Task InitializeWebViewAsync()
    {
        var frontendDirectory = FrontendLocator.FindDistributionDirectory();
        var environment = await WebViewEnvironmentProvider.GetAsync();
        _shutdown.Token.ThrowIfCancellationRequested();
        await WebView.EnsureCoreWebView2Async(environment);
        _shutdown.Token.ThrowIfCancellationRequested();
        WebViewHostConfiguration.Apply(
            WebView.CoreWebView2,
            frontendDirectory,
            "window-switcher",
            args =>
            {
                HostLog.Error($"Window-switcher WebView2 process failed: {args.ProcessFailedKind}.");
                Dispatcher.BeginInvoke(() => ReportFailure("RENDERER PROCESS FAILED"));
            });

        WebView.CoreWebView2.NavigationCompleted += OnNavigationCompleted;
        WebView.Source = WebViewHostConfiguration.CreateAppUri("surface=switcher");
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
                Boolean(document.querySelector('.jarvis-window-switcher'));
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

            LoadingOverlay.Visibility = Visibility.Collapsed;
            Volatile.Write(ref _readyState, 1);
            Dismiss();
            if (!_readyReported)
            {
                _readyReported = true;
                HostLog.Info("JARVIS window-switcher surface is ready.");
                _ready();
            }
        }
        catch (OperationCanceledException) when (_shutdown.IsCancellationRequested)
        {
            // Expected during shutdown.
        }
        catch (Exception ex)
        {
            HostLog.Error("Window-switcher readiness probe failed.", ex);
            ReportFailure("READINESS CHECK FAILED");
        }
    }

    private void PositionAndReveal()
    {
        var foreground = GetForegroundWindow();
        var usedPrimaryFallback = !NativeDisplay.TryGetMonitorForWindow(
            foreground,
            out var targetMonitor);
        if (usedPrimaryFallback &&
            !NativeDisplay.TryGetPrimaryMonitor(out targetMonitor))
        {
            ReportFailure("DISPLAY WORK AREA UNAVAILABLE");
            return;
        }

        if (!WindowSwitcherPlacement.TryCalculate(
                targetMonitor.WorkArea,
                targetMonitor.ScalePercent,
                out var windowBounds))
        {
            ReportFailure("DISPLAY WORK AREA UNSUPPORTED");
            return;
        }

        var diagnostic = new WindowSwitcherPlacementDiagnostic(
            targetMonitor.DeviceName,
            usedPrimaryFallback,
            targetMonitor.ScalePercent,
            targetMonitor.WorkArea,
            windowBounds);
        if (_placementDiagnostic != diagnostic)
        {
            _placementDiagnostic = diagnostic;
            HostLog.Info(
                $"Window switcher placement: " +
                $"source={(usedPrimaryFallback ? "primary-fallback" : "foreground")} " +
                $"monitor={targetMonitor.DeviceName} " +
                $"primary={targetMonitor.IsPrimary} " +
                $"scale={targetMonitor.ScalePercent}% " +
                $"workArea={FormatRect(targetMonitor.WorkArea)} " +
                $"window={FormatRect(windowBounds)}.");
        }

        var handle = new WindowInteropHelper(this).Handle;
        if (handle == IntPtr.Zero)
        {
            ReportFailure("POSITIONING FAILED");
            return;
        }

        // A hidden WPF window reapplies its XAML Width/Height on Show(). Reveal it
        // while still transparent, then make the native pixel rectangle final so
        // high-DPI monitors cannot shift the HUD away from the computed center.
        Show();
        if (!SetWindowPos(
                handle,
                HwndTopmost,
                windowBounds.Left,
                windowBounds.Top,
                windowBounds.Width,
                windowBounds.Height,
                SwpNoActivate))
        {
            ReportFailure("POSITIONING FAILED");
            return;
        }

        Opacity = 1;
    }

    private static string FormatRect(PixelRect rectangle) =>
        $"{rectangle.Left},{rectangle.Top}," +
        $"{rectangle.Width}x{rectangle.Height}";

    private void ReportFailure(string status)
    {
        if (_isClosing)
        {
            return;
        }

        StatusText.Text = status;
        LoadingOverlay.Visibility = Visibility.Visible;
        Volatile.Write(ref _readyState, 0);
        Dismiss();
        _failed(status);
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

    private void OnClosing(object? sender, CancelEventArgs e)
    {
        if (!_allowClose)
        {
            e.Cancel = true;
            Dismiss();
            return;
        }

        _isClosing = true;
        _presentationEpoch.Invalidate();
        Volatile.Write(ref _readyState, 0);
        _shutdown.Cancel();
        _windowSource?.RemoveHook(WindowProcedure);
        _windowSource = null;
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
