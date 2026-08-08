param(
    [string]$HostPath = (Join-Path $PSScriptRoot '..\host\Jarvis.Host\bin\Debug\net8.0-windows\Jarvis.Host.exe'),
    [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class JarvisRendererSmokeNative
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindow(string className, string windowName);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr window);
}
'@

function Assert-NativeTaskbarVisible {
    $window = [JarvisRendererSmokeNative]::FindWindow('Shell_TrayWnd', $null)
    if ($window -eq [IntPtr]::Zero -or -not [JarvisRendererSmokeNative]::IsWindowVisible($window)) {
        throw 'The native Windows taskbar is not visible.'
    }
}

$resolvedHost = [System.IO.Path]::GetFullPath($HostPath)
if (-not (Test-Path -LiteralPath $resolvedHost -PathType Leaf)) {
    throw "Renderer smoke host does not exist: $resolvedHost"
}

$existingHosts = @(Get-Process -Name 'Jarvis.Host' -ErrorAction SilentlyContinue)
if ($existingHosts.Count -gt 0) {
    throw 'Renderer smoke requires JARVIS to be closed before the isolated check.'
}

$smokeParent = Join-Path ([System.IO.Path]::GetTempPath()) 'jarvis-renderer-smoke'
$dataRoot = Join-Path $smokeParent ([Guid]::NewGuid().ToString('N'))
$receiptPath = Join-Path $dataRoot 'receipts\renderer.json'
$nonce = [Guid]::NewGuid().ToString('N')
$process = $null

try {
    Assert-NativeTaskbarVisible
    New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $resolvedHost
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.ArgumentList.Add('--renderer-smoke')
    $startInfo.ArgumentList.Add("--renderer-smoke-data-root=$dataRoot")
    $startInfo.ArgumentList.Add("--renderer-smoke-receipt=$receiptPath")
    $startInfo.ArgumentList.Add("--renderer-smoke-nonce=$nonce")

    $process = [System.Diagnostics.Process]::Start($startInfo)
    if ($null -eq $process) {
        throw 'Renderer smoke host could not be started.'
    }
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        throw "Renderer smoke exceeded the ${TimeoutSeconds}s timeout."
    }
    if ($process.ExitCode -ne 0) {
        $diagnostic = if (Test-Path -LiteralPath $receiptPath -PathType Leaf) {
            Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8
        }
        else {
            $logPath = Join-Path $dataRoot 'Logs\jarvis-host.log'
            if (Test-Path -LiteralPath $logPath -PathType Leaf) {
                (Get-Content -LiteralPath $logPath -Tail 40 -Encoding UTF8) -join [Environment]::NewLine
            }
            else {
                'No renderer receipt or isolated Host log was produced.'
            }
        }
        throw "Renderer smoke host exited with code $($process.ExitCode).`n$diagnostic"
    }

    if (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) {
        throw 'Renderer smoke did not create its isolated receipt.'
    }
    $receipt = Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($receipt.schemaVersion -ne 1 -or
        $receipt.mode -ne 'renderer-smoke' -or
        $receipt.nonce -ne $nonce -or
        $receipt.success -ne $true -or
        $receipt.mainWindowCreated -ne $true -or
        $receipt.taskbarTouched -ne $false -or
        $null -ne $receipt.error) {
        throw 'Renderer smoke receipt metadata is invalid.'
    }

    $requiredAssertions = @(
        'shellReady',
        'helpOpened',
        'helpClosed',
        'explorerOpened',
        'agentOpened',
        'linkedWorkspaceReady',
        'noticeAvoidsCriticalControls',
        'reducedMotionStylesApplied'
    )
    foreach ($assertion in $requiredAssertions) {
        if ($receipt.result.$assertion -ne $true) {
            throw "Renderer smoke assertion failed: $assertion"
        }
    }

    Assert-NativeTaskbarVisible
    if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) {
        throw 'Renderer smoke host remained alive after producing its receipt.'
    }

    Write-Output 'renderer-smoke: PASS'
}
finally {
    if ($null -ne $process -and -not $process.HasExited) {
        $process.Kill($true)
        $process.WaitForExit(5000) | Out-Null
    }

    if (Test-Path -LiteralPath $dataRoot) {
        $resolvedDataRoot = [System.IO.Path]::GetFullPath($dataRoot)
        $resolvedParent = [System.IO.Path]::GetFullPath($smokeParent).TrimEnd('\') + '\'
        if (-not $resolvedDataRoot.StartsWith($resolvedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw 'Renderer smoke cleanup target escaped its dedicated temp parent.'
        }
        $removed = $false
        for ($attempt = 0; $attempt -lt 40; $attempt++) {
            if (-not (Test-Path -LiteralPath $resolvedDataRoot)) {
                $removed = $true
                break
            }
            try {
                Remove-Item -LiteralPath $resolvedDataRoot -Recurse -Force -ErrorAction Stop
                $removed = $true
                break
            }
            catch [System.IO.IOException] {
                Start-Sleep -Milliseconds 250
            }
            catch [System.UnauthorizedAccessException] {
                Start-Sleep -Milliseconds 250
            }
        }
        if (-not $removed -and (Test-Path -LiteralPath $resolvedDataRoot)) {
            throw 'Renderer smoke WebView2 profile did not release its lock within 10 seconds.'
        }
    }

    if (Get-Process -Name 'Jarvis.Host' -ErrorAction SilentlyContinue) {
        throw 'Renderer smoke left a JARVIS Host process running.'
    }
    Assert-NativeTaskbarVisible
}
