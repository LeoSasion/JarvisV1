[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

if (@(Get-Process -Name "Jarvis.Host" -ErrorAction SilentlyContinue).Count -gt 0) {
    throw "JARVIS or its recovery watchdog is still running. Use Ctrl+Shift+Q and wait before forcing native taskbar visibility."
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class JarvisTaskbarRecoveryNativeMethods
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindow(string className, string windowName);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ShowWindowAsync(IntPtr window, int command);
}
"@

$taskbar = [JarvisTaskbarRecoveryNativeMethods]::FindWindow(
    "Shell_TrayWnd",
    $null)
if ($taskbar -eq [IntPtr]::Zero) {
    throw "The primary Windows taskbar window could not be found."
}

$visibleBefore =
    [JarvisTaskbarRecoveryNativeMethods]::IsWindowVisible($taskbar)
if (-not $visibleBefore) {
    [void][JarvisTaskbarRecoveryNativeMethods]::ShowWindowAsync(
        $taskbar,
        8)
}

$deadline = (Get-Date).AddSeconds(5)
do {
    $visibleAfter =
        [JarvisTaskbarRecoveryNativeMethods]::IsWindowVisible($taskbar)
    if ($visibleAfter) {
        break
    }

    Start-Sleep -Milliseconds 100
} while ((Get-Date) -lt $deadline)

$result = [ordered]@{
    status = if ($visibleAfter) { "READY" } else { "ATTENTION" }
    taskbarHandle = "0x{0:X}" -f $taskbar.ToInt64()
    visibleBefore = $visibleBefore
    visibleAfter = $visibleAfter
}
$result | ConvertTo-Json

if (-not $visibleAfter) {
    throw "The primary Windows taskbar did not become visible."
}
