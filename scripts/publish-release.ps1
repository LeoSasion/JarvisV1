[CmdletBinding()]
param(
    [ValidatePattern('^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$')]
    [string]$Version = '0.1.0',

    [ValidateSet('win-x64')]
    [string]$Runtime = 'win-x64',

    [switch]$SkipInstaller,

    [switch]$SkipNodeInstall,

    [switch]$OfflinePiRuntime,

    [string]$PiRuntimeArchivePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$frontendRoot = Join-Path $repositoryRoot 'frontend'
$frontendDist = Join-Path $frontendRoot 'dist'
$projectPath = Join-Path $repositoryRoot 'host\Jarvis.Host\Jarvis.Host.csproj'
$artifactsRoot = Join-Path $repositoryRoot 'artifacts'
$frontendBuildRoot = Join-Path $artifactsRoot 'build\frontend'
$piRuntimeBuildRoot = Join-Path $artifactsRoot 'build\pi-runtime'
$releaseRoot = Join-Path $artifactsRoot 'release'
$installerOutput = Join-Path $artifactsRoot 'installer'
$packageName = "JARVIS-$Version-$Runtime"
$publishDirectory = Join-Path $releaseRoot $packageName
$zipPath = Join-Path $releaseRoot "$packageName.zip"
$installerScript = Join-Path $repositoryRoot 'installer\JARVIS.iss'
$installerPath = Join-Path $installerOutput "JARVIS-Setup-$Version-win-x64.exe"
$updateManifestPath = Join-Path $releaseRoot 'JARVIS-update-manifest.json'
$piManifestPath = Join-Path $repositoryRoot 'third_party\pi\runtime.json'
$piStagerPath = Join-Path $repositoryRoot 'scripts\stage-pi-runtime.ps1'
$numericVersion = ($Version -split '[-+]')[0]
$builtAtUtc = [DateTimeOffset]::UtcNow.ToString('O')

function Assert-ChildPath {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [string]$Parent
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $fullParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    if (-not $fullPath.StartsWith($fullParent, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside the expected release root: $fullPath"
    }

    return $fullPath
}

function Reset-ChildDirectory {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [string]$Parent
    )

    $safePath = Assert-ChildPath -Path $Path -Parent $Parent
    if (Test-Path -LiteralPath $safePath) {
        Remove-Item -LiteralPath $safePath -Recurse -Force
    }
    New-Item -ItemType Directory -Path $safePath -Force | Out-Null
    return $safePath
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory)] [string]$FilePath,
        [Parameter(Mandatory)] [string[]]$Arguments,
        [Parameter(Mandatory)] [string]$WorkingDirectory
    )

    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$FilePath exited with code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

if (-not (Test-Path -LiteralPath $projectPath)) {
    throw "JARVIS host project was not found: $projectPath"
}
if (-not (Test-Path -LiteralPath $piManifestPath -PathType Leaf)) {
    throw "The pinned Pi runtime manifest was not found: $piManifestPath"
}
if (-not (Test-Path -LiteralPath $piStagerPath -PathType Leaf)) {
    throw "The fail-closed Pi runtime stager was not found: $piStagerPath"
}

$piManifest = Get-Content -LiteralPath $piManifestPath -Raw | ConvertFrom-Json
if (-not ([string]$piManifest.runtime).Equals($Runtime, [System.StringComparison]::Ordinal)) {
    throw "The Pi runtime manifest does not match release runtime '$Runtime'."
}
$piArchive = $piManifest.archive
$piExecutable = $piManifest.executable

Write-Host "[1/8] Verifying and staging pinned Pi Agent runtime..."
$piStageArguments = @{
    ManifestPath = $piManifestPath
    Runtime = $Runtime
    Destination = $piRuntimeBuildRoot
}
if ($OfflinePiRuntime) {
    $piStageArguments['Offline'] = $true
}
if (-not [string]::IsNullOrWhiteSpace($PiRuntimeArchivePath)) {
    $piStageArguments['ArchivePath'] = $PiRuntimeArchivePath
}
& $piStagerPath @piStageArguments | Out-Host

$stagedPiExecutable = Join-Path $piRuntimeBuildRoot $piExecutable.relativePath
$stagedPiManifest = Join-Path $piRuntimeBuildRoot 'runtime.json'
$stagedPiLicense = Join-Path $piRuntimeBuildRoot 'LICENSE-Pi.txt'
$stagedPiTreeReceipt = Join-Path $piRuntimeBuildRoot 'RUNTIME-SHA256SUMS.txt'
if (-not (Test-Path -LiteralPath $stagedPiExecutable -PathType Leaf) -or
    -not (Test-Path -LiteralPath $stagedPiManifest -PathType Leaf) -or
    -not (Test-Path -LiteralPath $stagedPiLicense -PathType Leaf) -or
    -not (Test-Path -LiteralPath $stagedPiTreeReceipt -PathType Leaf)) {
    throw 'Pi runtime staging completed without the executable, trust manifest, tree receipt, or license.'
}

$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$dotnet = (Get-Command dotnet.exe -ErrorAction Stop).Source

Write-Host "[2/8] Building clean frontend assets..."
$nodeInstallArguments = @('ci', '--prefer-offline', '--no-audit')
if ($SkipNodeInstall) {
    Write-Warning 'Locked npm install was skipped by request; existing node_modules will be used.'
    $frontendDist = Reset-ChildDirectory -Path $frontendDist -Parent $frontendRoot
    Invoke-Checked -FilePath $npm -Arguments @('run', 'build') -WorkingDirectory $frontendRoot
}
else {
    New-Item -ItemType Directory -Path $artifactsRoot -Force | Out-Null
    $frontendBuildRoot = Reset-ChildDirectory -Path $frontendBuildRoot -Parent $artifactsRoot
    foreach ($buildInput in @(
        '.npmrc',
        'package.json',
        'package-lock.json',
        'index.html',
        'vite.config.mjs',
        'src',
        'public'
    )) {
        $source = Join-Path $frontendRoot $buildInput
        if (-not (Test-Path -LiteralPath $source)) {
            throw "Frontend build input is missing: $source"
        }
        Copy-Item -LiteralPath $source -Destination $frontendBuildRoot -Recurse -Force
    }

    Invoke-Checked -FilePath $npm -Arguments $nodeInstallArguments -WorkingDirectory $frontendBuildRoot
    Invoke-Checked -FilePath $npm -Arguments @('run', 'build') -WorkingDirectory $frontendBuildRoot

    $stagedFrontendDist = Join-Path $frontendBuildRoot 'dist'
    if (-not (Test-Path -LiteralPath (Join-Path $stagedFrontendDist 'index.html'))) {
        throw 'Staged frontend build completed without dist\index.html.'
    }
    $frontendDist = Reset-ChildDirectory -Path $frontendDist -Parent $frontendRoot
    Copy-Item -Path (Join-Path $stagedFrontendDist '*') -Destination $frontendDist -Recurse -Force
    Remove-Item -LiteralPath (Assert-ChildPath -Path $frontendBuildRoot -Parent $artifactsRoot) -Recurse -Force
    $buildRoot = Split-Path -Parent $frontendBuildRoot
    if ((Get-ChildItem -LiteralPath $buildRoot -Force | Measure-Object).Count -eq 0) {
        Remove-Item -LiteralPath (Assert-ChildPath -Path $buildRoot -Parent $artifactsRoot) -Force
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $frontendDist 'index.html'))) {
    throw 'Frontend build completed without dist\index.html.'
}

Write-Host "[3/8] Publishing self-contained Windows host..."
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
$publishDirectory = Reset-ChildDirectory -Path $publishDirectory -Parent $releaseRoot
Invoke-Checked -FilePath $dotnet -Arguments @(
    'restore',
    $projectPath,
    '--runtime', $Runtime,
    '--locked-mode',
    '--ignore-failed-sources',
    '-p:NuGetAudit=false'
) -WorkingDirectory $repositoryRoot
Invoke-Checked -FilePath $dotnet -Arguments @(
    'publish',
    $projectPath,
    '--no-restore',
    '--configuration', 'Release',
    '--runtime', $Runtime,
    '--self-contained', 'true',
    '--output', $publishDirectory,
    "-p:Version=$Version",
    "-p:FileVersion=$numericVersion.0",
    "-p:AssemblyVersion=$numericVersion.0",
    "-p:InformationalVersion=$Version",
    '-p:IncludeSourceRevisionInInformationalVersion=false',
    '-p:DebugType=None',
    '-p:DebugSymbols=false',
    '-p:PublishSingleFile=false'
) -WorkingDirectory $repositoryRoot

$hostExecutable = Join-Path $publishDirectory 'Jarvis.Host.exe'
$packagedFrontend = Join-Path $publishDirectory 'frontend\index.html'
if (-not (Test-Path -LiteralPath $hostExecutable) -or
    -not (Test-Path -LiteralPath $packagedFrontend)) {
    throw 'Release publish is incomplete: host executable or frontend entry point is missing.'
}

$packagedPiRuntime = Join-Path $publishDirectory 'AgentRuntime'
New-Item -ItemType Directory -Path $packagedPiRuntime -Force | Out-Null
Copy-Item -Path (Join-Path $piRuntimeBuildRoot '*') -Destination $packagedPiRuntime -Recurse -Force
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'LICENSE') -Destination $publishDirectory -Force
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'THIRD_PARTY_NOTICES.md') -Destination $publishDirectory -Force

Write-Host "[4/8] Writing version and recovery notes..."
$versionPayload = [ordered]@{
    product = 'JARVIS'
    version = $Version
    runtime = $Runtime
    configuration = 'Release'
    selfContained = $true
    builtAtUtc = $builtAtUtc
    releaseChannel = 'manual'
    executable = 'Jarvis.Host.exe'
    startupArgument = '--startup'
    safeModeEnvironment = 'JARVIS_KEEP_NATIVE_TASKBAR=1'
    minimumWindows = '10'
    requiresWebView2Evergreen = $true
    agentRuntime = [ordered]@{
        bundled = $true
        component = $piManifest.id
        version = $piManifest.version
        runtime = $Runtime
        sourceCommit = $piManifest.source.commit
        entryPoint = "AgentRuntime/$($piExecutable.relativePath)"
        executableSha256 = $piExecutable.sha256
        runtimeTreeSha256 = $piArchive.treeSha256
        permissionMode = $piManifest.policies.permissionMode
        autoUpdate = $false
        startupOffline = $true
        authenticity = 'repository-pinned-sha256; upstream-unsigned'
    }
}
$versionPayload | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $publishDirectory 'version.json') -Encoding utf8

@"
JARVIS

Run Jarvis.Host.exe to start JARVIS.
Use Ctrl+Shift+Q from any normal Windows app to restore the Windows desktop and exit safely.
Alt+F4 is also available while the JARVIS desktop window itself has focus.

Recovery launch:
  Set JARVIS_KEEP_NATIVE_TASKBAR=1 before starting Jarvis.Host.exe.

The release is self-contained for .NET. Microsoft Edge WebView2 Evergreen Runtime
must be installed. JARVIS checks this before changing the desktop or taskbar.

Pi Agent $($piManifest.version) is delivered as a private, pinned runtime under AgentRuntime.
JARVIS starts it lazily in chat-only mode, does not add it to PATH, and never
updates it independently. The host verifies its repository-pinned SHA-256 before launch.
The upstream release is not code-signed; see THIRD_PARTY_NOTICES.md and
AgentRuntime\PROVENANCE.txt for the exact trust boundary.
"@ | Set-Content -LiteralPath (Join-Path $publishDirectory 'RECOVERY.txt') -Encoding utf8

Write-Host "[5/8] Generating package checksums..."
$checksumPath = Join-Path $publishDirectory 'SHA256SUMS.txt'
$checksumLines = Get-ChildItem -LiteralPath $publishDirectory -File -Recurse |
    Where-Object FullName -ne $checksumPath |
    Sort-Object FullName |
    ForEach-Object {
        $relativePath = $_.FullName.Substring($publishDirectory.Length).TrimStart('\').Replace('\', '/')
        $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $relativePath"
    }
$checksumLines | Set-Content -LiteralPath $checksumPath -Encoding ascii

Write-Host "[6/8] Creating portable ZIP..."
if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath (Assert-ChildPath -Path $zipPath -Parent $releaseRoot) -Force
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $publishDirectory,
    $zipPath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false)

$installerStatus = 'skipped'
if (-not $SkipInstaller) {
    Write-Host "[7/8] Looking for Inno Setup compiler..."
    $compilerCandidates = @(
        (Get-Command iscc.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1),
        (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
        'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
        'C:\Program Files\Inno Setup 6\ISCC.exe'
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

    $compiler = $compilerCandidates | Select-Object -First 1
    if ($compiler) {
        New-Item -ItemType Directory -Path $installerOutput -Force | Out-Null
        Invoke-Checked -FilePath $compiler -Arguments @(
            "/DMyAppVersion=$Version",
            "/DMyNumericVersion=$numericVersion",
            "/DSourceDir=$publishDirectory",
            "/DOutputDir=$installerOutput",
            $installerScript
        ) -WorkingDirectory $repositoryRoot
        if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
            throw "Inno Setup exited successfully without producing the expected installer: $installerPath"
        }
        $installerStatus = 'built'
    }
    else {
        $installerStatus = 'compiler-not-installed'
        Write-Warning 'Inno Setup 6 was not found. The portable release is complete; install Inno Setup and rerun this script to emit the setup EXE.'
    }
}

Write-Host "[8/8] Writing update-channel manifest..."
$installerPackage = if ($installerStatus -eq 'built' -and (Test-Path -LiteralPath $installerPath)) {
    $item = Get-Item -LiteralPath $installerPath
    [ordered]@{
        fileName = $item.Name
        sizeBytes = $item.Length
        sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}
else {
    $null
}
$portableItem = Get-Item -LiteralPath $zipPath
$updateManifest = [ordered]@{
    schemaVersion = 1
    product = 'JARVIS'
    version = $Version
    runtime = $Runtime
    releaseChannel = 'manual'
    publishedAtUtc = $builtAtUtc
    minimumWindows = '10'
    requiresWebView2Evergreen = $true
    components = [ordered]@{
        piAgent = [ordered]@{
            bundled = $true
            version = $piManifest.version
            releaseTag = $piManifest.release.tag
            sourceCommit = $piManifest.source.commit
            releaseUrl = $piManifest.release.url
            sourceArchiveUrl = $piManifest.sourceArchive.url
            sourceArchiveSha256 = $piManifest.sourceArchive.sha256
            upstreamChecksumsUrl = $piManifest.release.checksumsUrl
            upstreamChecksumsSha256 = $piManifest.release.checksumsSha256
            runtime = $Runtime
            archiveSha256 = $piArchive.sha256
            executableSha256 = $piExecutable.sha256
            runtimeTreeSha256 = $piArchive.treeSha256
            license = $piManifest.license.spdx
            permissionMode = $piManifest.policies.permissionMode
            autoUpdate = $false
            startupOffline = $true
            upstreamAuthenticode = $piExecutable.authenticode
        }
    }
    packages = [ordered]@{
        installer = $installerPackage
        portable = [ordered]@{
            fileName = $portableItem.Name
            sizeBytes = $portableItem.Length
            sha256 = (Get-FileHash -LiteralPath $portableItem.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
}
$updateManifest | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath $updateManifestPath -Encoding utf8

if (Test-Path -LiteralPath $piRuntimeBuildRoot) {
    Remove-Item -LiteralPath (Assert-ChildPath -Path $piRuntimeBuildRoot -Parent $artifactsRoot) -Recurse -Force
}

[pscustomobject]@{
    Product = 'JARVIS'
    Version = $Version
    Runtime = $Runtime
    PublishDirectory = $publishDirectory
    PortableZip = $zipPath
    Installer = $installerStatus
    UpdateManifest = $updateManifestPath
    PiAgentVersion = $piManifest.version
    PiAgentExecutableSha256 = $piExecutable.sha256
    ExecutableSha256 = (Get-FileHash -LiteralPath $hostExecutable -Algorithm SHA256).Hash
} | ConvertTo-Json -Depth 3
