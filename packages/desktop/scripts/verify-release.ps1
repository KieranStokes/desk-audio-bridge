param(
    [string]$InstallerPath,
    [switch]$RequireSignature
)

$ErrorActionPreference = 'Stop'

if (-not $InstallerPath) {
    $installer = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '..\dist') -Filter 'Desk Audio Bridge Setup *.exe' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $installer) {
        throw 'No Desk Audio Bridge installer was found in dist.'
    }
    $InstallerPath = $installer.FullName
}

$resolvedPath = (Resolve-Path -LiteralPath $InstallerPath).Path
$signature = Get-AuthenticodeSignature -LiteralPath $resolvedPath
$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedPath
$file = Get-Item -LiteralPath $resolvedPath

[pscustomobject]@{
    Installer = $file.FullName
    SizeBytes = $file.Length
    SHA256 = $hash.Hash
    SignatureStatus = $signature.Status
    Publisher = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { 'Unsigned' }
} | Format-List

if ($RequireSignature -and $signature.Status -ne 'Valid') {
    throw "Release signature is not valid: $($signature.Status). Configure WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD."
}
