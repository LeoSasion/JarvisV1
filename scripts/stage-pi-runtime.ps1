[CmdletBinding()]
param(
    [ValidateSet('win-x64')]
    [string]$Runtime = 'win-x64',

    [string]$Destination,

    [string]$ManifestPath,

    [AllowEmptyString()]
    [string]$CacheDirectory,

    [string]$ArchivePath,

    [switch]$Offline
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$hardMaxArchiveBytes = 512MB
$hardMaxEntries = 8192
$hardMaxUncompressedBytes = 1GB
$hardMaxSingleEntryBytes = 512MB
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Resolve-RepositoryPath {
    param(
        [Parameter(Mandatory)] [string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw 'A required path was empty.'
    }
    $candidate = if ([System.IO.Path]::IsPathRooted($Path)) {
        $Path
    }
    else {
        Join-Path $repositoryRoot $Path
    }
    return [System.IO.Path]::GetFullPath($candidate)
}

function Assert-NotRootPath {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [string]$Label
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar)
    $root = [System.IO.Path]::GetPathRoot($fullPath).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar)
    if ($fullPath.Equals($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label cannot be a filesystem root: $fullPath"
    }
}

function Assert-NoReparsePoint {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [string]$Label,
        [switch]$WalkParents
    )

    $current = [System.IO.Path]::GetFullPath($Path)
    while ($true) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "$Label cannot use a symbolic link or reparse point: $current"
            }
        }
        if (-not $WalkParents) {
            return
        }
        $parent = [System.IO.Path]::GetDirectoryName($current)
        if ([string]::IsNullOrEmpty($parent) -or $parent -eq $current) {
            return
        }
        $current = $parent
    }
}

function Assert-ExactProperties {
    param(
        [Parameter(Mandatory)] [object]$Value,
        [Parameter(Mandatory)] [string]$Label,
        [Parameter(Mandatory)] [string[]]$Names
    )

    if ($null -eq $Value -or $Value -is [string] -or $Value -is [System.Collections.IEnumerable]) {
        throw "$Label must be a JSON object."
    }
    $actual = @($Value.PSObject.Properties.Name)
    foreach ($name in $Names) {
        if ($actual -notcontains $name) {
            throw "$Label is missing the required property '$name'."
        }
    }
    foreach ($name in $actual) {
        if ($Names -notcontains $name) {
            throw "$Label contains the unsupported property '$name'."
        }
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

function ConvertTo-CanonicalUtcTimestamp {
    param(
        [AllowNull()] [object]$Value,
        [Parameter(Mandatory)] [string]$Label
    )

    if ($Value -is [string]) {
        if ($Value -notmatch '\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\z') {
            throw "$Label must be a second-precision UTC timestamp."
        }
        return [string]$Value
    }
    if ($Value -is [DateTimeOffset]) {
        return $Value.ToUniversalTime().ToString(
            'yyyy-MM-ddTHH:mm:ssZ',
            [System.Globalization.CultureInfo]::InvariantCulture)
    }
    if ($Value -is [DateTime]) {
        return $Value.ToUniversalTime().ToString(
            'yyyy-MM-ddTHH:mm:ssZ',
            [System.Globalization.CultureInfo]::InvariantCulture)
    }

    throw "$Label must be a UTC timestamp."
}

function Assert-StringValue {
    param(
        [AllowNull()] [object]$Value,
        [Parameter(Mandatory)] [string]$Label,
        [Parameter(Mandatory)] [string]$Pattern
    )

    if ($Value -isnot [string] -or $Value -notmatch $Pattern) {
        throw "$Label is invalid."
    }
    return [string]$Value
}

function Assert-IntegerValue {
    param(
        [AllowNull()] [object]$Value,
        [Parameter(Mandatory)] [string]$Label,
        [long]$Minimum = 0,
        [long]$Maximum = [long]::MaxValue
    )

    $integerTypes = @(
        [byte], [sbyte], [int16], [uint16], [int32], [uint32], [int64], [uint64]
    )
    if ($null -eq $Value -or $integerTypes -notcontains $Value.GetType()) {
        throw "$Label must be an integer."
    }
    try {
        $number = [long]$Value
    }
    catch {
        throw "$Label is outside the supported integer range."
    }
    if ($number -lt $Minimum -or $number -gt $Maximum) {
        throw "$Label must be between $Minimum and $Maximum."
    }
    return $number
}

function Assert-HttpsUri {
    param(
        [Parameter(Mandatory)] [string]$Value,
        [Parameter(Mandatory)] [string]$Label,
        [Parameter(Mandatory)] [string]$HostName
    )

    $uri = $null
    if (-not [System.Uri]::TryCreate($Value, [System.UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -ne [System.Uri]::UriSchemeHttps -or
        -not $uri.Host.Equals($HostName, [System.StringComparison]::OrdinalIgnoreCase) -or
        -not [string]::IsNullOrEmpty($uri.UserInfo) -or
        -not [string]::IsNullOrEmpty($uri.Fragment)) {
        throw "$Label must be an HTTPS URL on $HostName."
    }
    return $uri
}

function Get-Sha256Hex {
    param(
        [Parameter(Mandatory)] [string]$Path
    )

    $stream = [System.IO.File]::Open(
        $Path,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::Read)
    try {
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        try {
            $hash = $sha256.ComputeHash($stream)
            return ([System.BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
        }
        finally {
            $sha256.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

function Get-CanonicalTextBytes {
    param(
        [Parameter(Mandatory)] [string]$Path
    )

    $text = [System.IO.File]::ReadAllText($Path)
    $canonical = $text.Replace("`r`n", "`n").Replace("`r", "`n")
    if (-not $canonical.EndsWith("`n", [System.StringComparison]::Ordinal)) {
        $canonical += "`n"
    }
    return ,$utf8NoBom.GetBytes($canonical)
}

function Get-BytesSha256Hex {
    param(
        [Parameter(Mandatory)] [byte[]]$Bytes
    )

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha256.ComputeHash($Bytes)
        return ([System.BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
    }
}

function Assert-FileReceipt {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [long]$ExpectedLength,
        [Parameter(Mandatory)] [string]$ExpectedSha256,
        [Parameter(Mandatory)] [string]$Label
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label was not found: $Path"
    }
    Assert-NoReparsePoint -Path $Path -Label $Label -WalkParents
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.Length -ne $ExpectedLength) {
        throw "$Label size mismatch. Expected $ExpectedLength bytes; found $($item.Length)."
    }
    $actualSha256 = Get-Sha256Hex -Path $item.FullName
    if (-not $actualSha256.Equals($ExpectedSha256, [System.StringComparison]::Ordinal)) {
        throw "$Label SHA-256 mismatch. Expected $ExpectedSha256; found $actualSha256."
    }
    return $item.FullName
}

function Read-PinnedManifest {
    param(
        [Parameter(Mandatory)] [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Pi runtime manifest was not found: $Path"
    }
    Assert-NoReparsePoint -Path $Path -Label 'Pi runtime manifest' -WalkParents
    try {
        $manifest = ConvertFrom-JsonPreservingDates -Json ([System.IO.File]::ReadAllText($Path))
    }
    catch {
        throw "Pi runtime manifest is not valid JSON: $($_.Exception.Message)"
    }

    Assert-ExactProperties -Value $manifest -Label 'Pi runtime manifest' -Names @(
        'schemaVersion', 'id', 'displayName', 'version', 'runtime', 'architecture',
        'source', 'release', 'sourceArchive', 'archive', 'executable', 'license',
        'limits', 'policies')
    Assert-ExactProperties -Value $manifest.source -Label 'Pi runtime source' -Names @(
        'repository', 'revision', 'commit', 'package')
    Assert-ExactProperties -Value $manifest.release -Label 'Pi release' -Names @(
        'id', 'tag', 'publishedAtUtc', 'url', 'checksumsUrl', 'checksumsSha256')
    Assert-ExactProperties -Value $manifest.sourceArchive -Label 'Pi source archive' -Names @(
        'fileName', 'url', 'sizeBytes', 'sha256')
    Assert-ExactProperties -Value $manifest.archive -Label 'Pi runtime archive' -Names @(
        'fileName', 'url', 'sizeBytes', 'sha256', 'entryCount', 'fileCount',
        'uncompressedBytes', 'treeReceiptFile', 'treeReceiptBytes', 'treeSha256')
    Assert-ExactProperties -Value $manifest.executable -Label 'Pi runtime executable' -Names @(
        'relativePath', 'sizeBytes', 'sha256', 'peMachine', 'authenticode')
    Assert-ExactProperties -Value $manifest.license -Label 'Pi runtime license' -Names @(
        'spdx', 'sourcePath', 'stagedFileName', 'url', 'sha256')
    Assert-ExactProperties -Value $manifest.limits -Label 'Pi runtime limits' -Names @(
        'maxEntries', 'maxUncompressedBytes', 'maxSingleEntryBytes')
    Assert-ExactProperties -Value $manifest.policies -Label 'Pi runtime policies' -Names @(
        'extraction', 'permissionMode', 'autoUpdate', 'rpcProtocol')

    if ((Assert-IntegerValue $manifest.schemaVersion 'schemaVersion' 1 1) -ne 1) {
        throw 'Only Pi runtime manifest schemaVersion 1 is supported.'
    }
    if ((Assert-StringValue $manifest.id 'id' '\Api-coding-agent\z') -ne 'pi-coding-agent') {
        throw 'Pi runtime manifest id is unsupported.'
    }
    $null = Assert-StringValue $manifest.displayName 'displayName' '\APi Coding Agent\z'
    $version = Assert-StringValue $manifest.version 'version' '\A\d+\.\d+\.\d+\z'
    if ((Assert-StringValue $manifest.runtime 'runtime' '\Awin-x64\z') -ne 'win-x64' -or
        (Assert-StringValue $manifest.architecture 'architecture' '\Ax64\z') -ne 'x64') {
        throw 'Only the win-x64 Pi runtime is supported.'
    }
    if ($Runtime -ne $manifest.runtime) {
        throw "Requested Pi runtime '$Runtime' does not match manifest runtime '$($manifest.runtime)'."
    }
    if ((Assert-StringValue $manifest.source.repository 'source.repository' '\Ahttps://github\.com/earendil-works/pi\z') -ne
        'https://github.com/earendil-works/pi' -or
        (Assert-StringValue $manifest.source.revision 'source.revision' '\Av\d+\.\d+\.\d+\z') -ne "v$version" -or
        (Assert-StringValue $manifest.source.commit 'source.commit' '\A[0-9a-f]{40}\z') -ne
        '845d6ff1f6643aba440341cce877ce1c43ebbc39' -or
        (Assert-StringValue $manifest.source.package 'source.package' '\A@earendil-works/pi-coding-agent\z') -ne
        '@earendil-works/pi-coding-agent') {
        throw 'Pi runtime source identity is inconsistent with the pinned version.'
    }

    $publishedAtUtc = ConvertTo-CanonicalUtcTimestamp `
        -Value $manifest.release.publishedAtUtc `
        -Label 'release.publishedAtUtc'
    if ((Assert-IntegerValue $manifest.release.id 'release.id' 1 ([long]::MaxValue)) -ne 362082362 -or
        (Assert-StringValue $manifest.release.tag 'release.tag' '\Av\d+\.\d+\.\d+\z') -ne "v$version" -or
        $publishedAtUtc -ne '2026-07-29T14:30:33Z') {
        throw 'Pi release identity does not match the audited v0.83.0 release.'
    }
    $manifest.release.publishedAtUtc = $publishedAtUtc
    $releaseUri = Assert-HttpsUri `
        (Assert-StringValue $manifest.release.url 'release.url' '\Ahttps://.+\z') `
        'release.url' `
        'github.com'
    $checksumsUri = Assert-HttpsUri `
        (Assert-StringValue $manifest.release.checksumsUrl 'release.checksumsUrl' '\Ahttps://.+\z') `
        'release.checksumsUrl' `
        'github.com'
    if (-not $releaseUri.AbsolutePath.Equals(
            "/earendil-works/pi/releases/tag/v$version",
            [System.StringComparison]::Ordinal) -or
        -not $checksumsUri.AbsolutePath.Equals(
            "/earendil-works/pi/releases/download/v$version/SHA256SUMS",
            [System.StringComparison]::Ordinal)) {
        throw 'Pi release URLs do not match the pinned release.'
    }
    $null = Assert-StringValue $manifest.release.checksumsSha256 'release.checksumsSha256' '\A[0-9a-f]{64}\z'

    $sourceArchiveName = Assert-StringValue `
        $manifest.sourceArchive.fileName `
        'sourceArchive.fileName' `
        '\Api-\d+\.\d+\.\d+-source\.tar\.gz\z'
    $sourceArchiveUri = Assert-HttpsUri `
        (Assert-StringValue $manifest.sourceArchive.url 'sourceArchive.url' '\Ahttps://.+\z') `
        'sourceArchive.url' `
        'github.com'
    if ($sourceArchiveName -ne "pi-$version-source.tar.gz" -or
        -not $sourceArchiveUri.AbsolutePath.Equals(
            "/earendil-works/pi/releases/download/v$version/$sourceArchiveName",
            [System.StringComparison]::Ordinal)) {
        throw 'Pi source archive identity does not match the pinned release.'
    }
    $null = Assert-IntegerValue $manifest.sourceArchive.sizeBytes 'sourceArchive.sizeBytes' 1 $hardMaxArchiveBytes
    $null = Assert-StringValue $manifest.sourceArchive.sha256 'sourceArchive.sha256' '\A[0-9a-f]{64}\z'

    $archiveFileName = Assert-StringValue $manifest.archive.fileName 'archive.fileName' '\A[A-Za-z0-9._-]+\.zip\z'
    if ([System.IO.Path]::GetFileName($archiveFileName) -ne $archiveFileName) {
        throw 'archive.fileName must be a plain file name.'
    }
    $archiveUri = Assert-HttpsUri `
        (Assert-StringValue $manifest.archive.url 'archive.url' '\Ahttps://.+\z') `
        'archive.url' `
        'github.com'
    $expectedArchivePath = "/earendil-works/pi/releases/download/v$version/$archiveFileName"
    if (-not $archiveUri.AbsolutePath.Equals(
            $expectedArchivePath,
            [System.StringComparison]::Ordinal)) {
        throw 'archive.url does not match the pinned Pi release and file name.'
    }
    $archiveSize = Assert-IntegerValue $manifest.archive.sizeBytes 'archive.sizeBytes' 1 $hardMaxArchiveBytes
    $archiveHash = Assert-StringValue $manifest.archive.sha256 'archive.sha256' '\A[0-9a-f]{64}\z'
    $archiveEntries = Assert-IntegerValue $manifest.archive.entryCount 'archive.entryCount' 1 $hardMaxEntries
    $archiveFiles = Assert-IntegerValue $manifest.archive.fileCount 'archive.fileCount' 1 $archiveEntries
    $archiveBytes = Assert-IntegerValue `
        $manifest.archive.uncompressedBytes `
        'archive.uncompressedBytes' `
        1 `
        $hardMaxUncompressedBytes
    $treeReceiptFile = Assert-StringValue `
        $manifest.archive.treeReceiptFile `
        'archive.treeReceiptFile' `
        '\ARUNTIME-SHA256SUMS\.txt\z'
    if ([System.IO.Path]::GetFileName($treeReceiptFile) -ne $treeReceiptFile) {
        throw 'archive.treeReceiptFile must be a plain file name.'
    }
    $null = Assert-IntegerValue `
        $manifest.archive.treeReceiptBytes `
        'archive.treeReceiptBytes' `
        1 `
        1MB
    $null = Assert-StringValue $manifest.archive.treeSha256 'archive.treeSha256' '\A[0-9a-f]{64}\z'

    if ((Assert-StringValue $manifest.executable.relativePath 'executable.relativePath' '\Api\.exe\z') -ne 'pi.exe' -or
        (Assert-StringValue $manifest.executable.peMachine 'executable.peMachine' '\Aamd64\z') -ne 'amd64' -or
        (Assert-StringValue $manifest.executable.authenticode 'executable.authenticode' '\Aunsigned\z') -ne 'unsigned') {
        throw 'The pinned executable must be the root win-x64 pi.exe.'
    }
    $executableSize = Assert-IntegerValue `
        $manifest.executable.sizeBytes `
        'executable.sizeBytes' `
        1 `
        $hardMaxSingleEntryBytes
    $null = Assert-StringValue $manifest.executable.sha256 'executable.sha256' '\A[0-9a-f]{64}\z'

    if ((Assert-StringValue $manifest.license.spdx 'license.spdx' '\AMIT\z') -ne 'MIT') {
        throw 'Only the audited MIT Pi license is supported.'
    }
    $licenseSourcePath = Assert-StringValue `
        $manifest.license.sourcePath `
        'license.sourcePath' `
        '\A[A-Za-z0-9._-]+\.txt\z'
    $licenseStagedName = Assert-StringValue `
        $manifest.license.stagedFileName `
        'license.stagedFileName' `
        '\A[A-Za-z0-9._-]+\.txt\z'
    if ([System.IO.Path]::GetFileName($licenseSourcePath) -ne $licenseSourcePath -or
        [System.IO.Path]::GetFileName($licenseStagedName) -ne $licenseStagedName -or
        -not $licenseStagedName.Equals('LICENSE-Pi.txt', [System.StringComparison]::Ordinal)) {
        throw 'Pi license paths must be plain file names and stage as LICENSE-Pi.txt.'
    }
    $licenseUri = Assert-HttpsUri `
        (Assert-StringValue $manifest.license.url 'license.url' '\Ahttps://.+\z') `
        'license.url' `
        'github.com'
    if (-not $licenseUri.AbsolutePath.Equals(
            "/earendil-works/pi/blob/v$version/LICENSE",
            [System.StringComparison]::Ordinal)) {
        throw 'license.url does not match the pinned Pi release.'
    }
    $null = Assert-StringValue $manifest.license.sha256 'license.sha256' '\A[0-9a-f]{64}\z'

    $maxEntries = Assert-IntegerValue $manifest.limits.maxEntries 'limits.maxEntries' 1 $hardMaxEntries
    $maxUncompressedBytes = Assert-IntegerValue `
        $manifest.limits.maxUncompressedBytes `
        'limits.maxUncompressedBytes' `
        1 `
        $hardMaxUncompressedBytes
    $maxSingleEntryBytes = Assert-IntegerValue `
        $manifest.limits.maxSingleEntryBytes `
        'limits.maxSingleEntryBytes' `
        1 `
        $hardMaxSingleEntryBytes
    if ($archiveEntries -gt $maxEntries -or
        $archiveBytes -gt $maxUncompressedBytes -or
        $executableSize -gt $maxSingleEntryBytes) {
        throw 'Pinned archive facts exceed the manifest extraction limits.'
    }
    if ((Assert-StringValue $manifest.policies.extraction 'policies.extraction' '\Afull-archive\z') -ne 'full-archive' -or
        (Assert-StringValue $manifest.policies.permissionMode 'policies.permissionMode' '\Achat-only\z') -ne 'chat-only' -or
        $manifest.policies.autoUpdate -isnot [bool] -or
        $manifest.policies.autoUpdate -or
        (Assert-StringValue $manifest.policies.rpcProtocol 'policies.rpcProtocol' '\Ajsonl-stdin-stdout\z') -ne
        'jsonl-stdin-stdout') {
        throw 'Pi runtime policies must remain full-archive, chat-only, RPC-only, and auto-update disabled.'
    }

    return $manifest
}

function Receive-PinnedArchive {
    param(
        [Parameter(Mandatory)] [System.Uri]$Uri,
        [Parameter(Mandatory)] [string]$OutputPath,
        [Parameter(Mandatory)] [long]$ExpectedLength
    )

    if (Test-Path -LiteralPath $OutputPath) {
        throw "Refusing to overwrite an existing download path: $OutputPath"
    }
    Add-Type -AssemblyName System.Net.Http
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $true
    $handler.MaxAutomaticRedirections = 5
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromMinutes(15)
    $client.DefaultRequestHeaders.UserAgent.ParseAdd('JARVIS-Pi-Runtime-Stager/1.0')
    try {
        $response = $client.GetAsync(
            $Uri,
            [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        try {
            $response.EnsureSuccessStatusCode() | Out-Null
            if ($response.RequestMessage.RequestUri.Scheme -ne [System.Uri]::UriSchemeHttps) {
                throw 'Pi archive download redirected to a non-HTTPS URL.'
            }
            $contentLength = $response.Content.Headers.ContentLength
            if ($null -ne $contentLength -and $contentLength -ne $ExpectedLength) {
                throw "Pi archive Content-Length mismatch. Expected $ExpectedLength; found $contentLength."
            }

            $source = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
            $destination = [System.IO.File]::Open(
                $OutputPath,
                [System.IO.FileMode]::CreateNew,
                [System.IO.FileAccess]::Write,
                [System.IO.FileShare]::None)
            try {
                $buffer = [byte[]]::new(128KB)
                [long]$written = 0
                while (($read = $source.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $written += $read
                    if ($written -gt $ExpectedLength) {
                        throw 'Pi archive download exceeded the pinned byte length.'
                    }
                    $destination.Write($buffer, 0, $read)
                }
                if ($written -ne $ExpectedLength) {
                    throw "Pi archive download ended at $written bytes; expected $ExpectedLength."
                }
            }
            finally {
                $destination.Dispose()
                $source.Dispose()
            }
        }
        finally {
            $response.Dispose()
        }
    }
    finally {
        $client.Dispose()
        $handler.Dispose()
    }
}

function Get-UnsignedExternalAttributes {
    param(
        [Parameter(Mandatory)] [int]$Value
    )

    return [System.BitConverter]::ToUInt32([System.BitConverter]::GetBytes($Value), 0)
}

function Get-SafeArchiveEntry {
    param(
        [Parameter(Mandatory)] [System.IO.Compression.ZipArchiveEntry]$Entry
    )

    $name = $Entry.FullName
    if ([string]::IsNullOrWhiteSpace($name) -or
        $name.Contains('\') -or
        $name.Contains([char]0) -or
        $name.StartsWith('/', [System.StringComparison]::Ordinal) -or
        $name -match '\A[A-Za-z]:' -or
        $name.Contains('//')) {
        throw "ZIP entry uses an unsafe or absolute path: '$name'."
    }
    $isDirectory = $name.EndsWith('/', [System.StringComparison]::Ordinal)
    $trimmed = if ($isDirectory) { $name.Substring(0, $name.Length - 1) } else { $name }
    if ([string]::IsNullOrEmpty($trimmed)) {
        throw 'ZIP root directory entries are not allowed.'
    }

    $segments = $trimmed.Split('/')
    foreach ($segment in $segments) {
        if ([string]::IsNullOrEmpty($segment) -or
            $segment -eq '.' -or
            $segment -eq '..' -or
            $segment.EndsWith('.', [System.StringComparison]::Ordinal) -or
            $segment.EndsWith(' ', [System.StringComparison]::Ordinal) -or
            $segment -match '[\x00-\x1f<>:"|?*]' -or
            $segment -match '\A(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?\z') {
            throw "ZIP entry contains an unsafe Windows path segment: '$name'."
        }
    }

    $external = Get-UnsignedExternalAttributes -Value $Entry.ExternalAttributes
    $unixType = (($external -shr 16) -band 0xF000)
    $dosAttributes = ($external -band 0xFFFF)
    if ($unixType -eq 0xA000 -or
        ($dosAttributes -band [uint32][System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "ZIP entry is a symbolic link or reparse point: '$name'."
    }
    if ($unixType -ne 0 -and $unixType -ne 0x4000 -and $unixType -ne 0x8000) {
        throw "ZIP entry uses an unsupported filesystem object type: '$name'."
    }

    return [pscustomobject]@{
        Entry = $Entry
        RelativePath = ($segments -join '/')
        IsDirectory = $isDirectory
    }
}

function Assert-Amd64PortableExecutable {
    param(
        [Parameter(Mandatory)] [string]$Path
    )

    $stream = [System.IO.File]::Open(
        $Path,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::Read)
    $reader = [System.IO.BinaryReader]::new($stream)
    try {
        if ($stream.Length -lt 70 -or $reader.ReadUInt16() -ne 0x5A4D) {
            throw 'Pinned pi.exe is not a Windows PE file.'
        }
        $stream.Position = 0x3C
        $peOffset = $reader.ReadInt32()
        if ($peOffset -lt 64 -or $peOffset -gt ($stream.Length - 6)) {
            throw 'Pinned pi.exe contains an invalid PE header offset.'
        }
        $stream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x00004550 -or $reader.ReadUInt16() -ne 0x8664) {
            throw 'Pinned pi.exe is not an AMD64 Windows executable.'
        }
    }
    finally {
        $reader.Dispose()
        $stream.Dispose()
    }
}

function Expand-VerifiedArchive {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [string]$OutputDirectory,
        [Parameter(Mandatory)] [object]$Manifest
    )

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
        if ($archive.Entries.Count -gt [long]$Manifest.limits.maxEntries -or
            $archive.Entries.Count -ne [long]$Manifest.archive.entryCount) {
            throw "Pi archive entry count mismatch or limit exceeded: $($archive.Entries.Count)."
        }

        $seen = [System.Collections.Generic.HashSet[string]]::new(
            [System.StringComparer]::OrdinalIgnoreCase)
        $safeEntries = [System.Collections.Generic.List[object]]::new()
        [long]$declaredBytes = 0
        [long]$fileCount = 0
        $reservedPaths = @(
            'runtime.json',
            'LICENSE-Pi.txt',
            'PROVENANCE.txt',
            [string]$Manifest.archive.treeReceiptFile)
        $forbiddenStateNames = @('.env', 'auth.json', 'settings.json', 'sessions.json', 'session.json')
        foreach ($entry in $archive.Entries) {
            $safe = Get-SafeArchiveEntry -Entry $entry
            if (-not $seen.Add($safe.RelativePath)) {
                throw "Pi archive contains a duplicate path: '$($safe.RelativePath)'."
            }
            if ($reservedPaths -contains $safe.RelativePath) {
                throw "Pi archive attempts to replace JARVIS-owned metadata: '$($safe.RelativePath)'."
            }
            $baseName = ($safe.RelativePath -split '/')[-1]
            if (-not $safe.IsDirectory -and $forbiddenStateNames -contains $baseName) {
                throw "Pi archive contains a credential or mutable-state file: '$($safe.RelativePath)'."
            }
            if (-not $safe.IsDirectory) {
                $fileCount++
            }
            if ($entry.Length -lt 0 -or $entry.CompressedLength -lt 0 -or
                $entry.Length -gt [long]$Manifest.limits.maxSingleEntryBytes) {
                throw "Pi archive entry exceeds its size limit: '$($safe.RelativePath)'."
            }
            $declaredBytes += [long]$entry.Length
            if ($declaredBytes -gt [long]$Manifest.limits.maxUncompressedBytes) {
                throw 'Pi archive exceeds its total uncompressed-byte limit.'
            }
            $safeEntries.Add($safe)
        }
        if ($declaredBytes -ne [long]$Manifest.archive.uncompressedBytes) {
            throw "Pi archive uncompressed-byte receipt mismatch. Expected $($Manifest.archive.uncompressedBytes); found $declaredBytes."
        }
        if ($fileCount -ne [long]$Manifest.archive.fileCount) {
            throw "Pi archive file-count receipt mismatch. Expected $($Manifest.archive.fileCount); found $fileCount."
        }

        [System.IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
        $rootPrefix = [System.IO.Path]::GetFullPath($OutputDirectory).TrimEnd(
            [System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
        [long]$extractedBytes = 0
        $fileHashes = [System.Collections.Generic.Dictionary[string, string]]::new(
            [System.StringComparer]::Ordinal)
        foreach ($safe in $safeEntries) {
            $relative = $safe.RelativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
            $target = [System.IO.Path]::GetFullPath((Join-Path $OutputDirectory $relative))
            if (-not $target.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "Pi archive extraction escaped the staging directory: '$($safe.RelativePath)'."
            }
            if ($safe.IsDirectory) {
                [System.IO.Directory]::CreateDirectory($target) | Out-Null
                continue
            }

            $parent = [System.IO.Path]::GetDirectoryName($target)
            [System.IO.Directory]::CreateDirectory($parent) | Out-Null
            $source = $safe.Entry.Open()
            $destination = [System.IO.File]::Open(
                $target,
                [System.IO.FileMode]::CreateNew,
                [System.IO.FileAccess]::Write,
                [System.IO.FileShare]::None)
            $entryHash = [System.Security.Cryptography.SHA256]::Create()
            try {
                $buffer = [byte[]]::new(128KB)
                [long]$entryBytes = 0
                while (($read = $source.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $entryBytes += $read
                    $extractedBytes += $read
                    if ($entryBytes -gt [long]$safe.Entry.Length -or
                        $entryBytes -gt [long]$Manifest.limits.maxSingleEntryBytes -or
                        $extractedBytes -gt [long]$Manifest.limits.maxUncompressedBytes) {
                        throw "Pi archive produced more data than declared: '$($safe.RelativePath)'."
                    }
                    $destination.Write($buffer, 0, $read)
                    $null = $entryHash.TransformBlock($buffer, 0, $read, $buffer, 0)
                }
                if ($entryBytes -ne [long]$safe.Entry.Length) {
                    throw "Pi archive entry ended at an unexpected byte length: '$($safe.RelativePath)'."
                }
                $empty = [byte[]]::new(0)
                $null = $entryHash.TransformFinalBlock($empty, 0, 0)
                $entryHashHex = ([System.BitConverter]::ToString($entryHash.Hash) -replace '-', '').ToLowerInvariant()
                $fileHashes.Add($safe.RelativePath, $entryHashHex)
            }
            finally {
                $entryHash.Dispose()
                $destination.Dispose()
                $source.Dispose()
            }
        }
        if ($extractedBytes -ne $declaredBytes) {
            throw 'Pi archive extraction did not reproduce the declared byte count.'
        }
        if ($fileHashes.Count -ne [long]$Manifest.archive.fileCount) {
            throw 'Pi runtime tree receipt does not contain the expected number of files.'
        }

        $receiptPaths = [System.Collections.Generic.List[string]]::new()
        foreach ($relativePath in $fileHashes.Keys) {
            $receiptPaths.Add($relativePath)
        }
        $receiptPaths.Sort([System.StringComparer]::Ordinal)
        $receiptBuilder = [System.Text.StringBuilder]::new()
        foreach ($relativePath in $receiptPaths) {
            $null = $receiptBuilder.Append($fileHashes[$relativePath])
            $null = $receiptBuilder.Append('  ')
            $null = $receiptBuilder.Append($relativePath)
            $null = $receiptBuilder.Append("`n")
        }
        $receiptBytes = $utf8NoBom.GetBytes($receiptBuilder.ToString())
        if ($receiptBytes.Length -ne [long]$Manifest.archive.treeReceiptBytes) {
            throw "Pi runtime tree receipt byte length mismatch. Expected $($Manifest.archive.treeReceiptBytes); found $($receiptBytes.Length)."
        }
        $receiptHash = Get-BytesSha256Hex -Bytes $receiptBytes
        if (-not $receiptHash.Equals($Manifest.archive.treeSha256, [System.StringComparison]::Ordinal)) {
            throw "Pi runtime tree SHA-256 mismatch. Expected $($Manifest.archive.treeSha256); found $receiptHash."
        }
        [System.IO.File]::WriteAllBytes(
            (Join-Path $OutputDirectory $Manifest.archive.treeReceiptFile),
            $receiptBytes)
    }
    finally {
        $archive.Dispose()
    }

    foreach ($item in Get-ChildItem -LiteralPath $OutputDirectory -Force -Recurse) {
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Pi archive extraction created a reparse point: $($item.FullName)"
        }
    }
}

function Assert-ManagedDestination {
    param(
        [Parameter(Mandatory)] [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "Pi runtime destination exists but is not a directory: $Path"
    }
    Assert-NoReparsePoint -Path $Path -Label 'Existing Pi runtime destination' -WalkParents
    $receiptPath = Join-Path $Path 'runtime.json'
    if (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) {
        throw 'Refusing to replace an unrecognized directory without runtime.json.'
    }
    try {
        $receipt = ConvertFrom-JsonPreservingDates -Json ([System.IO.File]::ReadAllText($receiptPath))
    }
    catch {
        throw 'Refusing to replace a destination with an unreadable runtime.json.'
    }
    if ($receipt.id -ne 'pi-coding-agent') {
        throw 'Refusing to replace a destination not owned by the Pi runtime stager.'
    }
}

function Install-StagedDirectory {
    param(
        [Parameter(Mandatory)] [string]$StagingDirectory,
        [Parameter(Mandatory)] [string]$DestinationDirectory
    )

    Assert-ManagedDestination -Path $DestinationDirectory
    $parent = [System.IO.Path]::GetDirectoryName($DestinationDirectory)
    Assert-NoReparsePoint -Path $parent -Label 'Pi runtime destination parent' -WalkParents
    [System.IO.Directory]::CreateDirectory($parent) | Out-Null
    Assert-NoReparsePoint -Path $parent -Label 'Pi runtime destination parent' -WalkParents

    $backup = "$DestinationDirectory.backup.$([System.Guid]::NewGuid().ToString('N'))"
    $movedExisting = $false
    try {
        if (Test-Path -LiteralPath $DestinationDirectory) {
            [System.IO.Directory]::Move($DestinationDirectory, $backup)
            $movedExisting = $true
        }
        try {
            [System.IO.Directory]::Move($StagingDirectory, $DestinationDirectory)
        }
        catch {
            if ($movedExisting -and
                -not (Test-Path -LiteralPath $DestinationDirectory) -and
                (Test-Path -LiteralPath $backup)) {
                [System.IO.Directory]::Move($backup, $DestinationDirectory)
                $movedExisting = $false
            }
            throw
        }
        if ($movedExisting) {
            Remove-Item -LiteralPath $backup -Recurse -Force
            $movedExisting = $false
        }
    }
    finally {
        if ($movedExisting -and
            -not (Test-Path -LiteralPath $DestinationDirectory) -and
            (Test-Path -LiteralPath $backup)) {
            [System.IO.Directory]::Move($backup, $DestinationDirectory)
        }
    }
}

if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $ManifestPath = Join-Path $repositoryRoot 'third_party\pi\runtime.json'
}
$ManifestPath = Resolve-RepositoryPath -Path $ManifestPath
$manifest = Read-PinnedManifest -Path $ManifestPath

if ([string]::IsNullOrWhiteSpace($Destination)) {
    $Destination = Join-Path $repositoryRoot "artifacts\staged\pi\$($manifest.version)\AgentRuntime"
}
$Destination = Resolve-RepositoryPath -Path $Destination
Assert-NotRootPath -Path $Destination -Label 'Pi runtime destination'

if (-not $PSBoundParameters.ContainsKey('CacheDirectory')) {
    $CacheDirectory = Join-Path $repositoryRoot "artifacts\vendor\pi\$($manifest.version)"
}
$cacheEnabled = -not [string]::IsNullOrWhiteSpace($CacheDirectory)
if ($cacheEnabled) {
    $CacheDirectory = Resolve-RepositoryPath -Path $CacheDirectory
    Assert-NotRootPath -Path $CacheDirectory -Label 'Pi runtime cache directory'
}

$licensePath = [System.IO.Path]::GetFullPath((Join-Path ([System.IO.Path]::GetDirectoryName($ManifestPath)) $manifest.license.sourcePath))
$manifestDirectoryPrefix = [System.IO.Path]::GetDirectoryName($ManifestPath).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $licensePath.StartsWith($manifestDirectoryPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
    -not (Test-Path -LiteralPath $licensePath -PathType Leaf)) {
    throw 'Pinned Pi license is missing or escapes the manifest directory.'
}
Assert-NoReparsePoint -Path $licensePath -Label 'Pinned Pi license' -WalkParents
$licenseBytes = Get-CanonicalTextBytes -Path $licensePath
$licenseHash = Get-BytesSha256Hex -Bytes $licenseBytes
if (-not $licenseHash.Equals($manifest.license.sha256, [System.StringComparison]::Ordinal)) {
    throw "Pinned Pi license SHA-256 mismatch. Expected $($manifest.license.sha256); found $licenseHash."
}

$deleteArchiveAfterUse = $false
$archiveSource = $null
if ($PSBoundParameters.ContainsKey('ArchivePath')) {
    if ([string]::IsNullOrWhiteSpace($ArchivePath)) {
        throw '-ArchivePath cannot be empty when specified.'
    }
    $archiveSource = Resolve-RepositoryPath -Path $ArchivePath
    $acquisitionMode = 'archive-override'
}
elseif ($cacheEnabled -and (Test-Path -LiteralPath (Join-Path $CacheDirectory $manifest.archive.fileName))) {
    $archiveSource = Join-Path $CacheDirectory $manifest.archive.fileName
    $acquisitionMode = 'verified-cache'
}
elseif ($Offline) {
    throw 'Pinned Pi archive is unavailable in offline mode. Supply -ArchivePath or populate the verified cache.'
}
else {
    $downloadDirectory = if ($cacheEnabled) {
        Assert-NoReparsePoint -Path $CacheDirectory -Label 'Pi runtime cache directory' -WalkParents
        [System.IO.Directory]::CreateDirectory($CacheDirectory) | Out-Null
        Assert-NoReparsePoint -Path $CacheDirectory -Label 'Pi runtime cache directory' -WalkParents
        $CacheDirectory
    }
    else {
        $temporaryRoot = Join-Path $repositoryRoot 'artifacts\build\pi-downloads'
        Assert-NoReparsePoint -Path $temporaryRoot -Label 'Pi temporary download directory' -WalkParents
        [System.IO.Directory]::CreateDirectory($temporaryRoot) | Out-Null
        Assert-NoReparsePoint -Path $temporaryRoot -Label 'Pi temporary download directory' -WalkParents
        $temporaryRoot
    }
    $downloadPath = Join-Path $downloadDirectory ".pi-download-$([System.Guid]::NewGuid().ToString('N')).zip"
    try {
        Receive-PinnedArchive `
            -Uri ([System.Uri]$manifest.archive.url) `
            -OutputPath $downloadPath `
            -ExpectedLength ([long]$manifest.archive.sizeBytes)
        $null = Assert-FileReceipt `
            -Path $downloadPath `
            -ExpectedLength ([long]$manifest.archive.sizeBytes) `
            -ExpectedSha256 $manifest.archive.sha256 `
            -Label 'Downloaded Pi archive'

        if ($cacheEnabled) {
            $cachePath = Join-Path $CacheDirectory $manifest.archive.fileName
            if (Test-Path -LiteralPath $cachePath) {
                $null = Assert-FileReceipt `
                    -Path $cachePath `
                    -ExpectedLength ([long]$manifest.archive.sizeBytes) `
                    -ExpectedSha256 $manifest.archive.sha256 `
                    -Label 'Concurrent Pi archive cache entry'
                Remove-Item -LiteralPath $downloadPath -Force
            }
            else {
                [System.IO.File]::Move($downloadPath, $cachePath)
            }
            $archiveSource = $cachePath
            $acquisitionMode = 'downloaded-to-cache'
        }
        else {
            $archiveSource = $downloadPath
            $deleteArchiveAfterUse = $true
            $acquisitionMode = 'ephemeral-download'
        }
    }
    catch {
        if (Test-Path -LiteralPath $downloadPath) {
            Remove-Item -LiteralPath $downloadPath -Force
        }
        throw
    }
}

try {
    $archiveSource = Assert-FileReceipt `
        -Path $archiveSource `
        -ExpectedLength ([long]$manifest.archive.sizeBytes) `
        -ExpectedSha256 $manifest.archive.sha256 `
        -Label 'Pinned Pi archive'

    $destinationParent = [System.IO.Path]::GetDirectoryName($Destination)
    Assert-NoReparsePoint -Path $destinationParent -Label 'Pi runtime destination parent' -WalkParents
    [System.IO.Directory]::CreateDirectory($destinationParent) | Out-Null
    Assert-NoReparsePoint -Path $destinationParent -Label 'Pi runtime destination parent' -WalkParents
    $stagingDirectory = "$Destination.staging.$([System.Guid]::NewGuid().ToString('N'))"
    if (Test-Path -LiteralPath $stagingDirectory) {
        throw "Generated Pi staging path already exists: $stagingDirectory"
    }

    try {
        Expand-VerifiedArchive `
            -Path $archiveSource `
            -OutputDirectory $stagingDirectory `
            -Manifest $manifest

        $piExecutable = Join-Path $stagingDirectory $manifest.executable.relativePath
        $null = Assert-FileReceipt `
            -Path $piExecutable `
            -ExpectedLength ([long]$manifest.executable.sizeBytes) `
            -ExpectedSha256 $manifest.executable.sha256 `
            -Label 'Staged Pi executable'
        Assert-Amd64PortableExecutable -Path $piExecutable

        [System.IO.File]::Copy($ManifestPath, (Join-Path $stagingDirectory 'runtime.json'), $false)
        [System.IO.File]::WriteAllBytes(
            (Join-Path $stagingDirectory $manifest.license.stagedFileName),
            $licenseBytes)
        $provenance = @"
Pi Agent private runtime for JARVIS

Component: $($manifest.displayName)
Version: $($manifest.version)
Runtime: $($manifest.runtime)
Source repository: $($manifest.source.repository)
Source revision: $($manifest.source.revision)
Source commit: $($manifest.source.commit)
Release page: $($manifest.release.url)
Published at UTC: $($manifest.release.publishedAtUtc)
Source archive: $($manifest.sourceArchive.url)
Source archive SHA-256: $($manifest.sourceArchive.sha256)
Release archive: $($manifest.archive.url)
Release checksums: $($manifest.release.checksumsUrl)
Archive SHA-256: $($manifest.archive.sha256)
Executable SHA-256: $($manifest.executable.sha256)
Upstream Authenticode: $($manifest.executable.authenticode)
License: MIT; see $($manifest.license.stagedFileName)

JARVIS stages the complete pinned upstream archive. The staging process does not
execute Pi, install a global package, modify PATH, or include provider credentials.
This upstream release executable is unsigned and no detached signature or SBOM was
published with the pinned asset; JARVIS therefore relies on its reviewed hash pin.
"@
        [System.IO.File]::WriteAllText(
            (Join-Path $stagingDirectory 'PROVENANCE.txt'),
            $provenance.Replace("`r`n", "`n").Replace("`r", "`n"),
            $utf8NoBom)

        $stagedLicenseHash = Get-Sha256Hex -Path (Join-Path $stagingDirectory $manifest.license.stagedFileName)
        if (-not $stagedLicenseHash.Equals($manifest.license.sha256, [System.StringComparison]::Ordinal)) {
            throw 'Staged Pi license failed its final SHA-256 receipt.'
        }
        Install-StagedDirectory `
            -StagingDirectory $stagingDirectory `
            -DestinationDirectory $Destination
    }
    finally {
        if (Test-Path -LiteralPath $stagingDirectory) {
            Remove-Item -LiteralPath $stagingDirectory -Recurse -Force
        }
    }

    [pscustomobject]@{
        Component = $manifest.id
        Version = $manifest.version
        Runtime = $manifest.runtime
        Destination = $Destination
        Acquisition = $acquisitionMode
        ArchiveSha256 = $manifest.archive.sha256
        ExecutableSha256 = $manifest.executable.sha256
        ArchiveEntries = [long]$manifest.archive.entryCount
        UncompressedBytes = [long]$manifest.archive.uncompressedBytes
    }
}
finally {
    if ($deleteArchiveAfterUse -and $null -ne $archiveSource -and (Test-Path -LiteralPath $archiveSource)) {
        Remove-Item -LiteralPath $archiveSource -Force
    }
}
