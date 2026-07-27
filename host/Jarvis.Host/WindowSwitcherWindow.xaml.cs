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

    private HwndSource? _windowSource;
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

        try
        {
            var payload = JsonSerializer.Serialize(state);
            await WebView.CoreWebView2.ExecuteScriptAsync(
                $"window.dispatchEvent(new CustomEvent('jarvis:window-switcher-state', " +
                $"{{ detail: {payload} }}));");
            if (_isClosing)
            {
                return;
            }

            PositionAndReveal();
        }
        catch (InvalidOperationException) when (_isClosing)
        {
            // The switcher may be dismissed while a renderer update is in flight.
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
        await WebView.EnsureCoreWebView2Async(environment);
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
        if (!NativeDisplay.TryGetPrimaryMonitorBounds(out var monitorBounds))
        {
            ReportFailure("PRIMARY DISPLAY UNAVAILABLE");
            return;
        }

        var width = Math.Clamp(monitorBounds.Width - 160, 720, 1120);
        var height = Math.Clamp(monitorBounds.Height / 3, 300, 390);
        var left = monitorBounds.Left + (monitorBounds.Width - width) / 2;
        var top = monitorBounds.Top + (monitorBounds.Height - height) / 2;
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
        if (!SetWindowPos(handle, HwndTopmost, left, top, width, height, SwpNoActivate))
        {
            ReportFailure("POSITIONING FAILED");
            return;
        }

        Opacity = 1;
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
