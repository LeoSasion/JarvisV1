[CmdletBinding()]
param(
    [string]$ProcessName = 'mspaint',

    [switch]$AllowUnstyled
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not ('JarvisNativeWindowProbe' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class JarvisNativeWindowProbe
{
    public delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);

    [StructLayout(LayoutKind.Sequential)]
    public struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int maximumCount);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr64(IntPtr window, int index);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern IntPtr GetWindowLong32(IntPtr window, int index);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetWindowRect(IntPtr window, out Rect rectangle);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsZoomed(IntPtr window);

    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(
        IntPtr window,
        uint attribute,
        out int value,
        int valueSize);

    public static IntPtr GetWindowLongPtr(IntPtr window, int index)
    {
        return IntPtr.Size == 8
            ? GetWindowLongPtr64(window, index)
            : GetWindowLong32(window, index);
    }

    public static IntPtr[] GetTopLevelWindows()
    {
        var windows = new List<IntPtr>();
        EnumWindows((window, _) =>
        {
            windows.Add(window);
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }

    public static string ReadWindowText(IntPtr window)
    {
        var text = new StringBuilder(512);
        return GetWindowText(window, text, text.Capacity) > 0
            ? text.ToString()
            : String.Empty;
    }
}
'@
}

function Read-DwmAttribute {
    param(
        [Parameter(Mandatory)] [IntPtr]$Window,
        [Parameter(Mandatory)] [uint32]$Attribute
    )

    $value = 0
    $result = [JarvisNativeWindowProbe]::DwmGetWindowAttribute(
        $Window,
        $Attribute,
        [ref]$value,
        4)
    [pscustomobject]@{
        Supported = $result -eq 0
        Value = if ($result -eq 0) { $value } else { $null }
        HResult = $result
    }
}

$target = Get-Process -Name $ProcessName -ErrorAction Stop |
    Where-Object MainWindowHandle -ne 0 |
    Sort-Object StartTime -Descending |
    Select-Object -First 1
if ($null -eq $target) {
    throw "No visible $ProcessName window is available."
}

$targetHandle = [IntPtr]$target.MainWindowHandle
$attributes = [ordered]@{
    immersiveDarkMode = Read-DwmAttribute -Window $targetHandle -Attribute 20
    cornerPreference = Read-DwmAttribute -Window $targetHandle -Attribute 33
    borderColor = Read-DwmAttribute -Window $targetHandle -Attribute 34
    captionColor = Read-DwmAttribute -Window $targetHandle -Attribute 35
    textColor = Read-DwmAttribute -Window $targetHandle -Attribute 36
}
$dwmStyled = $attributes.cornerPreference.Supported -and
    $attributes.cornerPreference.Value -eq 2

$jarvisProcessIds = @(Get-Process -Name Jarvis.Host -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty Id)
$requiredExtendedStyles = 0x08000000L -bor 0x00000080L -bor 0x00000020L
$auraWindows = @(
    foreach ($window in [JarvisNativeWindowProbe]::GetTopLevelWindows()) {
        $processId = [uint32]0
        [void][JarvisNativeWindowProbe]::GetWindowThreadProcessId($window, [ref]$processId)
        if ($processId -notin $jarvisProcessIds -or
            [JarvisNativeWindowProbe]::ReadWindowText($window) -ne 'JARVIS Window Aura') {
            continue
        }

        $rectangle = [JarvisNativeWindowProbe+Rect]::new()
        [void][JarvisNativeWindowProbe]::GetWindowRect($window, [ref]$rectangle)
        $extendedStyle = [JarvisNativeWindowProbe]::GetWindowLongPtr($window, -20).ToInt64()
        [pscustomobject]@{
            handle = $window.ToInt64()
            visible = [JarvisNativeWindowProbe]::IsWindowVisible($window)
            clickThrough = ($extendedStyle -band $requiredExtendedStyles) -eq $requiredExtendedStyles
            width = $rectangle.Right - $rectangle.Left
            height = $rectangle.Bottom - $rectangle.Top
        }
    }
)

$recoveryPath = Join-Path $env:LOCALAPPDATA 'JARVIS\Recovery\window-appearance.json'
$recoveryEntry = $null
if (Test-Path -LiteralPath $recoveryPath -PathType Leaf) {
    $recoverySnapshot = Get-Content -LiteralPath $recoveryPath -Raw | ConvertFrom-Json
    $recoveryEntry = @($recoverySnapshot.entries) |
        Where-Object windowHandle -eq $targetHandle.ToInt64() |
        Select-Object -First 1
}

$auraReady = $auraWindows.Count -eq 4 -and
    @($auraWindows | Where-Object { -not $_.visible -or -not $_.clickThrough }).Count -eq 0
$recoveryArmed = $null -ne $recoveryEntry -and
    [uint32]$recoveryEntry.processId -eq [uint32]$target.Id
$passed = ($AllowUnstyled -or $dwmStyled) -and
    ($AllowUnstyled -or $auraReady) -and
    ($AllowUnstyled -or $recoveryArmed)

$result = [ordered]@{
    passed = $passed
    target = [ordered]@{
        processName = $target.ProcessName
        processId = $target.Id
        windowHandle = $targetHandle.ToInt64()
        title = $target.MainWindowTitle
        maximized = [JarvisNativeWindowProbe]::IsZoomed($targetHandle)
    }
    dwmStyled = $dwmStyled
    attributes = $attributes
    auraReady = $auraReady
    auraWindows = $auraWindows
    recoveryArmed = $recoveryArmed
    recoveryPath = $recoveryPath
}

$result | ConvertTo-Json -Depth 7
if (-not $passed) {
    exit 1
}
