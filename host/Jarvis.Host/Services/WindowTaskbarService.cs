using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media.Imaging;
using Jarvis.Host.Bridge;

namespace Jarvis.Host.Services;

internal sealed class WindowTaskbarService : IDisposable
{
    private const int MaxIconCacheEntries = 128;
    private const int GwlStyle = -16;
    private const int GwlExStyle = -20;
    private const int GclpHicon = -14;
    private const int GclpHiconSmall = -34;
    private const long WsExToolWindow = 0x00000080L;
    private const long WsExAppWindow = 0x00040000L;
    private const int SwMinimize = 6;
    private const int SwRestore = 9;
    private const uint DwmwaCloaked = 14;
    private const uint DwmwaExtendedFrameBounds = 9;
    private const uint WmGetIcon = 0x007F;
    private const uint WmClose = 0x0010;
    private const nuint IconSmall = 0;
    private const nuint IconBig = 1;
    private const nuint IconSmall2 = 2;
    private const uint SmtoAbortIfHung = 0x0002;
    private const uint ShgfiIcon = 0x000000100;
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const int ErrorSuccess = 0;
    private const int ErrorInsufficientBuffer = 122;
    private const uint MaxAppUserModelIdLength = 512;

    private readonly object _iconCacheLock = new();
    private readonly object _showDesktopLock = new();
    private readonly VirtualDesktopWindowFilter _virtualDesktopFilter = new();
    private readonly Dictionary<string, string> _iconCache = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<int, ProcessIconCacheEntry> _processIconCache = new();
    private readonly Dictionary<int, ProcessApplicationCacheEntry> _processApplicationCache = new();
    private IReadOnlyList<ShowDesktopRestoreTarget> _showDesktopTargets =
        Array.Empty<ShowDesktopRestoreTarget>();
    private bool _showDesktopRestoreJarvisForeground;

    public WindowTaskbarSnapshot Capture()
    {
        var foreground = GetForegroundWindow();
        var foregroundFullscreen = IsFullscreenOnPrimaryMonitor(foreground);
        var windows = new List<TaskbarWindowSnapshot>();
        var excludedVirtualDesktopWindows = 0;

        _ = EnumWindows((window, _) =>
        {
            if (TryCaptureWindow(
                    window,
                    foreground,
                    out var snapshot,
                    out var virtualDesktopMembership))
            {
                windows.Add(snapshot);
            }
            else if (virtualDesktopMembership == VirtualDesktopMembership.Other)
            {
                excludedVirtualDesktopWindows++;
            }

            return true;
        }, IntPtr.Zero);

        PruneProcessCaches(windows.Select(window => window.Pid));

        return new WindowTaskbarSnapshot(
            windows,
            foreground == IntPtr.Zero ? null : FormatWindowId(foreground),
            ForegroundFullscreen: foregroundFullscreen,
            VirtualDesktopFilteringAvailable: _virtualDesktopFilter.IsAvailable,
            ExcludedVirtualDesktopWindowCount: excludedVirtualDesktopWindows);
    }

    public bool VirtualDesktopFilteringAvailable => _virtualDesktopFilter.IsAvailable;

    public WindowToggleResult Toggle(string windowId)
    {
        if (!TryResolveEligibleWindow(windowId, out var window))
        {
            throw new BridgeFaultException(
                "WINDOW_NOT_FOUND",
                "The requested window is no longer available.");
        }

        var foreground = GetForegroundWindow();
        var minimize = foreground == window && !IsIconic(window);
        if (minimize)
        {
            _ = ShowWindowAsync(window, SwMinimize);
            return new WindowToggleResult(windowId, "minimized");
        }

        return ActivateResolved(windowId, window);
    }

    public WindowToggleResult Activate(string windowId)
    {
        if (!TryResolveEligibleWindow(windowId, out var window))
        {
            throw new BridgeFaultException(
                "WINDOW_NOT_FOUND",
                "The requested window is no longer available.");
        }

        return ActivateResolved(windowId, window);
    }

    public WindowCloseResult Close(string windowId)
    {
        if (!TryResolveEligibleWindow(windowId, out var window))
        {
            throw new BridgeFaultException(
                "WINDOW_NOT_FOUND",
                "The requested window is no longer available.");
        }

        if (!PostMessage(window, WmClose, IntPtr.Zero, IntPtr.Zero))
        {
            throw new BridgeFaultException(
                "WINDOW_CLOSE_BLOCKED",
                "Windows did not accept the close request for this window.");
        }

        return new WindowCloseResult(windowId, "close-requested");
    }

    public ShowDesktopToggleResult ToggleDesktop(bool hasVisibleInternalWindow)
    {
        lock (_showDesktopLock)
        {
            var visibleTargets = CaptureVisibleShowDesktopTargets(
                out var jarvisWasForeground);
            var targetStates = _showDesktopTargets
                .Select(InspectShowDesktopTarget)
                .ToArray();
            var decision = ShowDesktopSessionPolicy.Decide(
                targetStates,
                hasVisibleEligibleWindow:
                    visibleTargets.Count > 0 ||
                    hasVisibleInternalWindow);

            if (decision.Action == ShowDesktopSessionAction.Restore)
            {
                return RestoreShowDesktopTargets(targetStates);
            }

            _showDesktopTargets = Array.Empty<ShowDesktopRestoreTarget>();
            _showDesktopRestoreJarvisForeground = false;
            var minimizedTargets = new List<ShowDesktopRestoreTarget>(visibleTargets.Count);
            foreach (var target in visibleTargets)
            {
                if (ShowWindowAsync(target.Window, SwMinimize))
                {
                    minimizedTargets.Add(target);
                }
            }

            _showDesktopTargets = minimizedTargets.ToArray();
            _showDesktopRestoreJarvisForeground = jarvisWasForeground;
            return new ShowDesktopToggleResult(
                Action: "shown",
                AffectedWindowCount: minimizedTargets.Count,
                RestoreAvailable: minimizedTargets.Count > 0,
                RestoreJarvisForeground: false);
        }
    }

    private ShowDesktopToggleResult RestoreShowDesktopTargets(
        IReadOnlyList<ShowDesktopTargetState> targetStates)
    {
        var restorableTargets = _showDesktopTargets
            .Zip(targetStates)
            .Where(pair => pair.Second == ShowDesktopTargetState.Minimized)
            .Select(pair => pair.First)
            .ToArray();
        var restoredWindows = new HashSet<IntPtr>();
        var pendingTargets = new List<ShowDesktopRestoreTarget>();
        var restoreJarvisForeground = _showDesktopRestoreJarvisForeground;

        foreach (var target in restorableTargets.Reverse())
        {
            if (ShowWindowAsync(target.Window, SwRestore))
            {
                restoredWindows.Add(target.Window);
            }
            else
            {
                pendingTargets.Add(target);
            }
        }

        _showDesktopTargets = pendingTargets.ToArray();
        _showDesktopRestoreJarvisForeground =
            pendingTargets.Count > 0 &&
            restoreJarvisForeground;
        if (!restoreJarvisForeground)
        {
            var foregroundTarget = restorableTargets.FirstOrDefault(
                target => target.WasForeground && restoredWindows.Contains(target.Window)) ??
                restorableTargets.FirstOrDefault(
                    target => restoredWindows.Contains(target.Window));
            if (foregroundTarget is not null)
            {
                _ = SetForegroundWindow(foregroundTarget.Window);
            }
        }

        return new ShowDesktopToggleResult(
            Action: restoredWindows.Count > 0 ? "restored" : "restore-failed",
            AffectedWindowCount: restoredWindows.Count,
            RestoreAvailable: pendingTargets.Count > 0,
            RestoreJarvisForeground:
                restoreJarvisForeground &&
                restoredWindows.Count > 0);
    }

    private List<ShowDesktopRestoreTarget> CaptureVisibleShowDesktopTargets(
        out bool jarvisWasForeground)
    {
        var foreground = GetForegroundWindow();
        _ = GetWindowThreadProcessId(foreground, out var foregroundProcessId);
        jarvisWasForeground = foregroundProcessId == Environment.ProcessId;
        var targets = new List<ShowDesktopRestoreTarget>();
        _ = EnumWindows((window, _) =>
        {
            if (IsIconic(window) ||
                !TryGetEligibleProcessId(window, out var processId) ||
                !ShowDesktopSessionPolicy.IsWithinControlScope(
                    _virtualDesktopFilter.Query(window)) ||
                !TryGetProcessStartTimeUtcTicks(processId, out var processStartTimeUtcTicks))
            {
                return true;
            }

            targets.Add(new ShowDesktopRestoreTarget(
                window,
                processId,
                processStartTimeUtcTicks,
                WasForeground: window == foreground));
            return true;
        }, IntPtr.Zero);
        return targets;
    }

    private ShowDesktopTargetState InspectShowDesktopTarget(
        ShowDesktopRestoreTarget target)
    {
        var windowExists = IsWindow(target.Window);
        var processId = 0U;
        var processStartTimeUtcTicks = 0L;
        var withinCurrentDesktopScope = false;
        var minimized = false;
        if (windowExists)
        {
            _ = GetWindowThreadProcessId(target.Window, out processId);
            _ = TryGetProcessStartTimeUtcTicks(
                processId,
                out processStartTimeUtcTicks);
            withinCurrentDesktopScope = ShowDesktopSessionPolicy.IsWithinControlScope(
                _virtualDesktopFilter.Query(target.Window));
            minimized = IsIconic(target.Window);
        }

        return ShowDesktopSessionPolicy.ClassifyTarget(
            target,
            windowExists,
            processId,
            processStartTimeUtcTicks,
            minimized,
            withinCurrentDesktopScope);
    }

    private static bool TryGetProcessStartTimeUtcTicks(
        uint processId,
        out long processStartTimeUtcTicks)
    {
        processStartTimeUtcTicks = 0;
        if (processId == 0 || processId == Environment.ProcessId)
        {
            return false;
        }

        try
        {
            using var process = Process.GetProcessById(checked((int)processId));
            processStartTimeUtcTicks = process.StartTime.ToUniversalTime().Ticks;
            return processStartTimeUtcTicks > 0;
        }
        catch (Exception ex) when (
            ex is ArgumentException or
                InvalidOperationException or
                System.ComponentModel.Win32Exception or
                OverflowException)
        {
            return false;
        }
    }

    private static WindowToggleResult ActivateResolved(string windowId, IntPtr window)
    {
        if (IsIconic(window))
        {
            _ = ShowWindowAsync(window, SwRestore);
        }

        if (!SetForegroundWindow(window))
        {
            throw new BridgeFaultException(
                "WINDOW_ACTIVATION_BLOCKED",
                "Windows did not allow JARVIS to bring the requested window to the foreground.");
        }

        return new WindowToggleResult(windowId, "activated");
    }

    private bool TryCaptureWindow(
        IntPtr window,
        IntPtr foreground,
        out TaskbarWindowSnapshot snapshot,
        out VirtualDesktopMembership virtualDesktopMembership)
    {
        snapshot = null!;
        virtualDesktopMembership = VirtualDesktopMembership.Unavailable;
        if (!TryGetEligibleProcessId(window, out var processId))
        {
            return false;
        }

        virtualDesktopMembership = _virtualDesktopFilter.Query(window);
        if (!VirtualDesktopScopePolicy.ShouldInclude(virtualDesktopMembership))
        {
            return false;
        }

        var title = ReadWindowText(window);
        if (string.IsNullOrWhiteSpace(title))
        {
            return false;
        }

        try
        {
            using var process = Process.GetProcessById(checked((int)processId));
            var processName = process.ProcessName;
            snapshot = new TaskbarWindowSnapshot(
                FormatWindowId(window),
                title.Trim(),
                processName,
                process.Id,
                IsIconic(window),
                foreground == window,
                GetPackagedApplicationId(process.Id, processName),
                GetIconDataUrl(window, process, processName));
            return true;
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            return false;
        }
    }

    private static bool IsFullscreenOnPrimaryMonitor(IntPtr window)
    {
        if (window == IntPtr.Zero ||
            IsIconic(window) ||
            !IsWindowVisible(window) ||
            IsCloaked(window) ||
            !NativeDisplay.TryGetMonitorForWindow(window, out var monitor))
        {
            return false;
        }

        _ = GetWindowThreadProcessId(window, out var processId);
        if (processId == 0 || processId == Environment.ProcessId)
        {
            return false;
        }

        var className = ReadClassName(window);
        if (className is "Shell_TrayWnd" or "Shell_SecondaryTrayWnd" or "Progman" or "WorkerW")
        {
            return false;
        }

        if (!TryGetWindowFrameBounds(window, out var bounds))
        {
            return false;
        }

        return TaskbarFullscreenPolicy.ShouldSuppress(
            bounds,
            monitor,
            windowVisible: true,
            minimized: false,
            standardMaximizedWindow: IsStandardMaximizedWindow(window));
    }

    private static bool IsStandardMaximizedWindow(IntPtr window)
    {
        var style = GetWindowLongPtr(window, GwlStyle).ToInt64();
        return TaskbarFullscreenPolicy.IsStandardMaximizedWindow(
            IsZoomed(window),
            style);
    }

    private static bool TryGetWindowFrameBounds(
        IntPtr window,
        out PixelRect bounds)
    {
        if (DwmGetWindowAttribute(
                window,
                DwmwaExtendedFrameBounds,
                out NativeRect frame,
                Marshal.SizeOf<NativeRect>()) != 0 &&
            !GetWindowRect(window, out frame))
        {
            bounds = default;
            return false;
        }

        bounds = new PixelRect(
            frame.Left,
            frame.Top,
            frame.Right,
            frame.Bottom);
        return bounds.Width > 0 && bounds.Height > 0;
    }

    private static bool IsCloaked(IntPtr window)
    {
        var cloaked = 0;
        return DwmGetWindowAttribute(window, DwmwaCloaked, out cloaked, sizeof(int)) == 0 && cloaked != 0;
    }

    private string? GetPackagedApplicationId(int processId, string processName)
    {
        lock (_iconCacheLock)
        {
            if (_processApplicationCache.TryGetValue(processId, out var cached) &&
                cached.ProcessName.Equals(processName, StringComparison.OrdinalIgnoreCase))
            {
                return cached.ApplicationId;
            }
        }

        var applicationId = TryReadPackagedApplicationId(processId);
        lock (_iconCacheLock)
        {
            _processApplicationCache[processId] = new ProcessApplicationCacheEntry(
                processName,
                applicationId);
        }

        return applicationId;
    }

    private static string? TryReadPackagedApplicationId(int processId)
    {
        var processHandle = OpenProcess(ProcessQueryLimitedInformation, false, checked((uint)processId));
        if (processHandle == IntPtr.Zero)
        {
            return null;
        }

        try
        {
            uint length = 0;
            var result = GetApplicationUserModelId(processHandle, ref length, null);
            if (result != ErrorInsufficientBuffer || length == 0 || length > MaxAppUserModelIdLength)
            {
                return null;
            }

            var appUserModelId = new StringBuilder(checked((int)length));
            result = GetApplicationUserModelId(processHandle, ref length, appUserModelId);
            if (result != ErrorSuccess)
            {
                return null;
            }

            var value = appUserModelId.ToString();
            return PackagedApplicationService.IsValidAppUserModelId(value)
                ? ApplicationCapabilityId.FromPackagedAppUserModelId(value)
                : null;
        }
        catch (Exception ex) when (ex is ArgumentException or OverflowException)
        {
            return null;
        }
        finally
        {
            _ = CloseHandle(processHandle);
        }
    }

    private string? GetIconDataUrl(IntPtr window, Process process, string processName)
    {
        lock (_iconCacheLock)
        {
            if (_processIconCache.TryGetValue(process.Id, out var processCached) &&
                processCached.ProcessName.Equals(processName, StringComparison.OrdinalIgnoreCase))
            {
                return processCached.IconDataUrl;
            }
        }

        string? executablePath = null;
        try
        {
            executablePath = process.MainModule?.FileName;
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            // Protected and packaged applications may not expose their executable path.
        }

        var cacheKey = string.IsNullOrWhiteSpace(executablePath)
            ? processName
            : executablePath;
        lock (_iconCacheLock)
        {
            if (_iconCache.TryGetValue(cacheKey, out var cached))
            {
                _processIconCache[process.Id] = new ProcessIconCacheEntry(processName, cached);
                return cached;
            }
        }

        var iconDataUrl = TryReadWindowIcon(window) ?? TryReadFileIcon(executablePath);
        if (iconDataUrl is not null)
        {
            lock (_iconCacheLock)
            {
                if (!_iconCache.ContainsKey(cacheKey) && _iconCache.Count >= MaxIconCacheEntries)
                {
                    foreach (var staleKey in _iconCache.Keys.Take(MaxIconCacheEntries / 4).ToArray())
                    {
                        _iconCache.Remove(staleKey);
                    }
                }

                _iconCache[cacheKey] = iconDataUrl;
                _processIconCache[process.Id] = new ProcessIconCacheEntry(processName, iconDataUrl);
            }
        }

        return iconDataUrl;
    }

    private void PruneProcessCaches(IEnumerable<int> activeProcessIds)
    {
        var active = activeProcessIds.ToHashSet();
        lock (_iconCacheLock)
        {
            foreach (var processId in _processIconCache.Keys.Where(id => !active.Contains(id)).ToArray())
            {
                _processIconCache.Remove(processId);
            }

            foreach (var processId in _processApplicationCache.Keys.Where(id => !active.Contains(id)).ToArray())
            {
                _processApplicationCache.Remove(processId);
            }
        }
    }

    private bool TryResolveEligibleWindow(string windowId, out IntPtr window) =>
        TryParseWindowId(windowId, out window) &&
        IsWindow(window) &&
        TryGetEligibleProcessId(window, out _) &&
        VirtualDesktopScopePolicy.ShouldInclude(_virtualDesktopFilter.Query(window));

    private static bool TryGetEligibleProcessId(IntPtr window, out uint processId)
    {
        processId = 0;
        if (window == IntPtr.Zero || !IsWindowVisible(window) || IsCloaked(window))
        {
            return false;
        }

        _ = GetWindowThreadProcessId(window, out processId);
        if (processId == 0 || processId == Environment.ProcessId)
        {
            return false;
        }

        var className = ReadClassName(window);
        if (className is "Shell_TrayWnd" or "Shell_SecondaryTrayWnd" or "Progman" or "WorkerW")
        {
            return false;
        }

        var exStyle = GetWindowLongPtr(window, GwlExStyle).ToInt64();
        var isToolWindow = (exStyle & WsExToolWindow) != 0;
        var isAppWindow = (exStyle & WsExAppWindow) != 0;
        if ((isToolWindow && !isAppWindow) || (GetWindow(window, 4) != IntPtr.Zero && !isAppWindow))
        {
            return false;
        }

        return !string.IsNullOrWhiteSpace(ReadWindowText(window));
    }

    private static string? TryReadWindowIcon(IntPtr window)
    {
        var icon = SendForIcon(window, IconBig);
        if (icon == IntPtr.Zero)
        {
            icon = GetClassLongPtr(window, GclpHicon);
        }

        if (icon == IntPtr.Zero)
        {
            icon = SendForIcon(window, IconSmall2);
        }

        if (icon == IntPtr.Zero)
        {
            icon = SendForIcon(window, IconSmall);
        }

        if (icon == IntPtr.Zero)
        {
            icon = GetClassLongPtr(window, GclpHiconSmall);
        }

        return icon == IntPtr.Zero ? null : EncodeIcon(icon);
    }

    private static IntPtr SendForIcon(IntPtr window, nuint iconSize)
    {
        return SendMessageTimeout(
            window,
            WmGetIcon,
            iconSize,
            0,
            SmtoAbortIfHung,
            100,
            out var icon) == IntPtr.Zero
            ? IntPtr.Zero
            : icon;
    }

    private static string? TryReadFileIcon(string? executablePath)
    {
        if (string.IsNullOrWhiteSpace(executablePath))
        {
            return null;
        }

        var fileInfo = new ShFileInfo();
        if (SHGetFileInfo(
                executablePath,
                0,
                ref fileInfo,
                (uint)Marshal.SizeOf<ShFileInfo>(),
                ShgfiIcon) == IntPtr.Zero ||
            fileInfo.IconHandle == IntPtr.Zero)
        {
            return null;
        }

        try
        {
            return EncodeIcon(fileInfo.IconHandle);
        }
        finally
        {
            _ = DestroyIcon(fileInfo.IconHandle);
        }
    }

    private static string? EncodeIcon(IntPtr icon)
    {
        try
        {
            var bitmap = Imaging.CreateBitmapSourceFromHIcon(
                icon,
                Int32Rect.Empty,
                BitmapSizeOptions.FromWidthAndHeight(32, 32));
            bitmap.Freeze();

            var encoder = new PngBitmapEncoder();
            encoder.Frames.Add(BitmapFrame.Create(bitmap));
            using var stream = new MemoryStream();
            encoder.Save(stream);
            return $"data:image/png;base64,{Convert.ToBase64String(stream.ToArray())}";
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or NotSupportedException)
        {
            return null;
        }
    }

    private static string ReadWindowText(IntPtr window)
    {
        var length = Math.Clamp(GetWindowTextLength(window), 0, 4096);
        if (length == 0)
        {
            return string.Empty;
        }

        var buffer = new StringBuilder(length + 1);
        _ = GetWindowText(window, buffer, buffer.Capacity);
        return buffer.ToString();
    }

    private static string ReadClassName(IntPtr window)
    {
        var buffer = new StringBuilder(256);
        _ = GetClassName(window, buffer, buffer.Capacity);
        return buffer.ToString();
    }

    private static string FormatWindowId(IntPtr window) => $"0x{window.ToInt64():X}";

    internal static bool TryParseWindowId(string value, out IntPtr window)
    {
        window = IntPtr.Zero;
        if (string.IsNullOrWhiteSpace(value) ||
            !value.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ||
            !long.TryParse(value.AsSpan(2), System.Globalization.NumberStyles.AllowHexSpecifier,
                System.Globalization.CultureInfo.InvariantCulture, out var raw))
        {
            return false;
        }

        window = new IntPtr(raw);
        return window != IntPtr.Zero;
    }

    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);

    public void Dispose()
    {
        lock (_showDesktopLock)
        {
            _showDesktopTargets = Array.Empty<ShowDesktopRestoreTarget>();
            _showDesktopRestoreJarvisForeground = false;
        }

        _virtualDesktopFilter.Dispose();
        lock (_iconCacheLock)
        {
            _iconCache.Clear();
            _processIconCache.Clear();
            _processApplicationCache.Clear();
        }
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsIconic(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsZoomed(IntPtr window);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr window, out NativeRect rectangle);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(
        uint desiredAccess,
        [MarshalAs(UnmanagedType.Bool)] bool inheritHandle,
        uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetApplicationUserModelId(
        IntPtr processHandle,
        ref uint applicationUserModelIdLength,
        [Out] StringBuilder? applicationUserModelId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int maximumCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(IntPtr window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, StringBuilder className, int maximumCount);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr64(IntPtr window, int index);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern IntPtr GetWindowLong32(IntPtr window, int index);

    private static IntPtr GetWindowLongPtr(IntPtr window, int index) =>
        IntPtr.Size == 8 ? GetWindowLongPtr64(window, index) : GetWindowLong32(window, index);

    [DllImport("user32.dll", EntryPoint = "GetClassLongPtrW")]
    private static extern IntPtr GetClassLongPtr64(IntPtr window, int index);

    [DllImport("user32.dll", EntryPoint = "GetClassLongW")]
    private static extern IntPtr GetClassLong32(IntPtr window, int index);

    private static IntPtr GetClassLongPtr(IntPtr window, int index) =>
        IntPtr.Size == 8 ? GetClassLongPtr64(window, index) : GetClassLong32(window, index);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr window, uint command);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindowAsync(IntPtr window, int command);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostMessage(
        IntPtr window,
        uint message,
        IntPtr wordParameter,
        IntPtr longParameter);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(
        IntPtr window,
        uint message,
        nuint wordParameter,
        nint longParameter,
        uint flags,
        uint timeout,
        out IntPtr result);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SHGetFileInfo(
        string path,
        uint fileAttributes,
        ref ShFileInfo fileInfo,
        uint fileInfoSize,
        uint flags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyIcon(IntPtr icon);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(
        IntPtr window,
        uint attribute,
        out int value,
        int valueSize);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(
        IntPtr window,
        uint attribute,
        out NativeRect value,
        int valueSize);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ShFileInfo
    {
        public IntPtr IconHandle;
        public int IconIndex;
        public uint Attributes;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string DisplayName;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)]
        public string TypeName;
    }

    private sealed record ProcessIconCacheEntry(string ProcessName, string IconDataUrl);
    private sealed record ProcessApplicationCacheEntry(string ProcessName, string? ApplicationId);
}

internal sealed record WindowTaskbarSnapshot(
    IReadOnlyList<TaskbarWindowSnapshot> Windows,
    string? ForegroundWindowId,
    bool ForegroundFullscreen = false,
    bool VirtualDesktopFilteringAvailable = false,
    int ExcludedVirtualDesktopWindowCount = 0);

internal sealed record TaskbarWindowSnapshot(
    string WindowId,
    string Title,
    string ProcessName,
    int Pid,
    bool Minimized,
    bool Active,
    string? ApplicationId,
    string? IconDataUrl);

internal sealed record WindowToggleResult(string WindowId, string Action);

internal sealed record WindowCloseResult(string WindowId, string Action);

internal sealed record ShowDesktopToggleResult(
    string Action,
    int AffectedWindowCount,
    bool RestoreAvailable,
    bool RestoreJarvisForeground);
