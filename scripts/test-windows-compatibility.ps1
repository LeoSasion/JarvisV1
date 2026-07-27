[CmdletBinding()]
param(
    [switch]$Strict
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$minimumBuild = 17763
$os = [System.Environment]::OSVersion.Version
$architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
$webViewVersion = $null
$webViewLocations = @(
    'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F1E7E86C-5E64-4A13-A6C3-8E90C1EAA4D8}',
    'HKLM:\Software\Microsoft\EdgeUpdate\Clients\{F1E7E86C-5E64-4A13-A6C3-8E90C1EAA4D8}',
    'HKLM:\Software\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F1E7E86C-5E64-4A13-A6C3-8E90C1EAA4D8}'
)

foreach ($location in $webViewLocations) {
    if (-not (Test-Path -LiteralPath $location)) {
        continue
    }

    $webViewVersion = (Get-ItemProperty -LiteralPath $location -ErrorAction SilentlyContinue).pv
    if ($webViewVersion) {
        break
    }
}

if (-not $webViewVersion) {
    $webViewRoots = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\EdgeWebView\Application'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\EdgeWebView\Application')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

    $webViewVersion = $webViewRoots |
        ForEach-Object { Get-ChildItem -LiteralPath $_ -Directory -ErrorAction SilentlyContinue } |
        Where-Object { $_.Name -match '^\d+(\.\d+){3}$' } |
        Sort-Object { [version]$_.Name } -Descending |
        Select-Object -First 1 -ExpandProperty Name
}

$screens = @([System.Windows.Forms.Screen]::AllScreens)
$result = [ordered]@{
    compatible = $os.Build -ge $minimumBuild -and $architecture -eq 'X64'
    osVersion = $os.ToString()
    osBuild = $os.Build
    minimumBuild = $minimumBuild
    architecture = $architecture
    monitorCount = $screens.Count
    primaryResolution = if ($screens.Count -gt 0) {
        '{0}x{1}' -f $screens[0].Bounds.Width, $screens[0].Bounds.Height
    } else {
        $null
    }
    webView2Version = $webViewVersion
    webView2Detected = [bool]$webViewVersion
    desktopPolicy = 'primary-only'
    secondaryTaskbarsPreserved = $true
    note = 'This is a readiness probe, not Win10 real-machine certification.'
}

$result | ConvertTo-Json -Depth 4

if ($Strict -and (-not $result.compatible -or -not $result.webView2Detected)) {
    throw 'Windows compatibility readiness checks failed.'
}
