[CmdletBinding()]
param(
    [ValidatePattern('^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$')]
    [string]$Version = '0.1.0',

    [string]$InstallerPath,

    [switch]$SkipRepair
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$lifecycleRoot = Join-Path $repositoryRoot 'tmp\installer-lifecycle'
$testRoot = Join-Path $lifecycleRoot $Version
$installDirectory = Join-Path $testRoot 'installed'
$installerLog = Join-Path $testRoot 'install.log'
$repairLog = Join-Path $testRoot 'repair.log'
$uninstallLog = Join-Path $testRoot 'uninstall.log'
$startupKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$startupValueName = 'JARVIS Night Shell'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{3D127645-F2E2-4F10-A50F-A4E4B71CE06E}_is1'
$defaultInstallDirectory = Join-Path $env:LOCALAPPDATA 'Programs\JARVIS'
$hostProcess = $null
$installCompleted = $false
$installedExecutable = Join-Path $installDirectory 'Jarvis.Host.exe'
$expectedStartupValue = "`"$installedExecutable`" --startup"
$originalKeepNativeTaskbar = [Environment]::GetEnvironmentVariable('JARVIS_KEEP_NATIVE_TASKBAR', 'Process')
$originalDiagnosticPanel = [Environment]::GetEnvironmentVariable('JARVIS_DIAGNOSTIC_SHELL_PANEL', 'Process')

function Assert-ChildPath {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [string]$Parent
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $fullParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    if (-not $fullPath.StartsWith($fullParent, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing lifecycle modification outside the expected test root: $fullPath"
    }
    return $fullPath
}

function Reset-TestDirectory {
    $safeTestRoot = Assert-ChildPath -Path $testRoot -Parent $lifecycleRoot
    if (Test-Path -LiteralPath $safeTestRoot) {
        Remove-Item -LiteralPath $safeTestRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path $safeTestRoot -Force | Out-Null
}

function Invoke-ProcessChecked {
    param(
        [Parameter(Mandatory)] [string]$FilePath,
        [Parameter(Mandatory)] [string[]]$Arguments
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    foreach ($argument in $Arguments) {
        $startInfo.ArgumentList.Add($argument)
    }

    $process = [System.Diagnostics.Process]::Start($startInfo)
    if ($null -eq $process) {
        throw "Windows did not start $FilePath."
    }
    try {
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) {
            throw "$FilePath exited with code $($process.ExitCode)."
        }
    }
    finally {
        $process.Dispose()
    }
}

function Test-PathsEqual {
    param(
        [string]$Left,
        [string]$Right
    )

    if ([string]::IsNullOrWhiteSpace($Left) -or [string]::IsNullOrWhiteSpace($Right)) {
        return $false
    }
    try {
        $leftPath = [System.IO.Path]::GetFullPath($Left).TrimEnd('\')
        $rightPath = [System.IO.Path]::GetFullPath($Right).TrimEnd('\')
        return $leftPath.Equals($rightPath, [System.StringComparison]::OrdinalIgnoreCase)
    }
    catch {
        return $false
    }
}

function Get-StartupValue {
    $item = Get-ItemProperty `
        -LiteralPath $startupKey `
        -Name $startupValueName `
        -ErrorAction SilentlyContinue
    if ($null -eq $item) {
        return $null
    }
    return $item.PSObject.Properties[$startupValueName].Value
}

if ([string]::IsNullOrWhiteSpace($InstallerPath)) {
    $InstallerPath = Join-Path $repositoryRoot "artifacts\installer\JARVIS-Setup-$Version-win-x64.exe"
}
$InstallerPath = [System.IO.Path]::GetFullPath($InstallerPath)

if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
    throw "Installer not found: $InstallerPath"
}
if (Test-Path -LiteralPath $uninstallKey) {
    throw 'A JARVIS installer registration already exists. Lifecycle verification will not overwrite it.'
}
if (-not [string]::IsNullOrWhiteSpace((Get-StartupValue))) {
    throw 'A JARVIS startup registration already exists. Lifecycle verification will not overwrite it.'
}
if (Test-Path -LiteralPath $defaultInstallDirectory) {
    throw "The default JARVIS install directory already exists: $defaultInstallDirectory"
}
if (@(Get-Process 'Jarvis.Host' -ErrorAction SilentlyContinue).Count -gt 0) {
    throw 'JARVIS is already running. Exit it before lifecycle verification.'
}

$explorerCountBefore = @(Get-Process explorer -ErrorAction SilentlyContinue).Count
if ($explorerCountBefore -eq 0) {
    throw 'Explorer is not running; taskbar recovery safety cannot be verified.'
}

try {
    Reset-TestDirectory
    $installArguments = @(
        '/VERYSILENT',
        '/SUPPRESSMSGBOXES',
        '/NORESTART',
        '/CLOSEAPPLICATIONS',
        '/NOICONS',
        "/DIR=$installDirectory",
        '/MERGETASKS=autostart,!desktopicon',
        "/LOG=$installerLog"
    )

    Write-Host '[1/5] Installing into an isolated current-user directory...'
    Invoke-ProcessChecked -FilePath $InstallerPath -Arguments $installArguments
    $installCompleted = $true

    $uninstaller = Join-Path $installDirectory 'unins000.exe'
    if (-not (Test-Path -LiteralPath $installedExecutable -PathType Leaf) -or
        -not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
        throw 'The installer completed without the host executable or uninstaller.'
    }
    if ((Get-Item -LiteralPath $installedExecutable).VersionInfo.ProductVersion -ne $Version) {
        throw 'The installed executable version does not match the requested release.'
    }

    if ((Get-StartupValue) -ne $expectedStartupValue) {
        throw 'The installer did not create the expected current-user startup command.'
    }

    $installLocation = (Get-ItemProperty -LiteralPath $uninstallKey -ErrorAction Stop).InstallLocation
    if ([System.IO.Path]::GetFullPath($installLocation).TrimEnd('\') -ne
        [System.IO.Path]::GetFullPath($installDirectory).TrimEnd('\')) {
        throw 'The uninstall registration does not match the isolated install directory.'
    }

    Write-Host '[2/5] Launching the installed host in native-taskbar-safe mode...'
    $logPath = Join-Path $env:LOCALAPPDATA 'JARVIS\Logs\jarvis-host.log'
    $logLengthBefore = if (Test-Path -LiteralPath $logPath) {
        (Get-Item -LiteralPath $logPath).Length
    }
    else {
        0
    }
    $env:JARVIS_KEEP_NATIVE_TASKBAR = '1'
    $env:JARVIS_DIAGNOSTIC_SHELL_PANEL = 'settings'
    $hostProcess = Start-Process `
        -FilePath $installedExecutable `
        -ArgumentList '--startup' `
        -WindowStyle Hidden `
        -PassThru
    try {
        $null = $hostProcess.WaitForInputIdle(10000)
    }
    catch {
        # The following explicit process/log checks provide the startup receipt.
    }
    Start-Sleep -Seconds 3
    $hostProcess.Refresh()
    if ($hostProcess.HasExited) {
        throw "The installed host exited during initialization with code $($hostProcess.ExitCode)."
    }
    $closeRequested = $hostProcess.CloseMainWindow()
    if (-not $closeRequested -or -not $hostProcess.WaitForExit(10000)) {
        Write-Warning 'The installed host did not accept a graceful close; forcing safe-mode test cleanup.'
        Stop-Process -Id $hostProcess.Id
        $hostProcess.WaitForExit(10000)
    }
    $hostProcess = $null

    $newLog = if (Test-Path -LiteralPath $logPath) {
        $stream = [System.IO.File]::Open($logPath, 'Open', 'Read', 'ReadWrite')
        try {
            $stream.Seek($logLengthBefore, [System.IO.SeekOrigin]::Begin) | Out-Null
            $reader = [System.IO.StreamReader]::new($stream)
            try { $reader.ReadToEnd() } finally { $reader.Dispose() }
        }
        finally {
            $stream.Dispose()
        }
    }
    else {
        ''
    }
    if ($newLog -notmatch 'Desktop surface navigation completed' -or
        $newLog -notmatch 'safe mode is enabled' -or
        $newLog -notmatch 'Native window appearance is inactive:.*JARVIS_KEEP_NATIVE_TASKBAR=1') {
        throw 'The installed host did not produce the expected WebView2 and safe-mode receipts.'
    }

    if (-not $SkipRepair) {
        Write-Host '[3/5] Reinstalling the same release to verify repair/upgrade behavior...'
        $repairArguments = @(
            '/VERYSILENT',
            '/SUPPRESSMSGBOXES',
            '/NORESTART',
            '/CLOSEAPPLICATIONS',
            '/NOICONS',
            "/DIR=$installDirectory",
            '/MERGETASKS=autostart,!desktopicon',
            "/LOG=$repairLog"
        )
        Invoke-ProcessChecked -FilePath $InstallerPath -Arguments $repairArguments
        if ((Get-StartupValue) -ne $expectedStartupValue -or
            -not (Test-Path -LiteralPath $installedExecutable -PathType Leaf)) {
            throw 'Repair/reinstall did not preserve the executable and startup registration.'
        }
    }
    else {
        Write-Host '[3/5] Repair/reinstall verification skipped by request.'
    }

    Write-Host '[4/5] Uninstalling and checking current-user cleanup...'
    Invoke-ProcessChecked -FilePath $uninstaller -Arguments @(
        '/VERYSILENT',
        '/SUPPRESSMSGBOXES',
        '/NORESTART',
        "/LOG=$uninstallLog"
    )
    $installCompleted = $false

    for ($attempt = 0; $attempt -lt 20 -and (Test-Path -LiteralPath $uninstaller); $attempt++) {
        Start-Sleep -Milliseconds 150
    }
    if (-not [string]::IsNullOrWhiteSpace((Get-StartupValue))) {
        throw 'The JARVIS startup registration remains after uninstall.'
    }
    if (Test-Path -LiteralPath $uninstallKey) {
        throw 'The JARVIS uninstall registration remains after uninstall.'
    }
    if (Test-Path -LiteralPath $installedExecutable) {
        throw 'The JARVIS executable remains after uninstall.'
    }

    Write-Host '[5/5] Confirming Windows recovery state...'
    $explorerCountAfter = @(Get-Process explorer -ErrorAction SilentlyContinue).Count
    $jarvisProcessesAfter = @(Get-Process 'Jarvis.Host' -ErrorAction SilentlyContinue).Count
    if ($explorerCountAfter -eq 0 -or $jarvisProcessesAfter -ne 0) {
        throw 'Windows recovery state is invalid after lifecycle verification.'
    }

    [pscustomobject]@{
        Version = $Version
        Install = 'passed'
        NativeSafeLaunch = 'passed'
        Repair = if ($SkipRepair) { 'skipped' } else { 'passed' }
        Uninstall = 'passed'
        StartupCleanup = 'passed'
        ExplorerProcessesBefore = $explorerCountBefore
        ExplorerProcessesAfter = $explorerCountAfter
        JarvisProcessesAfter = $jarvisProcessesAfter
    } | ConvertTo-Json
}
finally {
    [Environment]::SetEnvironmentVariable(
        'JARVIS_KEEP_NATIVE_TASKBAR',
        $originalKeepNativeTaskbar,
        'Process')
    [Environment]::SetEnvironmentVariable(
        'JARVIS_DIAGNOSTIC_SHELL_PANEL',
        $originalDiagnosticPanel,
        'Process')

    if ($null -ne $hostProcess -and -not $hostProcess.HasExited) {
        Stop-Process -Id $hostProcess.Id -ErrorAction SilentlyContinue
        $hostProcess.WaitForExit(10000)
    }

    $uninstaller = Join-Path $installDirectory 'unins000.exe'
    if ($installCompleted -and (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
        try {
            Invoke-ProcessChecked -FilePath $uninstaller -Arguments @(
                '/VERYSILENT',
                '/SUPPRESSMSGBOXES',
                '/NORESTART'
            )
        }
        catch {
            Write-Warning "Fallback uninstall failed: $($_.Exception.Message)"
        }
    }

    if ((Get-StartupValue) -eq $expectedStartupValue) {
        Remove-ItemProperty `
            -LiteralPath $startupKey `
            -Name $startupValueName `
            -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $uninstallKey) {
        $testUninstallRecord = Get-ItemProperty -LiteralPath $uninstallKey -ErrorAction SilentlyContinue
        $installLocationProperty = if ($null -ne $testUninstallRecord) {
            $testUninstallRecord.PSObject.Properties['InstallLocation']
        }
        else {
            $null
        }
        if ($null -ne $installLocationProperty -and
            (Test-PathsEqual -Left $installLocationProperty.Value -Right $installDirectory)) {
            Remove-Item -LiteralPath $uninstallKey -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    if (Test-Path -LiteralPath $testRoot) {
        $safeTestRoot = Assert-ChildPath -Path $testRoot -Parent $lifecycleRoot
        Remove-Item -LiteralPath $safeTestRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ((Test-Path -LiteralPath $lifecycleRoot) -and
        (Get-ChildItem -LiteralPath $lifecycleRoot -Force | Measure-Object).Count -eq 0) {
        Remove-Item -LiteralPath $lifecycleRoot -Force -ErrorAction SilentlyContinue
    }
}
