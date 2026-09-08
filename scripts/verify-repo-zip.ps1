Add-Type -AssemblyName System.IO.Compression.FileSystem

$zipPath = "C:\Lavoro\REPOS\PI-FRAME\pi-frame.zip"
if (-not (Test-Path -LiteralPath $zipPath -PathType Leaf)) {
    throw "Source ZIP not found: $zipPath"
}

$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
if ($zip.Entries.Count -eq 0) {
    $zip.Dispose()
    throw "Source ZIP is empty."
}

$requiredEntries = @(
    'README.md',
    'package.json',
    'AGENTS.md',
    'pnpm-workspace.yaml',
    'apps/desktop/package.json'
)
$entryNames = @($zip.Entries | ForEach-Object { ($_.FullName -replace '\\', '/') -replace '^/+', '' })
$missingRequired = @($requiredEntries | Where-Object { $entryNames -notcontains $_ })

$hasGit = ($zip.Entries | Where-Object { $_.FullName -like '.git/*' -or $_.FullName -like '.git\*' }).Count
$hasAgents = ($zip.Entries | Where-Object { $_.FullName -like '.agents/*' -or $_.FullName -like '.agents\*' }).Count

$excludedDirs = @(
    '.git',
    'plans',
    'generated',
    'coverage',
    'node_modules',
    '.turbo',
    '.next',
    'dist',
    'build',
    'out',
    'release',
    '.cache',
    '.vite',
    'playwright-report',
    'test-results',
    '.pi-subagents',
    '.claude',
    '.codex',
    'pi-gui',
    'pi-desktop'
)

$foundExcluded = 0

foreach ($entry in $zip.Entries) {
    $parts = $entry.FullName.Split([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    for ($i = 0; $i -lt ($parts.Length - 1); $i++) {
        $dir = $parts[$i]
        if ($excludedDirs -contains $dir -or $dir -like 'release-*') {
            $foundExcluded++
            Write-Host "Unexpected excluded dir segment found: $($entry.FullName)"
            break
        }
    }
}

$archiveEntryCount = $zip.Entries.Count
$zip.Dispose()

Write-Host "Verification Results:"
Write-Host ".git files count: $hasGit"
Write-Host ".agents files count: $hasAgents"
Write-Host "Excluded dir items found: $foundExcluded"
Write-Host "Archive entries: $archiveEntryCount"
Write-Host "Missing required entries: $($missingRequired -join ', ')"

if ($hasGit -gt 0 -or $foundExcluded -gt 0 -or $missingRequired.Count -gt 0) {
    throw "Source ZIP failed closed verification (forbidden excluded entries or missing required files)."
}
