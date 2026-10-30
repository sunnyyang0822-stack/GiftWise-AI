<#
.SYNOPSIS
    Upload the GiftWise deterministic rules API to a UCloud UHost and start it as a container.

.DESCRIPTION
    Uploads only validator/rules.py, deploy/server.py and deploy/Dockerfile, then runs
    "docker build" and "docker run" on the remote host. No Dify credentials, no model calls,
    no real product data, and no cloud resources are created by this script.

    -DryRun only validates the local files and prints the commands that would run.
    It performs no ssh/scp, so the argument composition can be checked without a cloud host.

.NOTES
    This file is intentionally ASCII-only: Windows PowerShell 5.1 reads .ps1 files using the
    ANSI code page unless a UTF-8 BOM is present, so non-ASCII text here would break parsing.
    Chinese documentation lives in deploy/README.md.

    The host parameter is $SshHost with "Host" kept as an alias. PowerShell's $Host is a
    read-only automatic variable; naming the parameter "Host" makes binding fail with
    VariableNotWritable, which is why the previous revision could never run.

.EXAMPLE
    .\deploy\publish-to-uhost.ps1 -Host "203.0.113.10" -KeyPath "C:\keys\id_ed25519" -DryRun
    .\deploy\publish-to-uhost.ps1 -Host "203.0.113.10" -KeyPath "C:\keys\id_ed25519" -ServicePort 8000
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [Alias("Host")] [string]$SshHost,
    [Parameter(Mandatory = $true)] [string]$KeyPath,
    [string]$User = "root",
    [int]$SshPort = 22,
    [int]$ServicePort = 8000,
    [string]$RemoteDir = "/opt/giftwise-validator",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$sshTarget = "$User@$SshHost"
$sshArgs = @("-i", $KeyPath, "-p", "$SshPort", $sshTarget)
$scpArgs = @("-i", $KeyPath, "-P", "$SshPort")

$files = @(
    @{ Local = (Join-Path $repoRoot "validator/rules.py"); Remote = "$sshTarget`:$RemoteDir/validator/rules.py" },
    @{ Local = (Join-Path $repoRoot "deploy/server.py");   Remote = "$sshTarget`:$RemoteDir/deploy/server.py" },
    @{ Local = (Join-Path $repoRoot "deploy/Dockerfile");  Remote = "$sshTarget`:$RemoteDir/deploy/Dockerfile" },
    # N-1 fix (2026-10-31): deploy/Dockerfile now does "COPY deploy /app/deploy", so the image
    # built on the remote host must also receive the two observability modules; otherwise
    # "observability entrypoint shipped inside the image" would not hold for this upload path.
    # NOTE: keep this file pure ASCII - PowerShell 5.1 reads it as ANSI.
    @{ Local = (Join-Path $repoRoot "deploy/observability.py");      Remote = "$sshTarget`:$RemoteDir/deploy/observability.py" },
    @{ Local = (Join-Path $repoRoot "deploy/observable_server.py");  Remote = "$sshTarget`:$RemoteDir/deploy/observable_server.py" }
)

# Publish the container port explicitly as 0.0.0.0:HOSTPORT:8000. The previous revision had
# "-p 0.0.0:$ServicePort`:8000", which expands to the invalid bind address "0.0.0:8000:8000".
$dockerRun = "docker run -d --name giftwise-validator --restart unless-stopped " +
    "-p 0.0.0.0:${ServicePort}:8000 giftwise-validator:local"
$remote = "set -e; cd '$RemoteDir'; " +
    "docker build -t giftwise-validator:local -f deploy/Dockerfile .; " +
    "docker rm -f giftwise-validator 2>/dev/null || true; $dockerRun"

$missing = @($files | Where-Object { -not (Test-Path -LiteralPath $_.Local) })
if ($missing.Count -gt 0) {
    $missing | ForEach-Object { Write-Error "Missing local file: $($_.Local)" }
    throw "Local files incomplete; aborting before any ssh/scp."
}

if ($DryRun) {
    Write-Host "[DryRun] No ssh/scp/docker will be executed. Planned commands:"
    Write-Host "  remote host   : $sshTarget (ssh port $SshPort, key $KeyPath)"
    Write-Host "  remote dir    : $RemoteDir"
    Write-Host "  upload files  :"
    $files | ForEach-Object { Write-Host "    $($_.Local)  ->  $($_.Remote)" }
    Write-Host "  ssh mkdir     : ssh $($sshArgs -join ' ') `"mkdir -p '$RemoteDir/validator' '$RemoteDir/deploy'`""
    $files | ForEach-Object { Write-Host "  scp upload    : scp $($scpArgs -join ' ') $($_.Local) $($_.Remote)" }
    Write-Host "  ssh build/run : ssh $($sshArgs -join ' ') `"$remote`""
    Write-Host "  published port: -p 0.0.0.0:$ServicePort`:8000 (publicly reachable; restrict sources in the security group)"
    Write-Host "  verify        : Invoke-WebRequest http://$SshHost`:$ServicePort/healthz"
    exit 0
}

Write-Host "Preparing remote directory..."
& ssh @sshArgs "mkdir -p '$RemoteDir/validator' '$RemoteDir/deploy'"
if ($LASTEXITCODE -ne 0) { throw "SSH directory preparation failed" }

foreach ($file in $files) {
    Write-Host "Uploading $($file.Local)..."
    & scp @scpArgs $file.Local $file.Remote
    if ($LASTEXITCODE -ne 0) { throw "Upload failed: $($file.Local)" }
}

Write-Host "Building and starting container on UHost..."
& ssh @sshArgs $remote
if ($LASTEXITCODE -ne 0) { throw "Remote Docker deployment failed" }

Write-Host "Deployment command completed. Verify from an allowed network: http://$SshHost`:$ServicePort/healthz"
Write-Host "Keep TCP 22 restricted and allow only the demo sources to reach the published service port."
