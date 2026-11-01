# 修复独立复核 F1–F4：专项附录把旧版本写成“当前”、部署更新说明结尾、30题第18题与章节编号。
import os, re, hashlib
BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'final')
SP = os.path.join(BASE, '02-提交材料', '专项材料')
CURRENT = '当前版本见本文开头：运行 19b6819、证据 6e92a9e、公网 http://117.50.83.57/（仅 HTTP，Compshare 单实例），随附源码 ZIP 对应 19b6819。'
HIST_VER = ('> **历史版本边界（原 8903 演示环境采样时点，非当前公网版本）**：当时运行工作区为 `eeefe74` 加三份提示词覆盖，'
            '源码快照 `9887572`；候选 `307c5eb` 当时未切换，其隔离测试的生图任务没有成功图片记录。' + CURRENT)
HIST_DATA = ('> **历史数据边界（原演示环境）**：当时为本地库优先、缺少匹配时可选浏览器补抓。'
             '当前公网主链路为模型调用检索工具，匿名 HTTP 获取公开文字并复用合法历史缓存，再由模型形成三方案。')
changed = {}
def edit(path, fn):
    s = open(path, encoding='utf-8').read(); t = fn(s)
    if t != s: open(path, 'w', encoding='utf-8').write(t); changed[path] = True
def common(s):
    lines = s.split('\n'); out = []
    for ln in lines:
        if ln.startswith('> **当前版本与证据边界（2026-11-01）**'): ln = HIST_VER
        elif ln.startswith('> **数据与运行边界**：本地库优先'): ln = HIST_DATA
        elif ln.startswith('> **本次整理的时点说明（2026-11-01）**'):
            ln = re.sub(r'当前冻结工作区、快照9887572与未切换候选307c5eb见上方声明，不能仅凭旧基线提交复现三份提示词覆盖。',
                        '原冻结工作区、快照9887572与候选307c5eb见上方历史说明。' + CURRENT, ln)
        out.append(ln)
    return '\n'.join(out)
for f in ['Agent执行流程-2026-11-01.md', 'Demo与代码仓库-2026-11-01.md', '可观测性证据-2026-11-01.md', '异常处理说明-2026-11-01.md', '场景与价值分析-2026-11-01.md', '成本与性能分析-2026-11-01.md']:
    edit(os.path.join(SP, f), common)
def agent(s):
    s = s.replace('## 当前架构图与版本范围', '## 架构图与版本范围')
    s = re.sub(r'当前P04与架构三源描述集成提交`0ad650b3ce7af8fc6679a7c66c20f9e8a57e49e6`：.*?现场与随附源码ZIP仍对应9887572。',
               'P04 与架构三源描述实际部署版本 `19b6819`（Compshare 单实例，Nginx :80 → Node 24.16 @127.0.0.1:8787，systemd）：规则推导风格、文本模型润色，选择后文字先返回，后台生图并由GET查询补图，媒体任务与产物落盘；随附源码ZIP对应19b6819。', s, flags=re.S)
    s = s.replace('商品数据按需增强，已确认上下文', '模型调用检索工具获取公开文字素材并复用合法历史缓存，已确认上下文')
    return s
edit(os.path.join(SP, 'Agent执行流程-2026-11-01.md'), agent)
def demo(s):
    s = re.sub(r'^> \*\*一句话结论\*\*：.*$', '> **历史结论（原采样时点）**：当时本机 `127.0.0.1:8903` 运行五步链路，可用只读 `curl` 复验；当时尚未云端部署，`deploy/Dockerfile` 只打包确定性规则 API，`compose/**` 与 `compose/k8s/**` 为示例写法。' + CURRENT, s, flags=re.M)
    s = s.replace('以及「本地已验证 / 云端未部署」的逐条边界。', '以及原采样时点「本地已验证 / 云端未部署」的逐条边界（历史）。')
    s = s.replace('## 1. 结论总览：哪些「已验证」、哪些「未部署」', '## 1. 历史结论总览（原采样时点）：哪些「已验证」、哪些「未部署」')
    s = s.replace('1. **云端未部署（最高频被问穿的一条）**', '1. **（历史）当时云端未部署——当前已在 Compshare 公网部署，见本文开头**')
    return s
edit(os.path.join(SP, 'Demo与代码仓库-2026-11-01.md'), demo)
edit(os.path.join(SP, '系统架构设计-部署更新说明.md'), lambda s: s.replace(
    '正式10页设计PDF仍在input；按ARCHITECTURE-CHANGES.md逐页同步，当前不把旧PDF当作已更新。',
    '正式10页设计PDF已按ARCHITECTURE-CHANGES.md逐页同步为 v2.0 部署版（部署版本 19b6819），见同目录 GiftWise-AI-系统架构设计.pdf；架构图三源见 01-答辩材料/架构图。'))
def qa(s):
    s = s.replace('这些改进尚未切到冻结现场版，因此展示和回答都要说明是哪一版。',
                  '这些检查属于候选浏览器验收记录；当前公网运行版本为 19b6819，公网完整浏览器点击闭环尚未独立验收。')
    if '## 三 ' not in s: s = s.replace('### 11 这条任务链为什么按现在的顺序拆分', '## 三 任务链与可信边界\n\n### 11 这条任务链为什么按现在的顺序拆分')
    return s
edit(os.path.join(BASE, '答辩问答-30题.md'), qa)
for p in sorted(changed):
    print(os.path.relpath(p, BASE).replace(os.sep, '/'), hashlib.sha256(open(p, 'rb').read()).hexdigest())
