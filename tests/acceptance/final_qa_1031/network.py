"""专用本地服务与真实 Chromium；固定模拟模式，不访问模型。"""
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT/'docs/test-reports/final-qa-1031/evidence'
ENV = dict(os.environ, GW_MODE='mock', GW_HOST='127.0.0.1', GW_PORT='19437',
           GW_BASE='http://127.0.0.1:19437', GW_CDP='http://127.0.0.1:9439',
           GW_OUT=str(OUT/'browser'), GW_QA_OUT=str(OUT/'http'))
ZONE = dt.timezone(dt.timedelta(hours=8))
record = {'release_sha':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT).decode().strip(),
          'mode':'mock','base':ENV['GW_BASE'],'cdp':ENV['GW_CDP'],'runs':[]}

def save():
    (OUT/'network-summary.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')

def wait(url):
    for _ in range(100):
        try:
            with urllib.request.urlopen(url,timeout=1) as r:
                return r.read().decode()
        except Exception:
            time.sleep(.15)
    raise RuntimeError('专用服务未就绪: '+url)

def run(name,cmd,extras=None,timeout=90):
    start = dt.datetime.now(ZONE).isoformat()
    with (OUT/(name+'.stdout.txt')).open('wb') as stdout, (OUT/(name+'.stderr.txt')).open('wb') as stderr:
        try:
            proc=subprocess.run(cmd,cwd=ROOT,env={**ENV,**(extras or {})},stdout=stdout,stderr=stderr,timeout=timeout)
            code=proc.returncode
        except subprocess.TimeoutExpired:
            code='TIMEOUT'
    record['runs'].append(dict(name=name,command=cmd,env={k:v for k,v in ENV.items() if k.startswith('GW_')},
        extras=extras,started=start,finished=dt.datetime.now(ZONE).isoformat(),exit_code=code))
    save()
    print(name,code,flush=True)

server=None
browser=None
try:
    # 绝不复用旧服务；监听前失败会使本轮中断。
    import socket
    for port in (19437,9439):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',port))
    with (OUT/'server.stdout.txt').open('wb') as so, (OUT/'server.stderr.txt').open('wb') as se:
        server=subprocess.Popen(['node','web/server/server.mjs'],cwd=ROOT,env=ENV,stdout=so,stderr=se,
                                creationflags=subprocess.CREATE_NO_WINDOW)
    record['server_pid']=server.pid
    record['health']=json.loads(wait(ENV['GW_BASE']+'/healthz'))
    run('http-legacy',['node','web/tools/smoke-http.mjs'])
    run('http-revision',['node','tests/acceptance/nov01_revision/http-revision.mjs'])
    chrome=Path('C:/Program Files/Google/Chrome/Application/chrome.exe')
    with (OUT/'chrome.stdout.txt').open('wb') as co, (OUT/'chrome.stderr.txt').open('wb') as ce:
        browser=subprocess.Popen([str(chrome),'--headless=new','--disable-gpu','--no-first-run',
             '--no-default-browser-check','--remote-debugging-port=9439',
             '--user-data-dir='+str(OUT/'chrome-profile'),'about:blank'],cwd=ROOT,stdout=co,stderr=ce,
             creationflags=subprocess.CREATE_NO_WINDOW)
    record['browser_pid']=browser.pid
    record['browser_version']=json.loads(wait(ENV['GW_CDP']+'/json/version'))
    run('browser-legacy',['node','web/tools/browser-check.mjs'],timeout=45)
    run('browser-revision',['node','web/tools/browser-check.mjs'],{'GW_REVISION_QA':'1'},timeout=90)
except Exception as e:
    record['infrastructure_error']=repr(e)
    raise
finally:
    for child in (server,browser):
        if child is not None:
            child.terminate()
            try:child.wait(timeout=5)
            except subprocess.TimeoutExpired:child.kill()
    save()
