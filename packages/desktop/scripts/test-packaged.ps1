param(
    [string]$ExecutablePath = (Join-Path $PSScriptRoot '..\dist\win-unpacked\Desk Audio Bridge.exe')
)

$ErrorActionPreference = 'Stop'
$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$profilePath = Join-Path $temporaryRoot ("xbox-audio-bridge-package-test-{0}" -f [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $profilePath
$previousCi = $env:CI
$previousProfile = $env:XAB_TEST_PROFILE
$previousAutoQuit = $env:XAB_TEST_AUTO_QUIT_MS

try {
    $env:CI = 'true'
    $env:XAB_TEST_PROFILE = $profilePath
    $env:XAB_TEST_AUTO_QUIT_MS = '3000'
    $process = Start-Process -FilePath $resolvedExecutable -ArgumentList '--hidden' -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0) {
        throw "Packaged app exited with code $($process.ExitCode)."
    }

    $logPath = Join-Path $profilePath 'logs\bridge.log'
    if (-not (Test-Path -LiteralPath $logPath)) {
        throw 'Packaged app did not create its startup diagnostic log.'
    }
    $events = Get-Content -LiteralPath $logPath | ForEach-Object { $_ | ConvertFrom-Json }
    if (-not ($events | Where-Object event -eq 'app.started')) {
        throw 'Packaged app did not report app.started.'
    }
    if (-not ($events | Where-Object { $_.event -eq 'auth.token-store-loaded' -and $_.status -eq 'empty' })) {
        throw 'Packaged app did not initialize a clean token store.'
    }

    Write-Output "Packaged clean-profile smoke test passed: $resolvedExecutable"
} finally {
    $env:CI = $previousCi
    $env:XAB_TEST_PROFILE = $previousProfile
    $env:XAB_TEST_AUTO_QUIT_MS = $previousAutoQuit
    $resolvedProfile = [IO.Path]::GetFullPath($profilePath)
    if ($resolvedProfile.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedProfile)) {
        Remove-Item -LiteralPath $resolvedProfile -Recurse -Force
    }
}
