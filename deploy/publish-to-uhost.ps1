[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$Host,
    [Parameter(Mandatory = $true)] [string]$KeyPath,
    [string]$User = "root",
    [int]$SshPort = 22,
    [int]$ServicePort = 8000,
    [string]$RemoteDir = "/opt/giftwise-validator"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$sshTarget = "$User@$Host"
$sshArgs = @("-i", $KeyPath, "-p", "$SshPort", $sshTarget)
$scpArgs = @("-i", $KeyPath, "-P", "$SshPort")

Write-Host "Preparing remote directory..."
& ssh @sshArgs "mkdir -p '$RemoteDir/validator' '$RemoteDir/deploy'"
if ($LASTEXITCODE -ne 0) { throw "SSH directory preparation failed" }

$files = @(
    @{ Local = Join-Path $repoRoot "validator/rules.py"; Remote = "$sshTarget`:$RemoteDir/validator/rules.py" },
    @{ Local = Join-Path $repoRoot "deploy/server.py"; Remote = "$sshTarget`:$RemoteDir/deploy/server.py" },
    @{ Local = Join-Path $repoRoot "deploy/Dockerfile"; Remote = "$sshTarget`:$RemoteDir/deploy/Dockerfile" }
)
foreach ($file in $files) {
    Write-Host "Uploading $($file.Local)..."
    & scp @scpArgs $file.Local $file.Remote
    if ($LASTEXITCODE -ne 0) { throw "Upload failed: $($file.Local)" }
}

$remote = "set -e; cd '$RemoteDir'; docker build -t giftwise-validator:local -f deploy/Dockerfile .; docker rm -f giftwise-validator 2>/dev/null || true; docker run -d --name giftwise-validator --restart unless-stopped -p 0.0.0:$ServicePort`:8000 giftwise-validator:local"
Write-Host "Building and starting container on UHost..."
& ssh @sshArgs $remote
if ($LASTEXITCODE -ne 0) { throw "Remote Docker deployment failed" }

Write-Host "Deployment command completed. Verify from an allowed network: http://$Host`:$ServicePort/healthz"
