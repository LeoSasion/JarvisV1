[CmdletBinding()]
param(
    [string]$JarvisExecutable,
    [string]$OutputPath = (Join-Path $PSScriptRoot "native-lifecycle-result.json"),
    [switch]$LaunchSafeMode,
    [switch]$AllowDisruptive
)

$ErrorActionPreference = "Stop"

if ($AllowDisruptive) {
    Write-Warning "Disruptive Explorer, display, lock, sleep, and network tests require explicit interactive coordination and are not automated by this script."
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class JarvisLifecycleNativeMethods
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindow(string className, string windowName);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr window);
}
"@

function Get-LifecycleSnapshot {
    $explorer = @(Get-Process -Name explorer -ErrorAction SilentlyContinue)
    $jarvis = @(Get-Process -Name "Jarvis.Host" -ErrorAction SilentlyContinue)
    $taskbar = [JarvisLifecycleNativeMethods]::FindWindow("Shell_TrayWnd", $null)
    [ordered]@{
        capturedAt = [DateTimeOffset]::Now.ToString("o")
        windowsVersion = [Environment]::OSVersion.Version.ToString()
        windowsBuild = [Environment]::OSVersion.Version.Build
        explorerProcessCount = $explorer.Count
        explorerAlive = $explorer.Count -gt 0
        nativeTaskbarHandle = ("0x{0:X}" -f $taskbar.ToInt64())
        nativeTaskbarVisible = $taskbar -ne [IntPtr]::Zero -and
            [JarvisLifecycleNativeMethods]::IsWindowVisible($taskbar)
        jarvisProcessCount = $jarvis.Count
    }
}

$before = Get-LifecycleSnapshot
$launch = $null
$failure = $null

if ($LaunchSafeMode) {
    if ([string]::IsNullOrWhiteSpace($JarvisExecutable) -or
        -not (Test-Path -LiteralPath $JarvisExecutable -PathType Leaf)) {
        throw "LaunchSafeMode requires an existing -JarvisExecutable."
    }

    $previous = $env:JARVIS_KEEP_NATIVE_TASKBAR
    try {
        $env:JARVIS_KEEP_NATIVE_TASKBAR = "1"
        $launch = Start-Process -FilePath $JarvisExecutable -PassThru -WindowStyle Hidden
        Start-Sleep -Milliseconds 2500
        if ($launch.HasExited) {
            $failure = "JARVIS exited before the safe-mode lifecycle sample completed."
        }
    }
    finally {
        if ($launch -and -not $launch.HasExited) {
            $launch.CloseMainWindow() | Out-Null
            if (-not $launch.WaitForExit(5000)) {
                Stop-Process -Id $launch.Id -Force
                if (-not $launch.WaitForExit(5000)) {
                    $failure =
                        "The safe-mode JARVIS process did not exit after forced cleanup."
                }
            }
        }
        $env:JARVIS_KEEP_NATIVE_TASKBAR = $previous
    }
}

$after = Get-LifecycleSnapshot
$result = [ordered]@{
    status = if (
        -not $failure -and
        $after.explorerAlive -and
        $after.nativeTaskbarVisible -and
        $after.jarvisProcessCount -eq 0
    ) { "READY" } else { "ATTENTION" }
    failure = $failure
    safeModeLaunchRequested = [bool]$LaunchSafeMode
    disruptiveTestsExecuted = $false
    before = $before
    after = $after
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $resolvedOutput
if ($outputDirectory) {
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resolvedOutput -Encoding utf8
$result | ConvertTo-Json -Depth 6

if ($result.status -ne "READY") {
    exit 1
}
