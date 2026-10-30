#requires -Version 7.0
param([string]$OutputPath = '')
$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $stamp = [DateTimeOffset]::UtcNow.ToOffset([TimeSpan]::FromHours(8)).ToString('yyyyMMdd-HHmmss-fff')
    $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $OutputPath = "docs/test-reports/stage-a/evidence/stage-a-$stamp-$suffix.json"
}
Push-Location -LiteralPath $repoRoot
try {
    $head = (& git rev-parse HEAD | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'git rev-parse failed' }
    $status = @(& git status --porcelain=v1 --untracked-files=all)
    if ($LASTEXITCODE -ne 0) { throw 'git status failed' }
    $tracked = @(& git ls-files)
    if ($LASTEXITCODE -ne 0) { throw 'git ls-files failed' }
    $required = @('AGENTS.md', 'docs/product-positioning.md', 'README.md', 'docs/product-requirements.md', 'workflow/workflow-spec.md', 'docs/architecture.md', 'docs/test-plan.md')
    $documents = @(foreach ($p in $required) {
        $exists = Test-Path -LiteralPath $p -PathType Leaf
        $hash = if ($exists) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash } else { $null }
        [ordered]@{ path = $p; exists = $exists; sha256 = $hash }
    })
    $brokenLinks = @(foreach ($p in $tracked) {
        if ($p -notmatch '\.md$') { continue }
        $lineNumber = 0
        foreach ($line in (Get-Content -LiteralPath $p -Encoding UTF8)) {
            $lineNumber++
            foreach ($match in [regex]::Matches($line, '\[[^\]]*\]\(([^)]+)\)')) {
                $target = $match.Groups[1].Value
                if ($target -match '^[a-zA-Z][a-zA-Z0-9+.-]*:|^#') { continue }
                $targetPath = ($target -split '#', 2)[0]
                $resolved = Join-Path (Split-Path -Parent (Join-Path $repoRoot $p)) $targetPath
                if (-not (Test-Path -LiteralPath $resolved)) {
                    [ordered]@{ source = $p; line = $lineNumber; target = $target }
                }
            }
        }
    })
    $excerpts = @(foreach ($p in @('README.md','docs/product-requirements.md','docs/architecture.md','workflow/workflow-spec.md','docs/test-plan.md')) {
        Select-String -LiteralPath $p -Pattern 'Target user:', 'optional packaging', 'Add optional', 'product-positioning', '可信快照校验或服务器重新校验', '尚无快照机制', '仅重检', 'T01–T08' -Encoding UTF8 | ForEach-Object {
            [ordered]@{ source = $p; line = $_.LineNumber; text = $_.Line }
        }
    })
    $exportMetadata = $null
    if (Test-Path -LiteralPath 'Giftwise.ifpkg') {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $archive = [System.IO.Compression.ZipFile]::OpenRead((Join-Path $repoRoot 'Giftwise.ifpkg'))
        try {
            $exportMetadata = [ordered]@{
                path = 'Giftwise.ifpkg'
                bytes = (Get-Item -LiteralPath 'Giftwise.ifpkg').Length
                archive_entry_count = $archive.Entries.Count
                content_reviewed = $false
                note = '仅检查归档元数据，未输出或验证工作流内容、凭证与模型调用。'
            }
        } finally { $archive.Dispose() }
    }
    $record = [ordered]@{
        collected_at = [DateTimeOffset]::UtcNow.ToOffset([TimeSpan]::FromHours(8)).ToString('o')
        time_zone = 'Asia/Shanghai'
        repository = $repoRoot
        head = $head
        powershell_version = $PSVersionTable.PSVersion.ToString()
        git_version = (& git --version | Out-String).Trim()
        initial_status = $status
        tracked_files = $tracked
        required_documents = $documents
        broken_local_markdown_links = $brokenLinks
        conflict_excerpts = $excerpts
        local_export_metadata = $exportMetadata
        business_tests_executed = 0
        scope = '阶段 A 静态仓库证据；非业务、Dify、模型或部署测试结果。'
    }
    $absoluteOutput = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputPath))
    if (-not $absoluteOutput.StartsWith($repoRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Output must stay within repository' }
    if (Test-Path -LiteralPath $absoluteOutput) { throw 'Evidence exists; choose a new OutputPath to preserve prior evidence' }
    New-Item -ItemType Directory -Path (Split-Path -Parent $absoluteOutput) -Force | Out-Null
    $record | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $absoluteOutput -Encoding UTF8
    Write-Output "证据文件：$absoluteOutput"
    Write-Output "HEAD: $head"
    Write-Output "指定文档缺失数：$(@($documents | Where-Object { -not $_.exists }).Count)（AGENTS.md 为可选）"
    Write-Output "本地 Markdown 失效链接数：$($brokenLinks.Count)"
    Write-Output '业务测试执行数：0'
} finally { Pop-Location }
