param(
    [ValidateSet('desktop', 'web')]
    [string]$Profile = 'desktop',
    [string]$DshPath
)

$ErrorActionPreference = 'Stop'
$release = 'https://github.com/Aruvelut111/dsh-paper-margin/releases/download/v2.5.7'
$packages = @(
    @{ Name = 'dsh-paper-margin-2.5.7.tgz'; Sha256 = '8a6ace90c9603527cb5c780e3a0d268f3d59cb85ea5cd46aaa081a3ecba882d6' },
    @{ Name = 'dsh-sidenote-0.8.5-reader.5.tgz'; Sha256 = '00cd34387fac4a6a5528d6a4d7e163c1e7b8f7e7f29dd9ec27ce2fcaa152ff30' }
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
    Write-Host ('Installed Paper Margin 2.5.7 and sidenote 0.8.5-reader.5 in profile ' + $Profile + '. Restart DSH to load them.')
} finally {
    foreach ($file in $downloaded) {
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
    }
    Remove-Item -LiteralPath $downloadDir -ErrorAction SilentlyContinue
}
