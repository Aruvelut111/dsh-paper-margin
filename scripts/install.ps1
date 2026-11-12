param(
    [ValidateSet('desktop', 'web')]
    [string]$Profile = 'desktop',
    [string]$DshPath
)

$ErrorActionPreference = 'Stop'
$release = 'https://github.com/Aruvelut111/dsh-paper-margin/releases/download/v2.5.6'
$packages = @(
    @{ Name = 'dsh-paper-margin-2.5.6.tgz'; Sha256 = '5ea496be7240e0031a758df7e653e9d3bf53f9c70916dbc8d61b833554a74be6' },
    @{ Name = 'dsh-sidenote-0.8.5-reader.4.tgz'; Sha256 = '7a86c6e4557788fd7724d9d19a54c42fd04d947936c6dd95b35051ea14e6a4ef' }
)

if (-not $DshPath -and $Profile -eq 'desktop') {
    foreach ($base in @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if (-not $base) { continue }
        foreach ($relative in @('Programs/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd', 'DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd')) {
            $candidate = Join-Path $base $relative
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { $DshPath = $candidate; break }
        }
        if ($DshPath) { break }
    }
}
if (-not $DshPath) {
    $command = Get-Command dsh -ErrorAction SilentlyContinue
    if ($command) { $DshPath = $command.Source }
}
if (-not $DshPath -or -not (Test-Path -LiteralPath $DshPath -PathType Leaf)) {
    throw 'DSH was not found. Install DeepSeek Harness, or run this script with -DshPath pointing to its dsh command.'
}

$downloadDir = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh-paper-margin-' + [guid]::NewGuid().ToString('N'))
$downloaded = @()
New-Item -ItemType Directory -Path $downloadDir | Out-Null
try {
    foreach ($package in $packages) {
        $file = Join-Path $downloadDir $package.Name
        $downloaded += $file
        Write-Host ('Downloading ' + $package.Name)
        Invoke-WebRequest -Uri ($release + '/' + $package.Name) -OutFile $file -UseBasicParsing
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $package.Sha256) {
            throw ('Download checksum mismatch: ' + $package.Name)
        }
    }
    & $DshPath plugin --profile $Profile add @downloaded --ignore-scripts --save-exact
    if ($LASTEXITCODE -ne 0) { throw ('DSH installation failed with exit code ' + $LASTEXITCODE) }
    Write-Host ('Installed Paper Margin 2.5.6 and sidenote 0.8.5-reader.4 in profile ' + $Profile + '. Restart DSH to load them.')
} finally {
    foreach ($file in $downloaded) {
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
    }
    Remove-Item -LiteralPath $downloadDir -ErrorAction SilentlyContinue
}
