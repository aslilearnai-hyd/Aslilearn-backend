# PowerShell Script to Upload Backend to DigitalOcean
# Usage: .\upload-to-digitalocean.ps1

param(
    [Parameter(Mandatory=$true)]
    [string]$ServerIP,
    
    [Parameter(Mandatory=$false)]
    [string]$ServerUser = "root"
)

Write-Host "Uploading ASLI Backend to DigitalOcean..." -ForegroundColor Yellow
Write-Host ""

# Check if backend directory exists
$backendPath = "F:\Asli learn\backend"
if (-not (Test-Path $backendPath)) {
    Write-Host "Backend directory not found at: $backendPath" -ForegroundColor Red
    exit 1
}

Write-Host "Preparing files for upload..." -ForegroundColor Yellow

# Create temporary directory for upload (exclude node_modules and other unnecessary files)
$tempDir = "$env:TEMP\asli-backend-upload"
if (Test-Path $tempDir) {
    Remove-Item -Path $tempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

# Copy files (exclude node_modules, .git, uploads, etc.)
Write-Host "Copying files (excluding node_modules, .git, uploads)..." -ForegroundColor Yellow

$excludeDirs = @('node_modules', '.git', 'uploads', '__pycache__', '.next', 'dist', 'build')
$excludeFiles = @('*.log', '*.tmp', '.DS_Store')

Get-ChildItem -Path $backendPath -Recurse | Where-Object {
    $item = $_
    $relativePath = $item.FullName.Substring($backendPath.Length + 1)
    
    # Skip excluded directories
    $skip = $false
    foreach ($excludeDir in $excludeDirs) {
        if ($relativePath -like "$excludeDir*" -or $relativePath -like "*\$excludeDir\*") {
            $skip = $true
            break
        }
    }
    
    if (-not $skip) {
        # Skip excluded file types
        foreach ($excludeFile in $excludeFiles) {
            if ($item.Name -like $excludeFile) {
                $skip = $true
                break
            }
        }
    }
    
    -not $skip
} | ForEach-Object {
    $relativePath = $_.FullName.Substring($backendPath.Length + 1)
    $destPath = Join-Path $tempDir $relativePath
    $destDir = Split-Path $destPath -Parent
    
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    
    Copy-Item -Path $_.FullName -Destination $destPath -Force
}

Write-Host "Files prepared" -ForegroundColor Green
Write-Host ""

# Upload using SCP
Write-Host "Uploading to server $ServerUser@$ServerIP..." -ForegroundColor Yellow
Write-Host "This may take a few minutes..." -ForegroundColor Yellow
Write-Host ""

# Use scp command
$scpCommand = "scp -r `"$tempDir\*`" ${ServerUser}@${ServerIP}:/root/asli-backend"

Write-Host "Running: $scpCommand" -ForegroundColor Cyan
Write-Host ""

try {
    Invoke-Expression $scpCommand
    
    Write-Host ""
    Write-Host "Upload complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "1. SSH into your server: ssh $ServerUser@$ServerIP" -ForegroundColor Cyan
    Write-Host "2. Run the deployment script: bash deploy-to-digitalocean.sh" -ForegroundColor Cyan
    Write-Host ""
    
} catch {
    Write-Host ""
    Write-Host "Upload failed: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Make sure:" -ForegroundColor Yellow
    Write-Host "  - You have SSH access to the server" -ForegroundColor Yellow
    Write-Host "  - SCP is installed (comes with Git for Windows)" -ForegroundColor Yellow
    Write-Host "  - Your SSH key is set up or you know the password" -ForegroundColor Yellow
    Write-Host ""
}

# Cleanup
Write-Host "Cleaning up temporary files..." -ForegroundColor Yellow
Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Done!" -ForegroundColor Green
