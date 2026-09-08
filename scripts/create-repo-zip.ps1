Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$sourceDir = "C:\Lavoro\REPOS\PI-FRAME\PI-FRAME"
$zipPath = "C:\Lavoro\REPOS\PI-FRAME\pi-frame.zip"

if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

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

function Should-ExcludePath([string]$relativePath) {
    $parts = $relativePath.Split([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    # Check directory segments only (exclude the filename at the end)
    for ($i = 0; $i -lt ($parts.Length - 1); $i++) {
        $dir = $parts[$i]
        if ($excludedDirs -contains $dir -or $dir -like 'release-*') {
            return $true
        }
    }
    return $false
}

function Should-ExcludeFile([string]$fileName) {
    if ($fileName -like 'tmp-*.png' -or $fileName -like '*.zip') {
        return $true
    }
    return $false
}

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)

$allFiles = Get-ChildItem -Path $sourceDir -Recurse -File -Force

$count = 0
$totalSize = 0

foreach ($file in $allFiles) {
    $relativePath = $file.FullName.Substring($sourceDir.Length).TrimStart('\', '/')
    
    if (Should-ExcludePath $relativePath) {
        continue
    }
    if (Should-ExcludeFile $file.Name) {
        continue
    }

    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $relativePath, [System.IO.Compression.CompressionLevel]::Optimal)
    $count++
    $totalSize += $file.Length
}

$zip.Dispose()

$zipFileItem = Get-Item $zipPath
Write-Host "Created archive successfully:"
Write-Host "Path: $($zipFileItem.FullName)"
Write-Host "Files included: $count"
Write-Host "Uncompressed MB: $([math]::Round($totalSize / 1MB, 2))"
Write-Host "Zip MB: $([math]::Round($zipFileItem.Length / 1MB, 2))"
