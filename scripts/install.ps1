param(
    [ValidateSet('desktop', 'web')]
    [string]$Profile = 'desktop',
    [string]$DshPath,
    [string]$PackagePath
)

$ErrorActionPreference = 'Stop'
$version = '2.6.1'
$release = 'https://github.com/Aruvelut111/dsh-paper-margin/releases/download/v' + $version
$packageName = 'dsh-paper-margin-' + $version + '.tgz'
$sha256 = '620e9b13d47fcf650a516a176927ea8c46c0c6a693d85b90b38ff645a94f5117'

if (-not $DshPath) {
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
    throw 'DSH was not found. Use -DshPath to specify its dsh command.'
}
if (-not (Get-Command tar -ErrorAction SilentlyContinue)) { throw 'Windows tar is required to unpack the verified plugin.' }

$dshHome = if ([string]::IsNullOrWhiteSpace($env:DSH_HOME)) { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh' } else { $env:DSH_HOME.Trim() }
$dshHome = [System.IO.Path]::GetFullPath($dshHome)
$profileDir = Join-Path $dshHome ('profiles/' + $Profile)
$manifestPath = Join-Path $profileDir 'package.json'
if ($Profile -eq 'desktop' -and -not (Test-Path -LiteralPath $manifestPath)) {
    throw 'Open DSH Desktop once to initialize its profile, then quit it before installing.'
}
$downloadDir = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh-paper-margin-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $downloadDir | Out-Null
$backupDir = $null
try {
    $file = Join-Path $downloadDir $packageName
    if ($PackagePath) {
        Copy-Item -LiteralPath $PackagePath -Destination $file
    } else {
        Write-Host ('Downloading ' + $packageName)
        Invoke-WebRequest -Uri ($release + '/' + $packageName) -OutFile $file -UseBasicParsing
    }
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha256) {
        throw ('Download checksum mismatch: ' + $packageName)
    }
    # Unpack only the migration helper from the verified, self-contained package.
    & tar -xzf $file -C $downloadDir package/lib/migrate-profile.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Could not unpack the plugin migration helper.' }
    $helper = Join-Path $downloadDir 'package/lib/migrate-profile.cjs'

    $backupDir = Join-Path $dshHome ('plugin-backups/paper-margin/' + $Profile + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    foreach ($name in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml', 'cordis.yml')) {
        $source = Join-Path $profileDir $name
        if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $backupDir $name) }
    }
    Write-Host ('Profile backup: ' + $backupDir)
    & $DshPath plugin --profile $Profile exec node $helper --check $profileDir
    if ($LASTEXITCODE -ne 0) { throw 'Profile migration preflight failed; no plugin was replaced.' }

    # DSH retains a file: source; keep it for future package operations.
    $archiveDir = Join-Path $dshHome 'plugin-archives/paper-margin'
    New-Item -ItemType Directory -Path $archiveDir -Force | Out-Null
    $archive = Join-Path $archiveDir ($sha256 + '-' + $packageName)
    if (-not (Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha256) {
        Copy-Item -LiteralPath $file -Destination $archive -Force
    }
    & $DshPath plugin --profile $Profile add $archive --ignore-scripts --save-exact
    if ($LASTEXITCODE -ne 0) { throw 'DSH could not install Paper Margin.' }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($null -ne $manifest.dependencies.'dsh-sidenote') {
        & $DshPath plugin --profile $Profile remove dsh-sidenote --config.ignore-scripts=true
        if ($LASTEXITCODE -ne 0) { throw 'DSH could not remove the former companion package.' }
    }
    & $DshPath plugin --profile $Profile exec node $helper $profileDir
    if ($LASTEXITCODE -ne 0) { throw 'The package was installed, but its former profile entry could not be migrated.' }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $bundles = @($manifest.dsh.profile.bundles)
    if ($null -ne $manifest.dependencies.'dsh-sidenote' -or $bundles -contains 'dsh-sidenote' -or @($bundles | Where-Object { $_ -eq 'dsh-paper-margin' }).Count -ne 1) {
        throw 'The profile still has an unexpected reader/chat bundle selection.'
    }
    $installed = Get-Content -LiteralPath (Join-Path $profileDir 'node_modules/dsh-paper-margin/package.json') -Raw | ConvertFrom-Json
    if ($installed.version -ne $version) { throw 'Installed Paper Margin version differs from the release.' }
    Write-Host ('Installed Paper Margin ' + $version + ': reader, annotations and side chat in one plugin. Restart DSH to load it.')
} catch {
    if ($backupDir) { Write-Warning ('Installation did not finish. Profile metadata backup: ' + $backupDir) }
    throw
} finally {
    # Only this invocation's temporary directory; retained archives and profile backups are elsewhere.
    if (Test-Path -LiteralPath $downloadDir) { Remove-Item -LiteralPath $downloadDir -Recurse -Force }
}
