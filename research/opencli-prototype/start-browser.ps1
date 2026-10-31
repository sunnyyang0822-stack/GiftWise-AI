$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskProfile = Join-Path $taskRoot '.tmp/retrieval-chrome'
if (Get-NetTCPConnection -LocalPort 19359 -State Listen -ErrorAction SilentlyContinue) { throw '端口19359已占用，请确认属于本任务专用浏览器；不会连接未知浏览器。' }
$browser = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
Start-Process -FilePath $browser -ArgumentList '--headless=new','--remote-debugging-address=127.0.0.1','--remote-debugging-port=19359',("--user-data-dir=" + $taskProfile),'--no-first-run','about:blank' -WindowStyle Hidden
