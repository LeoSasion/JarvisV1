using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using System.Windows.Automation;
using Jarvis.Host.Bridge;
using Jarvis.Host.Infrastructure;
using Jarvis.Host.Services;

namespace Jarvis.Host;

public partial class TaskbarFlyoutWindow : Window
{
    private const int GwlExStyle = -20;
    private const long WsExNoActivate = 0x08000000L;
    private const int WmMouseActivate = 0x0021;
    private const int MaNoActivate = 3;
    private const uint DwmTnpRectDestination = 0x00000001;
    private const uint DwmTnpOpacity = 0x00000004;
    private const uint DwmTnpVisible = 0x00000008;
    private const uint DwmTnpSourceClientAreaOnly = 0x00000010;

    private static readonly SolidColorBrush PanelBrush = NativeVisualPalette.SurfaceBrush;
    private static readonly SolidColorBrush PanelHoverBrush = NativeVisualPalette.SurfaceHoverBrush;
    private static readonly SolidColorBrush CardBorderBrush = NativeVisualPalette.StructureBrush;
    private static readonly SolidColorBrush CardBorderHoverBrush = NativeVisualPalette.AccentBrush;
    private static readonly SolidColorBrush TextBrush = NativeVisualPalette.InkBrush;
    private static readonly SolidColorBrush MutedTextBrush = NativeVisualPalette.MutedBrush;

    private readonly IReadOnlyList<TaskbarWindowSnapshot> _windows;
    private readonly WindowTaskbarService _taskbarService;
    private readonly PixelRect _taskbarBounds;
    private readonly int _anchorScreenX;
    private readonly string _mode;
    private readonly TaskbarFlyoutRequest _request;
    private readonly bool _autoDismiss;
    private readonly bool _keyboardInteractive;
    private readonly Action<string, string, string?> _contextAction;
    private readonly Action _closed;
    private readonly DispatcherTimer _cursorTimer;
    private readonly Dictionary<IntPtr, FrameworkElement> _thumbnails = new();

    private HwndSource? _windowSource;
    private PixelRect _bounds;
    private int _anchorHalfWidth = 36;
    private int _outsideTicks;
    private bool _isClosing;

    internal TaskbarFlyoutWindow(
        IReadOnlyList<TaskbarWindowSnapshot> windows,
        WindowTaskbarService taskbarService,
        PixelRect taskbarBounds,
        int anchorScreenX,
        TaskbarFlyoutRequest request,
        bool autoDismiss,
        Action<string, string, string?> contextAction,
        Action closed)
    {
        _windows = windows;
        _taskbarService = taskbarService;
        _taskbarBounds = taskbarBounds;
        _anchorScreenX = anchorScreenX;
        _request = request;
        _mode = request.Mode;
        _autoDismiss = autoDismiss;
        _keyboardInteractive = IsKeyboardInteractiveMode(_mode);
        _contextAction = contextAction;
        _closed = closed;
        _cursorTimer = new DispatcherTimer(TimeSpan.FromMilliseconds(180), DispatcherPriority.Background, OnCursorTick, Dispatcher);

        InitializeComponent();
        if (_keyboardInteractive)
        {
            ShowActivated = true;
            Deactivated += (_, _) => CloseSafely();
        }
        else if (!_autoDismiss)
        {
            // Diagnostic sessions expose the otherwise tool-style flyout so native QA can capture it.
            ShowInTaskbar = true;
            ShowActivated = true;
            Owner = Application.Current.MainWindow;
        }
        BuildContent();
    }

    internal static bool IsKeyboardInteractiveMode(string mode) =>
        mode is "overflow" or "context";

    private void BuildContent(int? limit = null)
    {
        if (_mode == "context")
        {
            BuildContextMenu();
            return;
        }

        var maximum = _mode == "overflow" ? 10 : 6;
        var requestedLimit = Math.Clamp(limit ?? maximum, 1, maximum);
        var orderedOverflow = _mode == "overflow" && _request.OverflowItems.Count > 0;
        var visibleWindows = orderedOverflow
            ? Array.Empty<TaskbarWindowSnapshot>()
            : _windows.Take(requestedLimit).ToArray();
        var visibleOverflowItems = orderedOverflow
            ? _request.OverflowItems.Take(requestedLimit).ToArray()
            : Array.Empty<TaskbarOverflowItem>();
        var totalItemCount = orderedOverflow ? _request.OverflowItems.Count : _windows.Count;
        var visibleItemCount = orderedOverflow ? visibleOverflowItems.Length : visibleWindows.Length;
        TitleText.Text = _mode == "overflow" ? "TASK OVERFLOW" : "WINDOW GROUP";
        var meta = _mode == "overflow"
            ? $"{totalItemCount} APPLICATIONS"
            : $"{_windows.Count} OPEN WINDOWS";
        MetaText.Text = visibleItemCount < totalItemCount
            ? $"{meta} · SHOWING {visibleItemCount}"
            : meta;

        foreach (var window in visibleWindows)
        {
            CardsPanel.Children.Add(_mode == "overflow"
                ? CreateOverflowCard(window)
                : CreatePreviewCard(window));
        }
        foreach (var item in visibleOverflowItems)
        {
            var nativeWindow = item.WindowId is null
                ? null
                : _windows.FirstOrDefault(window => string.Equals(
                    window.WindowId,
                    item.WindowId,
                    StringComparison.OrdinalIgnoreCase));
            CardsPanel.Children.Add(nativeWindow is null
                ? CreateRendererOverflowCard(item)
                : CreateOverflowCard(nativeWindow, item));
        }
    }

    private void BuildContextMenu()
    {
        TitleText.Text = "APP COMMANDS";
        MetaText.Text = _request.Label?.ToUpperInvariant() ?? "TASKBAR ITEM";
        CardsPanel.Orientation = Orientation.Vertical;
        foreach (var action in _request.Actions)
        {
            CardsPanel.Children.Add(CreateContextActionButton(action));
        }
    }

    private Button CreateContextActionButton(string action)
    {
        var label = action switch
        {
            "launch" => _windows.Count > 0 ? "OPEN NEW INSTANCE" : "OPEN",
            "close" => _windows.Count > 1
                ? $"CLOSE ALL {_windows.Count} WINDOWS"
                : "CLOSE WINDOW",
            "unpin" => "UNPIN FROM JARVIS",
            _ => action.ToUpperInvariant()
        };
        var button = new Button
        {
            Width = 260,
            Height = 38,
            Margin = new Thickness(5, 3, 5, 3),
            Padding = new Thickness(14, 0, 12, 0),
            Content = label,
            HorizontalContentAlignment = HorizontalAlignment.Left,
            Foreground = action == "close" ? NativeVisualPalette.DangerBrush : TextBrush,
            Background = PanelBrush,
            BorderBrush = CardBorderBrush,
            BorderThickness = new Thickness(1),
            FontFamily = new FontFamily("Bahnschrift"),
            FontSize = 10,
            FontWeight = FontWeights.SemiBold,
            Cursor = Cursors.Hand
        };
        button.MouseEnter += (_, _) =>
        {
            button.BorderBrush = CardBorderHoverBrush;
            button.Background = PanelHoverBrush;
        };
        button.MouseLeave += (_, _) =>
        {
            button.BorderBrush = CardBorderBrush;
            button.Background = PanelBrush;
        };
        button.Click += (_, _) =>
        {
            var itemId = _request.ItemId;
            if (string.IsNullOrWhiteSpace(itemId))
            {
                CloseSafely();
                return;
            }

            CloseSafely();
            _contextAction(itemId, action, null);
        };
        return button;
    }

    private FrameworkElement CreatePreviewCard(TaskbarWindowSnapshot window)
    {
        var card = CreateCardShell(232, 158, window);
        var grid = new Grid();
        grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(112) });
        grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(46) });

        var preview = new Border
        {
            Margin = new Thickness(5, 5, 5, 0),
            Background = NativeVisualPalette.BackgroundBrush,
            ClipToBounds = true,
            Cursor = Cursors.Hand,
            ToolTip = $"Switch to {window.Title}"
        };
        preview.Loaded += (_, _) => RegisterThumbnail(window, preview);
        preview.SizeChanged += (_, _) => UpdateThumbnailFor(preview);
        preview.MouseLeftButtonUp += (_, _) => ToggleAndClose(window.WindowId);
        Grid.SetRow(preview, 0);
        grid.Children.Add(preview);

        var footer = CreateFooter(window, compact: false);
        footer.MouseLeftButtonUp += (_, _) => ToggleAndClose(window.WindowId);
        Grid.SetRow(footer, 1);
        grid.Children.Add(footer);

        var close = CreateCloseButton(window);
        close.HorizontalAlignment = HorizontalAlignment.Right;
        close.VerticalAlignment = VerticalAlignment.Top;
        close.Margin = new Thickness(0, 9, 9, 0);
        Grid.SetRow(close, 0);
        Panel.SetZIndex(close, 10);
        grid.Children.Add(close);

        card.Child = grid;
        return card;
    }

    private FrameworkElement CreateOverflowCard(
        TaskbarWindowSnapshot window,
        TaskbarOverflowItem? item = null)
    {
        var card = CreateCardShell(260, 66, window);
        card.Focusable = true;
        AutomationProperties.SetName(card, $"Switch to {window.Title}");
        card.KeyDown += (_, e) =>
        {
            if (!ReferenceEquals(e.OriginalSource, card) ||
                e.Key is not (Key.Enter or Key.Space))
            {
                return;
            }

            e.Handled = true;
            ToggleAndClose(window.WindowId);
        };
        var grid = new Grid
        {
            Margin = new Thickness(10, 7, 8, 7),
            Cursor = Cursors.Hand,
            ToolTip = $"Switch to {window.Title}"
        };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(38) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(30) });
        grid.MouseLeftButtonUp += (_, _) => ToggleAndClose(window.WindowId);

        var icon = CreateIcon(window.IconDataUrl, 26);
        icon.HorizontalAlignment = HorizontalAlignment.Left;
        icon.VerticalAlignment = VerticalAlignment.Center;
        grid.Children.Add(icon);

        var copy = CreateFooter(window, compact: true, item?.Label, item?.Meta);
        Grid.SetColumn(copy, 1);
        grid.Children.Add(copy);

        var close = CreateCloseButton(window);
        Grid.SetColumn(close, 2);
        grid.Children.Add(close);

        card.Child = grid;
        return card;
    }

    private FrameworkElement CreateRendererOverflowCard(TaskbarOverflowItem item)
    {
        var button = new Button
        {
            Width = 260,
            Height = 66,
            Margin = new Thickness(5),
            Padding = new Thickness(12, 7, 10, 7),
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Foreground = TextBrush,
            Background = PanelBrush,
            BorderBrush = CardBorderBrush,
            BorderThickness = new Thickness(1),
            Cursor = Cursors.Hand,
            ToolTip = $"Open {item.Label}"
        };
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(38) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var mark = new TextBlock
        {
            Text = "◇",
            Foreground = NativeVisualPalette.AccentBrush,
            FontFamily = new FontFamily("Segoe UI Symbol"),
            FontSize = 22,
            VerticalAlignment = VerticalAlignment.Center
        };
        grid.Children.Add(mark);

        var copy = new StackPanel
        {
            VerticalAlignment = VerticalAlignment.Center
        };
        copy.Children.Add(new TextBlock
        {
            Text = item.Label,
            Foreground = TextBrush,
            FontFamily = new FontFamily("Segoe UI"),
            FontSize = 11,
            TextTrimming = TextTrimming.CharacterEllipsis
        });
        copy.Children.Add(new TextBlock
        {
            Text = item.Meta,
            Margin = new Thickness(0, 3, 0, 0),
            Foreground = MutedTextBrush,
            FontFamily = new FontFamily("Consolas"),
            FontSize = 8.5,
            TextTrimming = TextTrimming.CharacterEllipsis
        });
        Grid.SetColumn(copy, 1);
        grid.Children.Add(copy);
        button.Content = grid;
        button.MouseEnter += (_, _) =>
        {
            button.BorderBrush = CardBorderHoverBrush;
            button.Background = PanelHoverBrush;
        };
        button.MouseLeave += (_, _) =>
        {
            button.BorderBrush = CardBorderBrush;
            button.Background = PanelBrush;
        };
        button.Click += (_, _) =>
        {
            CloseSafely();
            _contextAction(item.ItemId, "activate", item.WindowId);
        };
        return button;
    }

    private Border CreateCardShell(double width, double height, TaskbarWindowSnapshot window)
    {
        var card = new Border
        {
            Width = width,
            Height = height,
            Margin = new Thickness(5),
            BorderBrush = window.Active ? CardBorderHoverBrush : CardBorderBrush,
            BorderThickness = new Thickness(1),
            Background = PanelBrush,
            CornerRadius = new CornerRadius(0),
            SnapsToDevicePixels = true
        };
        card.MouseEnter += (_, _) =>
        {
            card.BorderBrush = CardBorderHoverBrush;
            card.Background = PanelHoverBrush;
        };
        card.MouseLeave += (_, _) =>
        {
            card.BorderBrush = window.Active || card.IsKeyboardFocusWithin
                ? CardBorderHoverBrush
                : CardBorderBrush;
            card.Background = card.IsKeyboardFocusWithin ? PanelHoverBrush : PanelBrush;
        };
        card.GotKeyboardFocus += (_, e) =>
        {
            if (!ReferenceEquals(e.NewFocus, card))
            {
                return;
            }

            card.BorderBrush = CardBorderHoverBrush;
            card.Background = PanelHoverBrush;
        };
        card.LostKeyboardFocus += (_, e) =>
        {
            if (card.IsKeyboardFocusWithin || ReferenceEquals(e.NewFocus, card))
            {
                return;
            }

            card.BorderBrush = window.Active ? CardBorderHoverBrush : CardBorderBrush;
            card.Background = PanelBrush;
        };
        return card;
    }

    private Grid CreateFooter(
        TaskbarWindowSnapshot window,
        bool compact,
        string? titleOverride = null,
        string? metaOverride = null)
    {
        var footer = new Grid
        {
            Margin = compact ? new Thickness(0) : new Thickness(9, 5, 36, 5),
            Cursor = Cursors.Hand
        };
        footer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        footer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var title = new TextBlock
        {
            Text = titleOverride ?? window.Title,
            Foreground = TextBrush,
            FontFamily = new FontFamily("Segoe UI"),
            FontSize = compact ? 11 : 10.5,
            TextTrimming = TextTrimming.CharacterEllipsis
        };
        footer.Children.Add(title);

        var meta = new TextBlock
        {
            Text = metaOverride ?? $"{window.ProcessName.ToUpperInvariant()} · {(window.Minimized ? "MINIMIZED" : window.Active ? "ACTIVE" : "READY")}",
            Margin = new Thickness(0, 3, 0, 0),
            Foreground = MutedTextBrush,
            FontFamily = new FontFamily("Consolas"),
            FontSize = 8.5,
            TextTrimming = TextTrimming.CharacterEllipsis
        };
        Grid.SetRow(meta, 1);
        footer.Children.Add(meta);
        return footer;
    }

    private Button CreateCloseButton(TaskbarWindowSnapshot window)
    {
        var close = new Button
        {
            Width = 26,
            Height = 26,
            Padding = new Thickness(0),
            Content = "×",
            Foreground = NativeVisualPalette.MutedBrush,
            Background = NativeVisualPalette.BackgroundBrush,
            BorderBrush = NativeVisualPalette.StructureBrush,
            BorderThickness = new Thickness(1),
            FontFamily = new FontFamily("Segoe UI"),
            FontSize = 14,
            ToolTip = $"Close {window.Title}"
        };
        close.Click += (_, e) =>
        {
            e.Handled = true;
            CloseWindowAndFlyout(window.WindowId);
        };
        return close;
    }

    private static Image CreateIcon(string? dataUrl, double size)
    {
        var image = new Image
        {
            Width = size,
            Height = size,
            Stretch = Stretch.Uniform
        };
        if (string.IsNullOrWhiteSpace(dataUrl))
        {
            return image;
        }

        try
        {
            var separator = dataUrl.IndexOf(',', StringComparison.Ordinal);
            var bytes = Convert.FromBase64String(separator >= 0 ? dataUrl[(separator + 1)..] : dataUrl);
            using var stream = new MemoryStream(bytes);
            var bitmap = new BitmapImage();
            bitmap.BeginInit();
            bitmap.CacheOption = BitmapCacheOption.OnLoad;
            bitmap.StreamSource = stream;
            bitmap.EndInit();
            bitmap.Freeze();
            image.Source = bitmap;
        }
        catch (Exception ex) when (ex is FormatException or NotSupportedException)
        {
            // The title still identifies the application when an icon cannot be decoded.
        }

        return image;
    }

    private void ToggleAndClose(string windowId)
    {
        CloseSafely();
        try
        {
            _taskbarService.Toggle(windowId);
        }
        catch (Bridge.BridgeFaultException ex)
        {
            HostLog.Warning($"Taskbar preview could not switch window: {ex.Message}");
        }
        catch (Exception ex)
        {
            HostLog.Error("Taskbar preview window switch failed unexpectedly.", ex);
        }
    }

    private void CloseWindowAndFlyout(string windowId)
    {
        CloseSafely();
        try
        {
            _taskbarService.Close(windowId);
        }
        catch (Bridge.BridgeFaultException ex)
        {
            HostLog.Warning($"Taskbar preview could not close window: {ex.Message}");
        }
    }

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        var handle = new WindowInteropHelper(this).Handle;
        if (handle == IntPtr.Zero)
        {
            return;
        }

        if (!_keyboardInteractive && _autoDismiss)
        {
            var extendedStyle = GetWindowLongPtr(handle, GwlExStyle).ToInt64();
            _ = SetWindowLongPtr(handle, GwlExStyle, new IntPtr(extendedStyle | WsExNoActivate));
        }
        _windowSource = HwndSource.FromHwnd(handle);
        _windowSource?.AddHook(WindowProcedure);

        var dpi = GetDpiForWindow(handle);
        var scale = (dpi == 0 ? 96u : dpi) / 96d;
        _anchorHalfWidth = Math.Max(
            36,
            checked((int)Math.Round(36 * scale)));
        if (_mode == "context")
        {
            PositionContextMenu(scale);
            return;
        }

        var itemCount = _mode == "overflow" && _request.OverflowItems.Count > 0
            ? _request.OverflowItems.Count
            : _windows.Count;
        var maximumCount = Math.Max(1, Math.Min(itemCount, _mode == "overflow" ? 10 : 6));
        var cardWidth = _mode == "overflow" ? 270 : 242;
        var cardHeight = _mode == "overflow" ? 76 : 168;
        var preferredColumns = _mode == "overflow" ? Math.Min(maximumCount, 2) : Math.Min(maximumCount, 3);
        var availableWidthDip = Math.Max(cardWidth + 26, (_taskbarBounds.Width / scale) - 16);
        var columns = preferredColumns;
        while (columns > 1 && columns * cardWidth + 26 > availableWidthDip)
        {
            columns--;
        }

        var monitorTop = 0;
        if (NativeDisplay.TryGetPrimaryMonitorBounds(out var monitorBounds))
        {
            monitorTop = monitorBounds.Top;
        }

        var availableHeightDip = Math.Max(
            cardHeight + 54,
            ((_taskbarBounds.Top - monitorTop) / scale) - 16);
        var maximumRows = Math.Max(1, (int)Math.Floor((availableHeightDip - 54) / cardHeight));
        var count = Math.Min(maximumCount, columns * maximumRows);
        if (count < maximumCount)
        {
            CardsPanel.Children.Clear();
            BuildContent(count);
        }

        var rows = (int)Math.Ceiling(count / (double)columns);
        var widthDip = columns * cardWidth + 26;
        var heightDip = rows * cardHeight + 54;
        Width = widthDip;
        Height = heightDip;

        var width = checked((int)Math.Round(widthDip * scale));
        var height = checked((int)Math.Round(heightDip * scale));
        var gap = checked((int)Math.Round(8 * scale));
        var minimumLeft = _taskbarBounds.Left;
        var maximumLeft = Math.Max(minimumLeft, _taskbarBounds.Right - width);
        var left = Math.Clamp(_anchorScreenX - width / 2, minimumLeft, maximumLeft);
        var top = _taskbarBounds.Top - gap - height;
        top = Math.Max(monitorTop + gap, top);

        _bounds = new PixelRect(left, top, left + width, top + height);
        _ = NativeDisplay.PositionWindow(this, _bounds);
    }

    private void PositionContextMenu(double scale)
    {
        var actionCount = Math.Max(1, _request.Actions.Count);
        var widthDip = 286d;
        var heightDip = 50d + actionCount * 44d;
        Width = widthDip;
        Height = heightDip;

        var width = checked((int)Math.Round(widthDip * scale));
        var height = checked((int)Math.Round(heightDip * scale));
        var gap = checked((int)Math.Round(8 * scale));
        var minimumLeft = _taskbarBounds.Left;
        var maximumLeft = Math.Max(minimumLeft, _taskbarBounds.Right - width);
        var left = Math.Clamp(_anchorScreenX - width / 2, minimumLeft, maximumLeft);
        var monitorTop = NativeDisplay.TryGetPrimaryMonitorBounds(out var monitorBounds)
            ? monitorBounds.Top
            : 0;
        var top = Math.Max(monitorTop + gap, _taskbarBounds.Top - gap - height);

        _bounds = new PixelRect(left, top, left + width, top + height);
        _ = NativeDisplay.PositionWindow(this, _bounds);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_bounds.Width > 0 && _bounds.Height > 0)
        {
            _ = NativeDisplay.PositionWindow(this, _bounds);
        }

        if (_autoDismiss)
        {
            _cursorTimer.Start();
        }

        if (_keyboardInteractive)
        {
            _ = Activate();
            _ = CardsPanel.Children
                .OfType<UIElement>()
                .FirstOrDefault(element => element.Focusable)
                ?.Focus();
        }
    }

    private void OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (!_keyboardInteractive)
        {
            return;
        }

        if (e.Key == Key.Escape)
        {
            e.Handled = true;
            CloseSafely();
            return;
        }

        var offset = e.Key switch
        {
            Key.Left or Key.Up => -1,
            Key.Right or Key.Down => 1,
            _ => 0
        };
        if (offset == 0)
        {
            return;
        }

        var cards = CardsPanel.Children
            .OfType<UIElement>()
            .Where(element => element.Focusable)
            .ToArray();
        if (cards.Length == 0)
        {
            return;
        }

        var currentIndex = Array.FindIndex(cards, card => card.IsKeyboardFocusWithin);
        var nextIndex = currentIndex < 0
            ? 0
            : (currentIndex + offset + cards.Length) % cards.Length;
        e.Handled = cards[nextIndex].Focus();
    }

    private void RegisterThumbnail(TaskbarWindowSnapshot window, FrameworkElement destination)
    {
        if (!WindowTaskbarService.TryParseWindowId(window.WindowId, out var sourceWindow))
        {
            return;
        }

        var destinationWindow = new WindowInteropHelper(this).Handle;
        if (destinationWindow == IntPtr.Zero)
        {
            HostLog.Warning($"DWM taskbar preview has no destination handle for {window.WindowId}.");
            return;
        }

        var registrationResult = DwmRegisterThumbnail(destinationWindow, sourceWindow, out var thumbnail);
        if (registrationResult != 0 || thumbnail == IntPtr.Zero)
        {
            HostLog.Warning(
                $"DWM taskbar preview registration failed for {window.WindowId} with HRESULT 0x{registrationResult:X8}.");
            return;
        }

        _thumbnails[thumbnail] = destination;
        UpdateThumbnail(thumbnail, destination);
        HostLog.Info($"DWM taskbar preview registered for {window.WindowId} ({window.ProcessName}).");
    }

    private void UpdateThumbnailFor(FrameworkElement destination)
    {
        foreach (var pair in _thumbnails.Where(pair => ReferenceEquals(pair.Value, destination)))
        {
            UpdateThumbnail(pair.Key, pair.Value);
        }
    }

    private void UpdateThumbnail(IntPtr thumbnail, FrameworkElement destination)
    {
        if (!destination.IsLoaded || destination.ActualWidth <= 1 || destination.ActualHeight <= 1)
        {
            return;
        }

        var dpi = VisualTreeHelper.GetDpi(this);
        var origin = destination.TranslatePoint(new Point(0, 0), this);
        var availableWidth = Math.Max(1, checked((int)Math.Round(destination.ActualWidth * dpi.DpiScaleX)));
        var availableHeight = Math.Max(1, checked((int)Math.Round(destination.ActualHeight * dpi.DpiScaleY)));
        var left = checked((int)Math.Round(origin.X * dpi.DpiScaleX));
        var top = checked((int)Math.Round(origin.Y * dpi.DpiScaleY));

        var width = availableWidth;
        var height = availableHeight;
        if (DwmQueryThumbnailSourceSize(thumbnail, out var sourceSize) == 0 && sourceSize.Width > 0 && sourceSize.Height > 0)
        {
            var scale = Math.Min(availableWidth / (double)sourceSize.Width, availableHeight / (double)sourceSize.Height);
            width = Math.Max(1, checked((int)Math.Round(sourceSize.Width * scale)));
            height = Math.Max(1, checked((int)Math.Round(sourceSize.Height * scale)));
            left += (availableWidth - width) / 2;
            top += (availableHeight - height) / 2;
        }

        var properties = new DwmThumbnailProperties
        {
            Flags = DwmTnpRectDestination | DwmTnpOpacity | DwmTnpVisible | DwmTnpSourceClientAreaOnly,
            Destination = new NativeRect(left, top, left + width, top + height),
            Opacity = byte.MaxValue,
            Visible = true,
            SourceClientAreaOnly = false
        };
        var updateResult = DwmUpdateThumbnailProperties(thumbnail, ref properties);
        if (updateResult != 0)
        {
            HostLog.Warning(
                $"DWM taskbar preview update failed with HRESULT 0x{updateResult:X8}.");
        }
    }

    private void OnCursorTick(object? sender, EventArgs e)
    {
        if (!GetCursorPos(out var cursor))
        {
            return;
        }

        var shouldKeepOpen = TaskbarFlyoutPointerPolicy.ShouldKeepOpen(
            _bounds,
            _taskbarBounds,
            _anchorScreenX,
            _anchorHalfWidth,
            cursor.X,
            cursor.Y);
        _outsideTicks = shouldKeepOpen ? 0 : _outsideTicks + 1;
        if (_outsideTicks >= 5)
        {
            CloseSafely();
        }
    }

    private IntPtr WindowProcedure(
        IntPtr window,
        int message,
        IntPtr wordParameter,
        IntPtr longParameter,
        ref bool handled)
    {
        if (!_keyboardInteractive && message == WmMouseActivate)
        {
            handled = true;
            return new IntPtr(MaNoActivate);
        }

        return IntPtr.Zero;
    }

    private void OnCloseFlyoutClick(object sender, RoutedEventArgs e)
    {
        CloseSafely();
    }

    private void CloseSafely()
    {
        if (_isClosing)
        {
            return;
        }

        _isClosing = true;
        Close();
    }

    private void OnClosed(object? sender, EventArgs e)
    {
        _cursorTimer.Stop();
        foreach (var thumbnail in _thumbnails.Keys)
        {
            _ = DwmUnregisterThumbnail(thumbnail);
        }

        _thumbnails.Clear();
        _windowSource?.RemoveHook(WindowProcedure);
        _windowSource = null;
        _closed();
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmRegisterThumbnail(IntPtr destination, IntPtr source, out IntPtr thumbnail);

    [DllImport("dwmapi.dll")]
    private static extern int DwmUnregisterThumbnail(IntPtr thumbnail);

    [DllImport("dwmapi.dll")]
    private static extern int DwmUpdateThumbnailProperties(IntPtr thumbnail, ref DwmThumbnailProperties properties);

    [DllImport("dwmapi.dll")]
    private static extern int DwmQueryThumbnailSourceSize(IntPtr thumbnail, out NativeSize size);

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out NativePoint point);

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

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeSize
    {
        public int Width;
        public int Height;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public NativeRect(int left, int top, int right, int bottom)
        {
            Left = left;
            Top = top;
            Right = right;
            Bottom = bottom;
        }

        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DwmThumbnailProperties
    {
        public uint Flags;
        public NativeRect Destination;
        public NativeRect Source;
        public byte Opacity;

        [MarshalAs(UnmanagedType.Bool)]
        public bool Visible;

        [MarshalAs(UnmanagedType.Bool)]
        public bool SourceClientAreaOnly;
    }
}
