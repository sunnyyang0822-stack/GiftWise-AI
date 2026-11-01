# 组装最终提交包：以 input 为底，应用 submission 文字与源码，放入新 PPT/PDF/架构三源；生成清单与 zip。
import shutil, os, hashlib, json, zipfile
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(BASE)
F = 'final'
ASSEMBLE = os.environ.get('ASSEMBLE') == '1'  # 首次组装才从 submission/input 复制；之后只重算清单与 zip
for root, _, fs in (os.walk('submission') if ASSEMBLE else []):
    for f in fs:
        src = os.path.join(root, f); rel = os.path.relpath(src, 'submission')
        if rel == 'README.md': continue
        dst = os.path.join(F, rel); os.makedirs(os.path.dirname(dst), exist_ok=True); shutil.copy2(src, dst)
for rel in (['02-提交材料/规则依据/AI比赛评分规则-v2.md'] if ASSEMBLE else []):
    dst = os.path.join(F, rel); os.makedirs(os.path.dirname(dst), exist_ok=True); shutil.copy2(os.path.join('input', rel), dst)
README = """# GiftWise AI 答辩与提交材料

先打开这三份：

- [答辩PPT](01-答辩材料/GiftWise-AI-答辩.pptx)（8页；[PDF](01-答辩材料/GiftWise-AI-答辩.pdf)）
- [演讲稿：5分钟](演讲稿-5分钟.md)
- [答辩问答：30题](答辩问答-30题.md)

公网入口：http://117.50.83.57/ （仅 HTTP；平台北京时间 2026-11-03 05:11 定时关机）。

- 运行版本：19b6819fe80787717571beb7cc0d17f89587c2d9（部署 PR #125 尚未合并）
- 部署证据：6e92a9e076d5989f7ad510bebf3639a9dd2dadf8 —— https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/6e92a9e076d5989f7ad510bebf3639a9dd2dadf8/docs/deployment/2026-11-01/REPORT.md
- 材料底板：4a35e18373e5225829f3d17d32ad97afc0bd8b09

`01-答辩材料` 含 3 分钟 Demo 脚本与架构图 PNG/SVG/drawio；`02-提交材料` 含正式 10 页系统架构设计 PDF、七份专项、代码快照、变更声明、评分规则原件。全文件 SHA256 见 `02-提交材料/版本与文件清单.json`。
"""
if ASSEMBLE: open(os.path.join(F, 'README.md'), 'w', encoding='utf-8').write(README)
MAN = '02-提交材料/版本与文件清单.json'
files = []
for root, _, fs in os.walk(F):
    for f in fs:
        p = os.path.join(root, f); rel = os.path.relpath(p, F).replace(os.sep, '/')
        if rel == MAN: continue
        b = open(p, 'rb').read()
        files.append({'path': rel, 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()})
files.sort(key=lambda x: x['path'])
manifest = {'change_number': 8, 'generated_for': 'codex/materials-deployment-final-20261101',
            'versions': {'deploy_run': '19b6819fe80787717571beb7cc0d17f89587c2d9', 'deploy_evidence': '6e92a9e076d5989f7ad510bebf3639a9dd2dadf8',
                         'materials_base': '4a35e18373e5225829f3d17d32ad97afc0bd8b09', 'qa_base': 'eceef056', 'cost_analysis': '1a6a49bf5f51454a5541d4fce03e90d1f15d6113'},
            'entry': 'http://117.50.83.57/', 'files_count': len(files), 'files': files}
json.dump(manifest, open(os.path.join(F, MAN), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
out = os.path.join('work', 'GiftWise-AI-答辩与提交材料-2026-11-01.zip')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, fs in os.walk(F):
        for f in fs:
            p = os.path.join(root, f); z.write(p, os.path.join('GiftWise-AI-答辩与提交材料-2026-11-01', os.path.relpath(p, F)))
print('files', len(files) + 1); print(out, os.path.getsize(out), hashlib.sha256(open(out, 'rb').read()).hexdigest())
for x in files: print(x['path'], x['bytes'])
