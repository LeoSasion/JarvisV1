[CmdletBinding()]
param(
    [string]$ArchivePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stageScript = Join-Path $PSScriptRoot 'stage-pi-runtime.ps1'
$sourceManifestPath = Join-Path $repositoryRoot 'third_party\pi\runtime.json'
$sourceLicensePath = Join-Path $repositoryRoot 'third_party\pi\LICENSE-Pi.txt'
$testParent = Join-Path $repositoryRoot 'tmp\pi-runtime-staging-tests'
$testRoot = Join-Path $testParent ([System.Guid]::NewGuid().ToString('N'))

function Get-Sha256Hex {
    param(
        [Parameter(Mandatory)] [string]$Path
    )

    $stream = [System.IO.File]::Open(
        $Path,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::Read)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha256.ComputeHash($stream)
        return ([System.BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}

function Assert-True {
    param(
        [Parameter(Mandatory)] [bool]$Condition,
        [Parameter(Mandatory)] [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function ConvertFrom-JsonPreservingDates {
    param(
        [Parameter(Mandatory)] [string]$Json
    )

    $command = Get-Command ConvertFrom-Json
    if ($command.Parameters.ContainsKey('DateKind')) {
        return $Json | ConvertFrom-Json -DateKind String
    }
    return $Json | ConvertFrom-Json
}

function Invoke-ExpectedFailure {
    param(
        [Parameter(Mandatory)] [scriptblock]$Action,
        [Parameter(Mandatory)] [string]$Pattern,
        [Parameter(Mandatory)] [string]$Label
    )

    try {
        & $Action
    }
    catch {
        if ($_.Exception.Message -notmatch $Pattern) {
            throw "$Label failed for the wrong reason: $($_.Exception.Message)"
        }
        return
    }
    throw "$Label unexpectedly succeeded."
}

function Add-ZipEntry {
    param(
        [Parameter(Mandatory)] [System.IO.Compression.ZipArchive]$Archive,
        [Parameter(Mandatory)] [string]$Name,
        [byte[]]$Content = @(),
        [AllowNull()] [object]$ExternalAttributes
    )

    $entry = $Archive.CreateEntry($Name, [System.IO.Compression.CompressionLevel]::Optimal)
    if ($null -ne $ExternalAttributes) {
        $entry.ExternalAttributes = [int]$ExternalAttributes
    }
    $stream = $entry.Open()
    try {
        if ($Content.Length -gt 0) {
            $stream.Write($Content, 0, $Content.Length)
        }
    }
    finally {
        $stream.Dispose()
    }
}

function New-TestZip {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [object[]]$Entries
    )

    $archive = [System.IO.Compression.ZipFile]::Open(
        $Path,
        [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($entry in $Entries) {
            $parameters = @{
                Archive = $archive
                Name = $entry.Name
                Content = [System.Text.Encoding]::UTF8.GetBytes([string]$entry.Content)
            }
            if ($entry.PSObject.Properties.Name -contains 'ExternalAttributes') {
                $parameters.ExternalAttributes = [int]$entry.ExternalAttributes
            }
            Add-ZipEntry @parameters
        }
    }
    finally {
        $archive.Dispose()
    }
}

function New-TestManifest {
    param(
        [Parameter(Mandatory)] [string]$Archive,
        [Parameter(Mandatory)] [string]$Directory
    )

    [System.IO.Directory]::CreateDirectory($Directory) | Out-Null
    [System.IO.File]::Copy($sourceLicensePath, (Join-Path $Directory 'LICENSE-Pi.txt'), $false)
    $manifest = ConvertFrom-JsonPreservingDates -Json ([System.IO.File]::ReadAllText($sourceManifestPath))
    $archiveItem = Get-Item -LiteralPath $Archive
    $zip = [System.IO.Compression.ZipFile]::OpenRead($archiveItem.FullName)
    try {
        [long]$uncompressedBytes = 0
        [long]$fileCount = 0
        foreach ($entry in $zip.Entries) {
            $uncompressedBytes += [long]$entry.Length
            if (-not $entry.FullName.EndsWith('/', [System.StringComparison]::Ordinal)) {
                $fileCount++
            }
        }
        $manifest.archive.sizeBytes = [long]$archiveItem.Length
        $manifest.archive.sha256 = Get-Sha256Hex -Path $archiveItem.FullName
        $manifest.archive.entryCount = [long]$zip.Entries.Count
        $manifest.archive.fileCount = $fileCount
        $manifest.archive.uncompressedBytes = $uncompressedBytes
    }
    finally {
        $zip.Dispose()
    }
    $manifestPath = Join-Path $Directory 'runtime.json'
    $json = $manifest | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText(
        $manifestPath,
        $json + "`n",
        [System.Text.UTF8Encoding]::new($false))
    return $manifestPath
}

if ([string]::IsNullOrWhiteSpace($ArchivePath)) {
    $ArchivePath = Join-Path $repositoryRoot 'artifacts\vendor\pi\0.83.0\pi-windows-x64.zip'
}
elseif (-not [System.IO.Path]::IsPathRooted($ArchivePath)) {
    $ArchivePath = Join-Path $repositoryRoot $ArchivePath
}
$ArchivePath = [System.IO.Path]::GetFullPath($ArchivePath)

if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
    [pscustomobject]@{
        Status = 'skipped'
        Reason = 'The ignored pinned Pi archive is not available.'
        ArchivePath = $ArchivePath
    }
    return
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Directory]::CreateDirectory($testRoot) | Out-Null
$passed = [System.Collections.Generic.List[string]]::new()
try {
    $manifest = ConvertFrom-JsonPreservingDates -Json ([System.IO.File]::ReadAllText($sourceManifestPath))
    $destination = Join-Path $testRoot 'AgentRuntime'

    $result = & $stageScript `
        -Runtime 'win-x64' `
        -Destination $destination `
        -ArchivePath $ArchivePath `
        -CacheDirectory '' `
        -Offline
    Assert-True ($result.Version -eq $manifest.version) 'Staging result did not report the pinned Pi version.'
    Assert-True (Test-Path -LiteralPath (Join-Path $destination 'pi.exe') -PathType Leaf) 'Staged pi.exe is missing.'
    Assert-True (Test-Path -LiteralPath (Join-Path $destination 'runtime.json') -PathType Leaf) 'Staged runtime.json is missing.'
    Assert-True (Test-Path -LiteralPath (Join-Path $destination 'LICENSE-Pi.txt') -PathType Leaf) 'Staged Pi license is missing.'
    Assert-True (Test-Path -LiteralPath (Join-Path $destination 'PROVENANCE.txt') -PathType Leaf) 'Staged provenance is missing.'
    $treeReceiptPath = Join-Path $destination $manifest.archive.treeReceiptFile
    Assert-True (Test-Path -LiteralPath $treeReceiptPath -PathType Leaf) 'Staged runtime tree receipt is missing.'
    Assert-True (Test-Path -LiteralPath (Join-Path $destination 'docs\rpc.md') -PathType Leaf) 'Full archive extraction omitted docs/rpc.md.'
    Assert-True (Test-Path -LiteralPath (Join-Path $destination 'package.json') -PathType Leaf) 'Full archive extraction omitted package.json.'
    Assert-True (
        (Get-Sha256Hex -Path (Join-Path $destination 'pi.exe')) -eq $manifest.executable.sha256) `
        'Staged pi.exe hash does not match the pinned receipt.'
    Assert-True ((Get-Item -LiteralPath $treeReceiptPath).Length -eq $manifest.archive.treeReceiptBytes) `
        'Runtime tree receipt byte length does not match the manifest.'
    Assert-True ((Get-Sha256Hex -Path $treeReceiptPath) -eq $manifest.archive.treeSha256) `
        'Runtime tree receipt hash does not match the manifest.'
    Assert-True (@([System.IO.File]::ReadLines($treeReceiptPath)).Count -eq $manifest.archive.fileCount) `
        'Runtime tree receipt does not contain one line per upstream file.'
    $passed.Add('verified full-archive offline staging')

    if ([System.IO.Path]::GetFileName($ArchivePath) -eq $manifest.archive.fileName) {
        $cacheDestination = Join-Path $testRoot 'AgentRuntimeFromCache'
        $cacheResult = & $stageScript `
            -Runtime 'win-x64' `
            -Destination $cacheDestination `
            -CacheDirectory ([System.IO.Path]::GetDirectoryName($ArchivePath)) `
            -Offline
        Assert-True ($cacheResult.Acquisition -eq 'verified-cache') 'Offline cache staging did not report a verified-cache receipt.'
        Assert-True (
            (Get-Sha256Hex -Path (Join-Path $cacheDestination 'pi.exe')) -eq $manifest.executable.sha256) `
            'Offline cache staging produced the wrong executable.'
        $passed.Add('verified optional offline cache staging')
    }

    $missingCacheDestination = Join-Path $testRoot 'MissingCacheDestination'
    Invoke-ExpectedFailure `
        -Label 'Offline cache-miss test' `
        -Pattern 'unavailable in offline mode' `
        -Action {
            & $stageScript `
                -Runtime 'win-x64' `
                -Destination $missingCacheDestination `
                -CacheDirectory '' `
                -Offline | Out-Null
        }
    Assert-True (-not (Test-Path -LiteralPath $missingCacheDestination)) 'Offline cache miss created a destination.'
    $passed.Add('offline cache miss failed without network access')

    $stalePath = Join-Path $destination 'stale.test'
    [System.IO.File]::WriteAllText($stalePath, 'remove me')
    $null = & $stageScript `
        -Runtime 'win-x64' `
        -Destination $destination `
        -ArchivePath $ArchivePath `
        -CacheDirectory '' `
        -Offline
    Assert-True (-not (Test-Path -LiteralPath $stalePath)) 'Atomic replacement retained a stale destination file.'
    $passed.Add('atomic managed-destination replacement')

    $preservePath = Join-Path $destination 'preserve-on-failure.test'
    [System.IO.File]::WriteAllText($preservePath, 'preserve me')
    $corruptArchive = Join-Path $testRoot 'corrupt.zip'
    [System.IO.File]::Copy($ArchivePath, $corruptArchive, $false)
    $corruptStream = [System.IO.File]::Open($corruptArchive, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite)
    try {
        $corruptStream.Position = [System.Math]::Max(0, $corruptStream.Length - 1)
        $value = $corruptStream.ReadByte()
        $corruptStream.Position = [System.Math]::Max(0, $corruptStream.Length - 1)
        $corruptStream.WriteByte([byte]($value -bxor 0x5A))
    }
    finally {
        $corruptStream.Dispose()
    }
    Invoke-ExpectedFailure `
        -Label 'Corrupt archive test' `
        -Pattern 'SHA-256 mismatch' `
        -Action {
            & $stageScript `
                -Runtime 'win-x64' `
                -Destination $destination `
                -ArchivePath $corruptArchive `
                -CacheDirectory '' `
                -Offline | Out-Null
        }
    Assert-True (Test-Path -LiteralPath $preservePath -PathType Leaf) 'Failed staging modified the existing destination.'
    $passed.Add('corrupt archive rejected before replacement')

    $strictManifestDirectory = Join-Path $testRoot 'strict-manifest'
    [System.IO.Directory]::CreateDirectory($strictManifestDirectory) | Out-Null
    [System.IO.File]::Copy($sourceLicensePath, (Join-Path $strictManifestDirectory 'LICENSE-Pi.txt'), $false)
    $strictManifest = ConvertFrom-JsonPreservingDates -Json ([System.IO.File]::ReadAllText($sourceManifestPath))
    $strictManifest | Add-Member -NotePropertyName 'unexpected' -NotePropertyValue 'reject me'
    $strictManifestPath = Join-Path $strictManifestDirectory 'runtime.json'
    [System.IO.File]::WriteAllText(
        $strictManifestPath,
        ($strictManifest | ConvertTo-Json -Depth 10) + "`n",
        [System.Text.UTF8Encoding]::new($false))
    Invoke-ExpectedFailure `
        -Label 'Strict manifest shape test' `
        -Pattern 'unsupported property' `
        -Action {
            & $stageScript `
                -Runtime 'win-x64' `
                -Destination (Join-Path $strictManifestDirectory 'AgentRuntime') `
                -ManifestPath $strictManifestPath `
                -ArchivePath $ArchivePath `
                -CacheDirectory '' `
                -Offline | Out-Null
        }
    $passed.Add('strict manifest rejected unknown fields')

    $licenseManifestDirectory = Join-Path $testRoot 'license-mismatch'
    [System.IO.Directory]::CreateDirectory($licenseManifestDirectory) | Out-Null
    [System.IO.File]::Copy($sourceManifestPath, (Join-Path $licenseManifestDirectory 'runtime.json'), $false)
    [System.IO.File]::WriteAllText(
        (Join-Path $licenseManifestDirectory 'LICENSE-Pi.txt'),
        'tampered license',
        [System.Text.UTF8Encoding]::new($false))
    Invoke-ExpectedFailure `
        -Label 'License receipt test' `
        -Pattern 'license SHA-256 mismatch' `
        -Action {
            & $stageScript `
                -Runtime 'win-x64' `
                -Destination (Join-Path $licenseManifestDirectory 'AgentRuntime') `
                -ManifestPath (Join-Path $licenseManifestDirectory 'runtime.json') `
                -ArchivePath $ArchivePath `
                -CacheDirectory '' `
                -Offline | Out-Null
        }
    $passed.Add('tampered license rejected before extraction')

    $outsideEscape = Join-Path $testRoot 'escape.txt'
    $symlinkAttributes = [System.BitConverter]::ToInt32(
        [System.BitConverter]::GetBytes([System.Convert]::ToUInt32('A1FF0000', 16)),
        0)
    $maliciousCases = @(
        [pscustomobject]@{
            Name = 'zip-slip'
            Pattern = 'unsafe or absolute path|unsafe Windows path segment'
            Entries = @([pscustomobject]@{ Name = '../escape.txt'; Content = 'escape' })
        },
        [pscustomobject]@{
            Name = 'absolute-path'
            Pattern = 'unsafe or absolute path'
            Entries = @([pscustomobject]@{ Name = 'C:/escape.txt'; Content = 'escape' })
        },
        [pscustomobject]@{
            Name = 'duplicate-path'
            Pattern = 'duplicate path'
            Entries = @(
                [pscustomobject]@{ Name = 'duplicate.txt'; Content = 'one' },
                [pscustomobject]@{ Name = 'DUPLICATE.txt'; Content = 'two' }
            )
        },
        [pscustomobject]@{
            Name = 'symlink-entry'
            Pattern = 'symbolic link or reparse point'
            Entries = @([pscustomobject]@{
                Name = 'link'
                Content = 'target'
                ExternalAttributes = $symlinkAttributes
            })
        },
        [pscustomobject]@{
            Name = 'credential-state'
            Pattern = 'credential or mutable-state file'
            Entries = @([pscustomobject]@{ Name = 'nested/.env'; Content = 'secret=value' })
        }
    )

    foreach ($case in $maliciousCases) {
        $caseDirectory = Join-Path $testRoot $case.Name
        [System.IO.Directory]::CreateDirectory($caseDirectory) | Out-Null
        $caseArchive = Join-Path $caseDirectory 'malicious.zip'
        New-TestZip -Path $caseArchive -Entries $case.Entries
        $caseManifestDirectory = Join-Path $caseDirectory 'manifest'
        $caseManifest = New-TestManifest -Archive $caseArchive -Directory $caseManifestDirectory
        $caseDestination = Join-Path $caseDirectory 'AgentRuntime'
        Invoke-ExpectedFailure `
            -Label "$($case.Name) archive test" `
            -Pattern $case.Pattern `
            -Action {
                & $stageScript `
                    -Runtime 'win-x64' `
                    -Destination $caseDestination `
                    -ManifestPath $caseManifest `
                    -ArchivePath $caseArchive `
                    -CacheDirectory '' `
                    -Offline | Out-Null
            }
        Assert-True (-not (Test-Path -LiteralPath $caseDestination)) "$($case.Name) archive created a destination."
        Assert-True (-not (Test-Path -LiteralPath $outsideEscape)) "$($case.Name) archive wrote outside staging."
        $passed.Add("rejected $($case.Name) archive")
    }

    [pscustomobject]@{
        Status = 'passed'
        Tests = $passed.Count
        Receipts = @($passed)
        ArchivePath = $ArchivePath
        ArchiveSha256 = Get-Sha256Hex -Path $ArchivePath
        ExecutableWasRun = $false
    }
}
finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
    if ((Test-Path -LiteralPath $testParent) -and
        (Get-ChildItem -LiteralPath $testParent -Force | Measure-Object).Count -eq 0) {
        Remove-Item -LiteralPath $testParent -Force
    }
}
