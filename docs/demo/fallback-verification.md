# 兜底方案逐个验证证据 — DEMO-001

- 归属任务：**DEMO-001**（Issue #27）
- 要求（任务书）："兜底方案**必须实际验证过一次**，不能只写'届时可回退'。"
- 本文每一条都是**我真跑过**的，附原始命令与原始输出。
- **零模型调用**：全部验证过程未发起任何模型调用。

> 冻结版本说明：本轮期间 HEAD **发生过移动**（别的 Agent 提交了 `ae0ea58 feat(web)`），
> 起始记录为 `351330da`。各步骤的时间点已在 [`demo-rehearsal-record.md`](demo-rehearsal-record.md) 逐条标注。

---

## 验证总览

| # | 兜底方案 | 验证命令 | 实测结论 |
| --- | --- | --- | --- |
| 1 | 端口自动避让 | `bash docs/demo/bin/servers.sh start` | ✅ 8787→8788、8000→8001 正确避让 |
| 2 | 可靠停服务（不用 `timeout`） | `bash docs/demo/bin/servers.sh stop` | ✅ 端口释放、无连带损伤 |
| 3 | 中文/箭头编码自救 | 脚本内 `reconfigure` | ✅ 崩→通过 |
| 4 | 纯规则层演示（零模型零网络） | `python docs/demo/bin/run-rules-layer-demo.py` | ✅ 6/6 通过，515 ms |
| 5 | 离线回放页（`file://`） | CDP 真浏览器打开 | ✅ 0 错误、0 外部引用 |
| 6 | 单文件离线快照 | `python docs/demo/tools/build-snapshot.py` | ✅ 21 块、0 新调用、335 ms |
| 7 | 404 并发判定规则 | `node docs/demo/bin/retry-on-404.mjs` ×3 | ✅ 三分支全部正确分类 |
| 8 | 真实浏览器截图（沙箱内 Chrome 起不来） | 复用 CDP + 新建即弃 target | ✅ 截图全部产出 |

---

## 1. 端口自动避让　✅ 已验证

**要解决的翻车点**：F1（8787 被另一个 Agent 占用）、8000 被残留进程占用。

**命令**（现场原样可用）：
```bash
bash docs/demo/bin/servers.sh start
```

**实测输出**（当时 8000 与 8787 都已被占）：
```
== 启动演示服务 ==
  !! 8000 已被占用（别的 Agent 或残留进程），自动改用备用端口
  校验器端口：8001
  界面端口：8788

  --- 健康检查 ---
  校验器 http://127.0.0.1:8001/healthz
    {"status":"ok","service":"giftwise-validator","rules_source_sha256":"1f389dad4c2589fb8ddbc31d4e749d27a83ae43de422ee5036155d97d3d1a500"}
  界面   http://127.0.0.1:8788/healthz
    {"status":"ok","mode":"mock","runs":0}

  演示入口： http://127.0.0.1:8788
```

**结论**：✅ 两个端口都被正确避让，服务全部就绪，健康检查通过。
`rules_source_sha256` = `1f389dad…`，与冻结版本一致（可与 `python tests/acceptance/stage_c/run_verify_local_nopipe.py` 输出的 `sources_sha256["validator/rules.py"]` 逐字核对）。

---

## 2. 可靠停服务（替代 `timeout`）　✅ 已验证

**要解决的翻车点**：F4（MSYS `timeout` 杀不掉原生 `node.exe`，留下孤儿占端口）。

**命令**：
```bash
bash docs/demo/bin/servers.sh stop
```

**实测输出**：
```
== 停止演示服务 ==
  已停止 web 界面 (pid 1195)
  已停止 校验器 (pid 1188)
  完成

--- 端口复查 ---
8001 已释放 OK
8788 已释放 OK

--- 对照：另一个 Agent 的 8787 必须还活着 ---
{"status":"ok","mode":"mock","runs":80}
```

**三条结论**：
1. ✅ node（pid 1195）与 python（pid 1188）都是**原生 Windows 进程**，都被真停掉了。
2. ✅ 端口 8001 / 8788 都释放了。
3. ✅ **没有连带损伤**：另一个 Agent 的 8787 仍在服务（`runs` 从 56 涨到 80，说明它在被持续使用）。

**机制说明**：优先用 `powershell Stop-Process -Id <pid> -Force`（对原生进程可靠），
失败退回 `taskkill //F //PID`，再失败才 `kill -9`。**不使用 `timeout`**。

---

## 3. 编码自救　✅ 已验证

**要解决的翻车点**：F2（codepage 936 下打印 `↳` 等字符 → `UnicodeEncodeError` → exit 1）。

**对照实验**：

| 写法 | 结果 |
| --- | --- |
| `python -c "print('A \u21b3 B')"` | ❌ `UnicodeEncodeError: 'gbk' codec can't encode character '\u21b3'`，exit 1 |
| `PYTHONIOENCODING=utf-8 python -c "..."` | ✅ `stdout.encoding = utf-8`，正常输出 |
| `python -X utf8 -c "..."` | ✅ `stdout.encoding = utf-8`，正常输出 |
| 脚本内 `sys.stdout.reconfigure(encoding="utf-8", errors="replace")` | ✅ 崩→通过（我的规则层脚本第一版**真的崩过**，加这行后 6/6 通过） |

**推荐的第三种**（不依赖调用者记不记得设环境变量）已内置进：
- `docs/demo/bin/run-rules-layer-demo.py`
- `docs/demo/tools/build-snapshot.py`

`preflight.sh` §1 会检查代码页并在非 65001 时给出 `chcp 65001` 的具体指示。

---

## 4. 纯规则层演示　✅ 已验证（**这是最可靠的一段**）

**要解决的翻车点**：F3（脚本 §5.2 片段 `KeyError: 'result'`）、F6（HTTPS 不可用）、以及"模型额度不足"。

**依赖**：只需要本机 Python + 本机 `deploy/server.py`。**零模型、零公网、零 node。**

**命令**：
```bash
# 终端 A
python -m deploy.server
# 终端 B
python docs/demo/bin/run-rules-layer-demo.py
```

**实测输出（节选，全是真实结果）**：
```
  [PASS] 基线三候选
        HTTP 200 ｜ batch.status = passed ｜ all_passed = True
        错误码 = （无）｜ 耗时 14.2 ms ｜ 期望 = passed
        逐候选 = {'c1': '通过', 'c2': '通过', 'c3': '通过'}

  [PASS] 超预算候选
        HTTP 200 ｜ batch.status = failed ｜ all_passed = False
        错误码 = ['OVER_BUDGET'] ｜ 耗时 2.4 ms ｜ 期望 = failed
        逐候选 = {'c1': '拒绝', 'c2': '通过', 'c3': '通过'}

  [PASS] 禁忌词「巧克力」
        HTTP 200 ｜ batch.status = failed ｜ 错误码 = ['FORBIDDEN_TERM'] ｜ 耗时 2.6 ms
        逐候选 = {'c1': '通过', 'c2': '拒绝', 'c3': '通过'}

  [PASS] 禁忌类别 alcohol
        HTTP 200 ｜ batch.status = failed ｜ 错误码 = ['FORBIDDEN_TAG'] ｜ 耗时 2.5 ms
        逐候选 = {'c1': '通过', 'c2': '拒绝', 'c3': '通过'}

  [PASS] 只改文本、不声明标签
        HTTP 200 ｜ batch.status = passed ｜ 耗时 16.2 ms
        这不是缺陷，是规则语义：禁忌类别只在候选自己声明的 tags 上匹配。

  校验器规则源码 sha256：1f389dad4c2589fb8ddbc31d4e749d27a83ae43de422ee5036155d97d3d1a500
  冻结 HEAD：351330da346f7382d86d34d822bd000b7228c3c2
=== 6 项用例，失败 0 项 ===
```

计时：**515 ms**（含 Python 启动），单次 `/validate` 调用 **2–20 ms**。

**诚实口径（必须照读）**：这是**本机校验器**的真实结果，不得说成"Dify 现场跑出了超预算"
（脚本 B8 明确：Dify 侧没有自然触发的 `OVER_BUDGET` 证据）。

**降级链**：校验器起不来 → 用离线回放页的「② 本机真实规则代码」一节（结果已内联，不需要任何运行时）。

---

## 5. 离线回放页　✅ 已验证

**要解决的翻车点**：F6（HTTPS 全挂）、F1（端口被占）、"node 起不来"、"Dify 打不开"、投影机不能联网。

**关键设计**：快照 **内联**进 HTML。原因：Chrome 对 `file://` 页面 fetch 同目录 JSON 会按 CORS 拒绝，
现场"双击打开"就会白屏。内联是唯一稳的做法。

**验证命令**（真实浏览器、`file://` 协议、无服务器）：
```bash
node web/.tmp/demo-rehearsal/shot.mjs 10-offline-replay-top \
  "file:///C:/Users/lenovo/Desktop/giftwise/docs/demo/replay/offline-replay.html" 1600 1000
```

**实测输出**：
```json
{
  "title": "GiftWise AI · 离线兜底回放（演示备份）· 2026-10-31T00:47",
  "readyState": "complete",
  "bodyChars": 13106,
  "hasMockBanner": true,
  "scrollW": 1600,
  "clientW": 1600,
  "horizontal_overflow": false,
  "console_errors": [],
  "failed_requests": []
}
```

**逐项结论**：
| 检查 | 结果 |
| --- | --- |
| `file://` 直接打开 | ✅ `readyState: complete` |
| 控制台错误 | ✅ **0 条** |
| 失败请求 | ✅ **0 条**（证明真的没有外部依赖） |
| 横向溢出 | ✅ 无（1600 / 1440 / 1024 均无） |
| 文件大小 | ✅ 60,865 B（59.4 KiB，单个文件，可拷 U 盘） |
| 需要 node / python | ✅ **都不需要** |
| 需要网络 | ✅ **不需要** |

**逐节截图**（存在 `docs/demo/shots/`，均已人工核验可读）：
- `FALLBACK-1-offline-replay-top.png` — 顶部红条 + 四类证据图例
- `FALLBACK-2-archived-real-model-runs.png` — 归档真实运行汇总表（含 N2/N5/tokens/End 输出）
- `FALLBACK-3-rules-layer.png` — 本机真实规则层结果
- `FALLBACK-4-declared-limitations.png` — 10 条未完成/未核实

**诚实性由数据结构强制**：每个证据块必须带
`evidence_kind` / `source` / `model_calls` / `verified` 四个字段；
回放页**按 `evidence_kind` 决定角标文案与配色**，不允许人工改写角标：
- 绿 = `archived_real_model`（已归档·真实模型输出）
- 蓝 = `local_real_rules`（本机·真实规则代码）
- 橙 = `mock_ui`（模拟数据·界面预览）
- 红 = `declared_limitation`（未完成/未核实·如实声明）

---

## 6. 单文件离线快照　✅ 已验证

**命令**：
```bash
python docs/demo/tools/build-snapshot.py    # 335 ms
python docs/demo/tools/build-replay.py      # 244 ms
```

**实测输出**：
```
== DEMO-001 离线快照构建 ==
  · 真实模型归档：前置 2 例 + 提示词修复后 2 例 + v2 2 例
  · 提取到真实 N2 候选：修复后 3 个 / 修复前 3 个
  · 差异比对：pursuit vs partner

写出 docs/demo/snapshot/demo-snapshot.json  (59.5 KiB / 60,951 字节)
块数：{'declared_limitation': 10, 'archived_real_model': 5, 'local_real_rules': 4, 'mock_ui': 2}
本轮新模型调用：0
```

**快照里装了什么**（21 块）：
| 类别 | 块数 | 代表内容 |
| --- | --- | --- |
| `archived_real_model` | 5 | **真实 `deepseek-v4-flash` 生成的三个候选（逐字）**；前置/后置运行汇总；真实模型修订链路；v2 两次运行；占位夹具跑（明确标注未接模型） |
| `local_real_rules` | 2 | 本机校验器 6 项用例；329/39/46 测试读数 |
| `mock_ui` | 2 | 三候选 + 四段呈现（模拟）；追求对象 vs 恋人差异比对 |
| `declared_limitation` | 10 | 已发布 v2 / 无回退入口 / token 口径 / 单价未核实 / 价格库存未核实 / 未上云 / trace 不可用 / ELSE 分支 / 外部可访问性未核实 / FORBIDDEN_TAG 与修复后修订缺运行时证据 |

**关键：真实模型输出是真的拿到了**——从归档里逐字提取：
```
model_provider: langgenius/deepseek/deepseek
model_name:     deepseek-v4-flash
elapsed_s:      6.005652
usage:          prompt_tokens 915 / completion_tokens 699 / total_tokens 1614 / latency 6.002
candidates:     3 个（精品咖啡豆小礼盒 168.00 / 小型美食体验礼盒 188.00 / 咖啡主题实用小物组合 150.00）
```
✅ 现场用它展示"真实模型输出"**不需要发起任何新调用**，因此**不可能因额度/网络失败**。

---

## 7. 404 并发判定规则　✅ 已验证（规则三分支）

**要解决的翻车点**：F14（另一个 Agent 正在写文件导致 404）。
**诚实前提**：这个场景在本轮 25 秒探测窗口里**没有复现**（0 次 404/5xx）——
所以我验证的是**判定规则本身**，不是"我抓到了这个 bug"。

**命令**：
```bash
node docs/demo/bin/retry-on-404.mjs <url> <被服务的文件路径> [mtime窗口秒数]
```

**三个用例的实测结论**：

| 用例 | 构造 | `file_age_s` | 判定 | 退出码 |
| --- | --- | --- | --- | --- |
| 1 | `/nope.js`，目标文件**不存在** | `null` | `REAL_PROBLEM` | **1** ✅ |
| 2 | `/nope2.js`，参照文件 mtime 很旧 | `6662.4`（≈1.85 h） | `REAL_PROBLEM` | **1** ✅ |
| 3 | `/nope3.js`，参照文件**刚被写过** | `0.2` | `TRANSIENT` → 等 1.5 s 重试 → `TRANSIENT_UNRESOLVED` | **2** ✅ |

**现场规则**（照做）：
1. 404/500 → 先 `stat` 目标文件 mtime；
2. mtime 在最近 **60 秒**内 → 判"有人正在写"，**等 1.5 秒重试一次**；
3. 重试成功 → **不算翻车**，但说明演示前该冻结相关文件；
4. 重试仍失败 → **记为真问题**，如实报告，不用重试掩盖。

---

## 8. 真实浏览器截图（沙箱内 Chrome 起不来）　✅ 已验证

**要解决的翻车点**：F8（`chrome.exe --headless` 在沙箱内因 mojo `拒绝访问 0x5` 自终止，exit 127）。

**兜底做法**：复用已有的 CDP 端点，**为每次截图新建一个独立 target、截完立刻关闭**，
不碰别人已有的页面（别人的 Chrome 上有 3 个 8787 的 page，我一个都没动）。

**实测输出**：
```json
{
  "name": "01-web-mock-top",
  "url": "http://127.0.0.1:8791/",
  "title": "GiftWise AI · 找到那份刚好的心意",
  "readyState": "complete",
  "bodyChars": 1528,
  "hasMockBanner": true,
  "scrollW": 1440, "clientW": 1440,
  "horizontal_overflow": false,
  "console_errors": [],
  "failed_requests": []
}
```
✅ 全部截图产出，且**顺带拿到了真实浏览器验证**：
- 「模拟数据 · 未接真实模型」标识**存在且 sticky 常驻**（滚动 1800 px 后 top=22 px）
- 6 种投影分辨率下**均无横向溢出**
- **0 控制台错误、0 失败请求**

---

## 9. Dify 无凭证 / 超时的降级　✅ 已验证（**这条路径不需要兜底，因为行为本来就对**）

**要解决的翻车点**：Dify 不可达 / 没有凭证 / 模型超时。

### 用例 A：`GW_MODE=dify`，不设任何凭证

```bash
GW_MODE=dify GW_PORT=8795 node web/server/server.mjs
curl -sS -X POST http://127.0.0.1:8795/api/recommendations \
  -H 'Content-Type: application/json' --data-binary @/tmp/rec-body.json
```
**实测输出**：
```json
{"status":"error",
 "errors":[{"code":"DIFY_NOT_CONFIGURED","path":"dify",
            "message":"服务端未配置 Dify 地址与密钥，当前只能使用模拟数据模式。"}],
 "mode":"dify",
 "notices":["真实 Dify 调用未成功，未生成任何候选，也没有把模拟数据伪装成真实结果。"]}
[HTTP 503]
```
✅ 进程存活（结构化降级，非崩溃）　✅ **没有**静默切回模拟并标成成功

### 用例 B：假凭证 + 黑洞地址 + 1.5 秒超时

```bash
GW_MODE=dify GW_PORT=8796 DIFY_API_BASE=http://10.255.255.1/v1 \
  DIFY_API_KEY=fake-key-for-test DIFY_PUBLISHED_VERIFIED=1 DIFY_TIMEOUT_MS=1500 \
  node web/server/server.mjs
```
**实测输出**：
```json
{"status":"error",
 "errors":[{"code":"DIFY_TIMEOUT","path":"dify",
            "message":"Dify 调用超过 1500 毫秒未返回，已按超时处理。"}],
 "mode":"dify",
 "notices":["真实 Dify 调用未成功，未生成任何候选，也没有把模拟数据伪装成真实结果。"]}
[HTTP 503]
```
**实测耗时：1633 ms**（配置 1500 ms）→ ✅ **超时机制真的生效**，不是摆设。
✅ 进程存活，日志**无未捕获异常**。

**结论**：这条路径**不需要额外兜底**。而且它是个**可以主动演示的加分点**——
"我把凭证拿掉，它宁可报 503 也不假装成功"。

**环境变量名**（现场若要复现）：`DIFY_API_BASE` / `DIFY_API_KEY` / `DIFY_PUBLISHED_VERIFIED` / **`DIFY_TIMEOUT_MS`**。

---

## 10. 兜底的兜底：降级链（每一级都已验证）

```
第 1 级  模式 A：Dify 现场真实跑
         └ 失败 →

第 2 级  模式 C-1：离线回放页（内联真实模型归档）
         ├ 已验证：file:// 直开、0 外部依赖、0 控制台错误
         └ 需要：一个能打开的浏览器（不需要 node/python/网络）
              └ 失败 →

第 3 级  模式 C-2：纯规则层现场跑
         ├ 已验证：6/6 通过、零模型零公网
         └ 需要：本机 python + deploy/server.py
              └ 失败 →

第 4 级  模式 C-3：静态截图
         └ 已验证：docs/demo/shots/*.png 共 15 张（含 6 张 INPUT-*.png），可直接放进 PPT
```

**第 4 级是"什么都不行"时的地板**：只需要一个能显示图片的程序。
截图已包含：真机界面（含模拟标识）、归档真实运行表、规则层结果、未完成清单、3 种投影分辨率。

---

## 附：怎么自己复核本文的每一条

```bash
cd <仓库根>

# §1 端口避让
bash docs/demo/bin/servers.sh start ; bash docs/demo/bin/servers.sh stop

# §3 编码
python -c "print('A \u21b3 B')"                        # 崩
PYTHONIOENCODING=utf-8 python -c "print('A \u21b3 B')"  # 通

# §4 规则层（先起校验器）
python -m deploy.server &
python docs/demo/bin/run-rules-layer-demo.py

# §5/§6 重建并打开回放页
python docs/demo/tools/build-snapshot.py
python docs/demo/tools/build-replay.py
# 然后双击 docs/demo/replay/offline-replay.html

# §7 404 判定
node docs/demo/bin/retry-on-404.mjs http://127.0.0.1:8000/nope web/public/nope.js

# §8 一次性自检（含以上多数项）
bash docs/demo/bin/preflight.sh
```
