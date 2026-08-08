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
$hostDataRoot = Join-Path $testRoot 'host-data'
$lifecycleReceiptPath = Join-Path $hostDataRoot 'lifecycle-receipt.json'
$startupKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$startupValueName = 'JARVIS'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{3D127645-F2E2-4F10-A50F-A4E4B71CE06E}_is1'
$defaultInstallDirectory = Join-Path $env:LOCALAPPDATA 'Programs\JARVIS'
$hostProcess = $null
$cleanupRequired = $false
$installedExecutable = Join-Path $installDirectory 'Jarvis.Host.exe'
$installedPiRuntime = Join-Path $installDirectory 'AgentRuntime'
$piTrustManifestPath = Join-Path $repositoryRoot 'third_party\pi\runtime.json'
$piLicensePath = Join-Path $repositoryRoot 'third_party\pi\LICENSE-Pi.txt'
$expectedStartupValue = "`"$installedExecutable`" --startup"

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

function Test-ProcessHasExited {
    param(
        [Parameter(Mandatory)] [System.Diagnostics.Process]$Process
    )

    try {
        $Process.Refresh()
        return $Process.HasExited
    }
    catch [System.InvalidOperationException] {
        return $true
    }
}

function Stop-LifecycleProbeProcess {
    param(
        [System.Diagnostics.Process]$Process,
        [int]$TimeoutMilliseconds = 10000
    )

    if ($null -eq $Process -or (Test-ProcessHasExited -Process $Process)) {
        return
    }

    try {
        Stop-Process -Id $Process.Id -Force -ErrorAction Stop
    }
    catch {
        if (-not (Test-ProcessHasExited -Process $Process)) {
            throw "Failed to terminate lifecycle probe process $($Process.Id): $($_.Exception.Message)"
        }
    }

    if (-not $Process.WaitForExit($TimeoutMilliseconds)) {
        throw "Lifecycle probe process $($Process.Id) remained alive after termination."
    }
    if (-not (Test-ProcessHasExited -Process $Process)) {
        throw "Lifecycle probe process $($Process.Id) could not be verified as exited."
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

function Assert-LifecycleReceipt {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [string]$ExpectedNonce
    )

    $safeDataRoot = Assert-ChildPath -Path $hostDataRoot -Parent $testRoot
    $safeReceiptPath = Assert-ChildPath -Path $Path -Parent $safeDataRoot
    if (-not (Test-Path -LiteralPath $safeDataRoot -PathType Container) -or
        -not (Test-Path -LiteralPath $safeReceiptPath -PathType Leaf)) {
        throw 'The lifecycle probe did not create its isolated receipt.'
    }

    foreach ($itemPath in @($safeDataRoot, $safeReceiptPath)) {
        $item = Get-Item -LiteralPath $itemPath -Force
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "The lifecycle probe receipt path contains a reparse point: $itemPath"
        }
    }

    $receiptItem = Get-Item -LiteralPath $safeReceiptPath -Force
    if ($receiptItem.Length -le 0 -or $receiptItem.Length -gt 65536) {
        throw 'The lifecycle probe receipt has an invalid size.'
    }

    try {
        $receiptBytes = [System.IO.File]::ReadAllBytes($safeReceiptPath)
        $receiptText = [System.Text.UTF8Encoding]::new($false, $true).GetString($receiptBytes)
        $receipt = $receiptText | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw "The lifecycle probe receipt is not valid UTF-8 JSON: $($_.Exception.Message)"
    }

    if ($null -eq $receipt -or $receipt -is [System.Array]) {
        throw 'The lifecycle probe receipt must be one JSON object.'
    }

    $expectedProperties = @(
        'schemaVersion',
        'success',
        'mode',
        'nonce',
        'version',
        'executablePath',
        'dataRoot',
        'webView2Version',
        'frontend',
        'piRuntimeValidated',
        'mainWindowCreated',
        'taskbarTouched',
        'error'
    )
    $actualProperties = @($receipt.PSObject.Properties | ForEach-Object { $_.Name })
    $expectedSet = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal)
    foreach ($propertyName in $expectedProperties) {
        $null = $expectedSet.Add($propertyName)
    }
    if ($actualProperties.Count -ne $expectedProperties.Count) {
        throw 'The lifecycle probe receipt has missing or unexpected fields.'
    }
    foreach ($propertyName in $actualProperties) {
        if (-not $expectedSet.Contains($propertyName)) {
            throw "The lifecycle probe receipt contains an unexpected field: $propertyName"
        }
    }

    $schemaVersionIsInteger =
        $receipt.schemaVersion -is [byte] -or
        $receipt.schemaVersion -is [sbyte] -or
        $receipt.schemaVersion -is [short] -or
        $receipt.schemaVersion -is [ushort] -or
        $receipt.schemaVersion -is [int] -or
        $receipt.schemaVersion -is [uint] -or
        $receipt.schemaVersion -is [long] -or
        $receipt.schemaVersion -is [ulong]
    if (-not $schemaVersionIsInteger -or [long]$receipt.schemaVersion -ne 1) {
        throw 'The lifecycle probe receipt schemaVersion must be integer 1.'
    }
    if ($receipt.success -isnot [bool] -or -not $receipt.success) {
        throw 'The lifecycle probe receipt success field must be true.'
    }
    if ($receipt.mainWindowCreated -isnot [bool] -or $receipt.mainWindowCreated) {
        throw 'The lifecycle probe created a MainWindow.'
    }
    if ($receipt.taskbarTouched -isnot [bool] -or $receipt.taskbarTouched) {
        throw 'The lifecycle probe touched the native taskbar.'
    }
    if ($receipt.piRuntimeValidated -isnot [bool] -or -not $receipt.piRuntimeValidated) {
        throw 'The lifecycle probe did not validate the private Pi runtime.'
    }
    if ($null -ne $receipt.error) {
        throw 'A successful lifecycle probe receipt must not contain an error.'
    }

    foreach ($stringProperty in @(
        'mode',
        'nonce',
        'version',
        'executablePath',
        'dataRoot',
        'webView2Version',
        'frontend'
    )) {
        if ($receipt.$stringProperty -isnot [string] -or
            [string]::IsNullOrWhiteSpace($receipt.$stringProperty)) {
            throw "The lifecycle probe receipt field '$stringProperty' must be a non-empty string."
        }
    }
    if (-not $receipt.mode.Equals('lifecycle-probe', [System.StringComparison]::Ordinal)) {
        throw 'The lifecycle probe receipt mode is invalid.'
    }
    if (-not $receipt.frontend.Equals('packaged', [System.StringComparison]::Ordinal)) {
        throw 'The lifecycle probe did not validate the packaged frontend.'
    }
    if ($ExpectedNonce -notmatch '\A[0-9a-f]{32}\z' -or
        -not $receipt.nonce.Equals($ExpectedNonce, [System.StringComparison]::Ordinal)) {
        throw 'The lifecycle probe receipt nonce does not match this invocation.'
    }
    if (-not $receipt.version.Equals($Version, [System.StringComparison]::Ordinal)) {
        throw 'The lifecycle probe receipt version does not match the installed release.'
    }
    if (-not (Test-PathsEqual -Left $receipt.executablePath -Right $installedExecutable)) {
        throw 'The lifecycle probe receipt executablePath does not identify the installed host.'
    }
    if (-not (Test-PathsEqual -Left $receipt.dataRoot -Right $safeDataRoot)) {
        throw 'The lifecycle probe receipt dataRoot is not the isolated test data root.'
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

function Assert-InstalledPiRuntime {
    if (-not (Test-Path -LiteralPath $piTrustManifestPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $piLicensePath -PathType Leaf)) {
        throw 'The repository Pi trust manifest or retained license is missing.'
    }

    $trustManifest = Get-Content -LiteralPath $piTrustManifestPath -Raw | ConvertFrom-Json
    if (-not ([string]$trustManifest.runtime).Equals(
        'win-x64',
        [System.StringComparison]::Ordinal)) {
        throw 'The repository Pi trust manifest does not contain win-x64.'
    }
    $runtime = $trustManifest.executable
    $runtimeManifestPath = Join-Path $installedPiRuntime 'runtime.json'
    $runtimeLicensePath = Join-Path $installedPiRuntime 'LICENSE-Pi.txt'
    $runtimeProvenancePath = Join-Path $installedPiRuntime 'PROVENANCE.txt'
    $runtimeTreeReceiptPath = Join-Path $installedPiRuntime $trustManifest.archive.treeReceiptFile
    $runtimeExecutablePath = Join-Path $installedPiRuntime $runtime.relativePath
    foreach ($requiredPath in @(
        $runtimeManifestPath,
        $runtimeLicensePath,
        $runtimeProvenancePath,
        $runtimeTreeReceiptPath,
        $runtimeExecutablePath
    )) {
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
            throw "The installed Pi runtime is incomplete: $requiredPath"
        }
    }

    $installedManifestHash = (Get-FileHash -LiteralPath $runtimeManifestPath -Algorithm SHA256).Hash
    $trustedManifestHash = (Get-FileHash -LiteralPath $piTrustManifestPath -Algorithm SHA256).Hash
    $installedLicenseHash = (Get-FileHash -LiteralPath $runtimeLicensePath -Algorithm SHA256).Hash
    $trustedLicenseHash = (Get-FileHash -LiteralPath $piLicensePath -Algorithm SHA256).Hash
    $treeReceiptItem = Get-Item -LiteralPath $runtimeTreeReceiptPath
    $treeReceiptHash = (Get-FileHash -LiteralPath $runtimeTreeReceiptPath -Algorithm SHA256).Hash
    $executableItem = Get-Item -LiteralPath $runtimeExecutablePath
    $executableHash = (Get-FileHash -LiteralPath $runtimeExecutablePath -Algorithm SHA256).Hash
    if ($installedManifestHash -ne $trustedManifestHash -or
        $installedLicenseHash -ne $trustedLicenseHash -or
        $treeReceiptItem.Length -ne [long]$trustManifest.archive.treeReceiptBytes -or
        -not $treeReceiptHash.Equals(
            [string]$trustManifest.archive.treeSha256,
            [System.StringComparison]::OrdinalIgnoreCase) -or
        $executableItem.Length -ne [long]$runtime.sizeBytes -or
        -not $executableHash.Equals(
            [string]$runtime.sha256,
            [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'The installed Pi runtime does not match the repository trust manifest.'
    }

    $receiptBytes = [System.IO.File]::ReadAllBytes($runtimeTreeReceiptPath)
    if ($receiptBytes.Length -eq 0 -or
        $receiptBytes[$receiptBytes.Length - 1] -ne 10 -or
        $receiptBytes -contains 13) {
        throw 'The installed Pi runtime tree receipt is not strict LF-delimited data.'
    }
    $receiptText = [System.Text.UTF8Encoding]::new($false, $true).GetString($receiptBytes)
    $receiptLines = $receiptText.Split("`n")
    $expectedFiles = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase)
    $runtimeRoot = [System.IO.Path]::GetFullPath($installedPiRuntime).TrimEnd('\')
    $runtimePrefix = $runtimeRoot + '\'
    $previousPath = $null
    foreach ($line in $receiptLines[0..($receiptLines.Length - 2)]) {
        if ($line -notmatch '\A([0-9a-f]{64})  (.+)\z') {
            throw 'The installed Pi runtime tree receipt contains a malformed record.'
        }
        $expectedHash = $Matches[1]
        $relativePath = $Matches[2]
        if ($relativePath.Contains('\') -or
            ($null -ne $previousPath -and
                [System.StringComparer]::Ordinal.Compare($previousPath, $relativePath) -ge 0) -or
            -not $expectedFiles.Add($relativePath)) {
            throw 'The installed Pi runtime tree receipt contains an unsafe, duplicate, or unsorted path.'
        }
        $candidate = [System.IO.Path]::GetFullPath((Join-Path $runtimeRoot $relativePath.Replace('/', '\')))
        if (-not $candidate.StartsWith($runtimePrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            throw "The installed Pi runtime tree is missing '$relativePath'."
        }
        $item = Get-Item -LiteralPath $candidate -Force
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or
            -not (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.Equals(
                $expectedHash,
                [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "The installed Pi runtime file '$relativePath' failed integrity verification."
        }
        $previousPath = $relativePath
    }
    if ($expectedFiles.Count -ne [int]$trustManifest.archive.fileCount) {
        throw 'The installed Pi runtime tree receipt has the wrong file count.'
    }

    $ownedFiles = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase)
    foreach ($name in @('runtime.json', 'LICENSE-Pi.txt', 'PROVENANCE.txt', 'RUNTIME-SHA256SUMS.txt')) {
        $null = $ownedFiles.Add($name)
    }
    $pendingDirectories = [System.Collections.Generic.Stack[string]]::new()
    $pendingDirectories.Push($runtimeRoot)
    while ($pendingDirectories.Count -gt 0) {
        $directory = $pendingDirectories.Pop()
        foreach ($item in Get-ChildItem -LiteralPath $directory -Force) {
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "The installed Pi runtime contains a reparse point: $($item.FullName)"
            }
            if ($item.PSIsContainer) {
                $pendingDirectories.Push($item.FullName)
                continue
            }
            $relativePath = $item.FullName.Substring($runtimePrefix.Length).Replace('\', '/')
            if (-not $expectedFiles.Contains($relativePath) -and
                -not $ownedFiles.Contains($relativePath)) {
                throw "The installed Pi runtime contains an unexpected file: $relativePath"
            }
        }
    }
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
    # From this point onward a partially completed installer must be treated as
    # owned test state, even when Setup exits with a non-zero code.
    $cleanupRequired = $true
    Invoke-ProcessChecked -FilePath $InstallerPath -Arguments $installArguments

    $uninstaller = Join-Path $installDirectory 'unins000.exe'
    if (-not (Test-Path -LiteralPath $installedExecutable -PathType Leaf) -or
        -not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
        throw 'The installer completed without the host executable or uninstaller.'
    }
    if ((Get-Item -LiteralPath $installedExecutable).VersionInfo.ProductVersion -ne $Version) {
        throw 'The installed executable version does not match the requested release.'
    }
    Assert-InstalledPiRuntime

    if ((Get-StartupValue) -ne $expectedStartupValue) {
        throw 'The installer did not create the expected current-user startup command.'
    }

    $installLocation = (Get-ItemProperty -LiteralPath $uninstallKey -ErrorAction Stop).InstallLocation
    if ([System.IO.Path]::GetFullPath($installLocation).TrimEnd('\') -ne
        [System.IO.Path]::GetFullPath($installDirectory).TrimEnd('\')) {
        throw 'The uninstall registration does not match the isolated install directory.'
    }

    Write-Host '[2/5] Running the installed host lifecycle probe without creating a desktop window...'
    $safeHostDataRoot = Assert-ChildPath -Path $hostDataRoot -Parent $testRoot
    $safeReceiptPath = Assert-ChildPath -Path $lifecycleReceiptPath -Parent $safeHostDataRoot
    New-Item -ItemType Directory -Path $safeHostDataRoot -Force | Out-Null
    if (Test-Path -LiteralPath $safeReceiptPath) {
        throw "The isolated lifecycle receipt already exists: $safeReceiptPath"
    }

    $lifecycleNonce = [Guid]::NewGuid().ToString('N')
    if ($lifecycleNonce -notmatch '\A[0-9a-f]{32}\z') {
        throw 'Failed to generate a strict lifecycle probe nonce.'
    }

    $probeStartInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $probeStartInfo.FileName = $installedExecutable
    $probeStartInfo.UseShellExecute = $false
    foreach ($argument in @(
        '--lifecycle-probe',
        "--lifecycle-data-root=$safeHostDataRoot",
        "--lifecycle-receipt=$safeReceiptPath",
        "--lifecycle-nonce=$lifecycleNonce"
    )) {
        $probeStartInfo.ArgumentList.Add($argument)
    }

    $hostProcess = [System.Diagnostics.Process]::Start($probeStartInfo)
    if ($null -eq $hostProcess) {
        throw 'Windows did not start the installed lifecycle probe.'
    }
    if (-not $hostProcess.WaitForExit(30000)) {
        Stop-LifecycleProbeProcess -Process $hostProcess
        throw 'The installed lifecycle probe exceeded its 30-second deadline.'
    }
    $probeExitCode = $hostProcess.ExitCode
    if (-not (Test-ProcessHasExited -Process $hostProcess)) {
        throw 'The installed lifecycle probe exit could not be verified.'
    }
    $hostProcess.Dispose()
    $hostProcess = $null
    if ($probeExitCode -ne 0) {
        throw "The installed lifecycle probe exited with code $probeExitCode."
    }
    Assert-LifecycleReceipt -Path $safeReceiptPath -ExpectedNonce $lifecycleNonce

    if (-not $SkipRepair) {
        Write-Host '[3/5] Reinstalling the same release to verify repair/upgrade behavior...'
        $staleRuntimeMarker = Join-Path $installedPiRuntime 'stale-runtime-marker.txt'
        Set-Content -LiteralPath $staleRuntimeMarker -Value 'must be removed by repair' -Encoding ascii
        $piRuntimeManifest = Get-Content -LiteralPath $piTrustManifestPath -Raw | ConvertFrom-Json
        $piEntryPoint = $piRuntimeManifest.executable.relativePath
        $installedPiExecutable = Join-Path $installedPiRuntime $piEntryPoint
        $corruptStream = [System.IO.File]::Open(
            $installedPiExecutable,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None)
        try {
            $corruptStream.SetLength(1)
        }
        finally {
            $corruptStream.Dispose()
        }
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
        if (Test-Path -LiteralPath $staleRuntimeMarker) {
            throw 'Repair/reinstall did not remove a stale Pi runtime file.'
        }
        Assert-InstalledPiRuntime
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

    for ($attempt = 0; $attempt -lt 100 -and (Test-Path -LiteralPath $installDirectory); $attempt++) {
        Start-Sleep -Milliseconds 100
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
    if (Test-Path -LiteralPath $installedPiRuntime) {
        throw 'The private Pi runtime remains after uninstall.'
    }
    if (Test-Path -LiteralPath $installDirectory) {
        throw 'The isolated JARVIS install directory remains after uninstall.'
    }

    # Do not clear this marker until every installer-owned residual check above
    # has passed. A later failure must not suppress rollback of a partial install.
    $cleanupRequired = $false

    Write-Host '[5/5] Confirming Windows recovery state...'
    $explorerCountAfter = @(Get-Process explorer -ErrorAction SilentlyContinue).Count
    $jarvisProcessesAfter = @(Get-Process 'Jarvis.Host' -ErrorAction SilentlyContinue).Count
    if ($explorerCountAfter -eq 0 -or $jarvisProcessesAfter -ne 0) {
        throw 'Windows recovery state is invalid after lifecycle verification.'
    }

    [pscustomobject]@{
        Version = $Version
        Install = 'passed'
        LifecycleProbe = 'passed'
        Repair = if ($SkipRepair) { 'skipped' } else { 'passed' }
        Uninstall = 'passed'
        StartupCleanup = 'passed'
        PiRuntimeLifecycle = 'passed'
        ExplorerProcessesBefore = $explorerCountBefore
        ExplorerProcessesAfter = $explorerCountAfter
        JarvisProcessesAfter = $jarvisProcessesAfter
    } | ConvertTo-Json
}
finally {
    $cleanupFailures = [System.Collections.Generic.List[string]]::new()

    if ($null -ne $hostProcess) {
        try {
            Stop-LifecycleProbeProcess -Process $hostProcess
            if (-not (Test-ProcessHasExited -Process $hostProcess)) {
                throw "Lifecycle probe process $($hostProcess.Id) is still running."
            }
        }
        catch {
            $cleanupFailures.Add($_.Exception.Message)
        }
        finally {
            try {
                $hostProcess.Dispose()
            }
            catch {
                $cleanupFailures.Add("Failed to release the lifecycle probe handle: $($_.Exception.Message)")
            }
            $hostProcess = $null
        }
    }

    $uninstaller = Join-Path $installDirectory 'unins000.exe'
    if ($cleanupRequired -and (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
        try {
            Invoke-ProcessChecked -FilePath $uninstaller -Arguments @(
                '/VERYSILENT',
                '/SUPPRESSMSGBOXES',
                '/NORESTART'
            )
        }
        catch {
            $cleanupFailures.Add("Fallback uninstall failed: $($_.Exception.Message)")
        }
    }

    try {
        $startupValueAfterTest = Get-StartupValue
        if ($startupValueAfterTest -eq $expectedStartupValue) {
            Remove-ItemProperty `
                -LiteralPath $startupKey `
                -Name $startupValueName `
                -ErrorAction Stop
            if ((Get-StartupValue) -eq $expectedStartupValue) {
                throw 'The test startup registration remains after removal.'
            }
        }
        elseif (-not [string]::IsNullOrWhiteSpace($startupValueAfterTest)) {
            $cleanupFailures.Add(
                'A non-test JARVIS startup value appeared during lifecycle verification; it was not modified.')
        }
    }
    catch {
        $cleanupFailures.Add("Failed to clean the test startup registration: $($_.Exception.Message)")
    }

    try {
        if (Test-Path -LiteralPath $uninstallKey) {
            $testUninstallRecord = Get-ItemProperty -LiteralPath $uninstallKey -ErrorAction Stop
            $installLocationProperty = $testUninstallRecord.PSObject.Properties['InstallLocation']
            if ($null -ne $installLocationProperty -and
                (Test-PathsEqual -Left $installLocationProperty.Value -Right $installDirectory)) {
                Remove-Item -LiteralPath $uninstallKey -Recurse -Force -ErrorAction Stop
                if (Test-Path -LiteralPath $uninstallKey) {
                    throw 'The test uninstall registration remains after removal.'
                }
            }
            else {
                $cleanupFailures.Add(
                    'A non-test JARVIS uninstall registration appeared during lifecycle verification; it was not modified.')
            }
        }
    }
    catch {
        $cleanupFailures.Add("Failed to clean the test uninstall registration: $($_.Exception.Message)")
    }

    try {
        if (Test-Path -LiteralPath $testRoot) {
            $safeTestRoot = Assert-ChildPath -Path $testRoot -Parent $lifecycleRoot
            Remove-Item -LiteralPath $safeTestRoot -Recurse -Force -ErrorAction Stop
        }
        if (Test-Path -LiteralPath $testRoot) {
            throw "The isolated lifecycle test root remains: $testRoot"
        }
    }
    catch {
        $cleanupFailures.Add("Failed to remove isolated lifecycle files: $($_.Exception.Message)")
    }

    try {
        if ((Test-Path -LiteralPath $lifecycleRoot) -and
            (Get-ChildItem -LiteralPath $lifecycleRoot -Force | Measure-Object).Count -eq 0) {
            Remove-Item -LiteralPath $lifecycleRoot -Force -ErrorAction Stop
        }
    }
    catch {
        $cleanupFailures.Add("Failed to remove the empty lifecycle root: $($_.Exception.Message)")
    }

    if ($cleanupFailures.Count -gt 0) {
        throw "Lifecycle cleanup was incomplete: $($cleanupFailures -join ' | ')"
    }
}
