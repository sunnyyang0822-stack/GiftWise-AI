# WF-003 版本 #2 发布证据（2026-10-31 00:1x–00:3x）

本轮按 PM 裁决执行：**重新提交并发布为版本 #2**，用 **uuid5** 修掉不可复现，并消耗 **2 次**模型调用做验收。
**未覆盖** `WF-003-2026-10-30/` 里的任何旧文件（发布前已把 v1 整份归档到本目录）。

---

## 0. 结论速览

| 项 | 结论 |
| --- | --- |
| 已发布版本 | **版本 #2**（`version_number: 2`，`hash f20ccdd98f1c3b99cd31989ae71faa49b35a94481521d87fe80b19a8650f6055`） |
| 发布动作 | `POST /console/api/apps/{id}/workflows/publish` → **200** |
| 检查清单 | **「所有问题均已解决」**（版本 #1 时有 2 个阻塞：输出节点变量名必须唯一） |
| 与 `validator/rules.py` 的关系 | **发布时一致**：5 个 Code 节点内嵌 code 的 sha256 与本地生成完全一致、可逐项核对。**Dify 上是快照副本，源码后续若再改动需重新发布才能同步。** |
| 与版本 #1 的语义差异 | **只新增 5 行**（请求侧数值范围检查），5 个 Code 节点内嵌 code 一起变，其余节点、边、端点输出**完全相同** |
| 字节可复现 | **是**：同一份源码连续生成两次，`graph.json`／`graph-llm.json`／`post-graph.js` 三者 sha256 均逐字节相同 |
| 能否回退到版本 #1 | **不能**。本租户无版本回退入口；已归档 v1 整份已发布工作流，可作为**手工重建**依据（不是真回退） |
| 本轮模型调用 | **2 次**（13/16），tokens **2,712**（累计 38,326） |
| 新发现的问题 | 请求侧拒绝**不会短路**，仍会白调一次模型并最终落到 `status: error` / `INVALID_JSON`（见第 6 节） |

---

## 1. 发布前护栏核对

| 护栏 | 做法 | 结果 |
| --- | --- | --- |
| 1. `validator/rules.py` 冻结 | 生成前与发布前各核一次 sha256 | `1f389dad4c2589fb8ddbc31d4e749d27a83ae43de422ee5036155d97d3d1a500`（mtime `2026-10-30 23:11:21`）**两次一致，未被改动** |
| 2. uuid5 替代随机 UUID | `gen-graph-llm.py` 用 `uuid5(固定命名空间, 节点id+角色)` | 导入**成功**（POST 200 + 发布 200），**无需退回旧生成器** |
| 3. 调用硬上限 ≤2 | 演示输入 1 次 + 越界输入 1 次 | **正好 2 次**，未超 |
| 4. 证据写入新目录 | 本目录 | 未覆盖旧目录任何文件 |

**固定的 uuid5 命名空间**（可复核）：

```python
UUID_NS = uuid.uuid5(uuid.NAMESPACE_URL, "https://github.com/sunnyyang0822-stack/GiftWise-AI/workflow")
```

生成的 id 是 **version-5** UUID（第三段以 `5` 开头）：
N2 → `d600d931-e4e4-528d-985e-d9432e4cd55a`、`8fbf1e47-af8f-55b5-8988-946097a20ab7`；
N5 → `9ccf5b96-ae7a-51e7-8c01-3579c116e9cd`、`f3784db6-8af9-5274-bdee-9f8b859ce590`。

---

## 2. 内嵌 code 的 sha256 对照（新值 vs `rules.py`）

`validator/rules.py` 本体的 sha256（UTF-8）：

```
1f389dad4c2589fb8ddbc31d4e749d27a83ae43de422ee5036155d97d3d1a500
```

Dify 上**已发布版本 #2** 的 5 个 Code 节点内嵌 code 的 sha256（与**验收时草稿**逐字节相同）：

| 节点 | 内嵌 code sha256 | 版本 #1 的旧值 |
| --- | --- | --- |
| N1 用户输入与确定性适配 | `aad0052bda8ee9228b2bfc5b42145e4b6f4876782953c0075d548705f14bd9ab` | `90eb050e98ba81bb…` |
| N3 Code 首次校验 | `ec7fbd38b92c1970c412cbd7f246fdf2088e7347f5c304213a0bee23640abe9f` | `34c03054478dc04e…` |
| N6 Code 再校验 | `96d3a1d1f514ae88318e798bd650386ebb18b296afe70a61cfc99e9ad61ad016` | `e37538c8bf83b5a4…` |
| N7a 未修订报告 | `2306f436276030923c2031f53fd43e5b76726ed0bca4c1cfd933e3ef49dd0b54` | `6204d24bda606939…` |
| N7b 修订后报告 | `2306f436276030923c2031f53fd43e5b76726ed0bca4c1cfd933e3ef49dd0b54` | `6204d24bda606939…` |

**怎么核对**：`dify-published-v2-workflow.json` 是发布后的整份工作流，取 `graph.nodes[*].data.code` 的 UTF-8 字节算 SHA-256 即可复现上表。
内嵌 code 前两行固定为：

```
# 自动生成，请修改原文件后重新构建；不要在 Dify 手工维护分叉。
# SOURCE: validator/rules.py
```

> **口径（按 PM 要求）**：本工作流**发布时与 `validator/rules.py` 一致，内嵌 code 的 sha256 可核对**；
> **Dify 上是快照副本，源码后续若再改动需重新发布才能同步**——不写"永远一致"。

---

## 3. 与版本 #1 的语义差异：**新增这 5 行**

`N3 Code 首次校验` 的内嵌 code（v1 → v2）统一 diff，**只有一处 hunks、只增不删**：

```diff
@@ -131,2 +131,7 @@
     days = _days(request["available_days"], "request.available_days", errors) if "available_days" in request else None
+    # 请求侧范围只在调用点检查：_amount/_days 与候选侧共用，范围约束不得进入共用函数。
+    if budget is not None and not (1 <= budget <= 10000):
+        _error(errors, "LIMIT_EXCEEDED", "request.budget_amount", "预算须在 1 至 10000 之间")
+    if days is not None and days > 365:
+        _error(errors, "LIMIT_EXCEEDED", "request.available_days", "可用天数须在 0 至 365 天之间")
     if isinstance(request.get("currency"), str) and request["currency"] != "CNY":
```

**新增 5 行**（注释 1 行 + 判断 2 行 + 报错 2 行），**无删除、无其它改动**。
这 5 行位于共用的规则代码里，因此 N1／N3／N6／N7a／N7b **五个 Code 节点的内嵌 code 一起变**。

其余对比（用 `dify-published-v1-workflow.json` 与 `dify-published-v2-workflow.json` 逐项比）：

| 对比项 | 结果 |
| --- | --- |
| 节点集合（11 个 id） | **完全相同** |
| 边集合（11 条） | **完全相同** |
| 端点 A 输出变量 | `status / all_passed / repair_count / report_json / report_text`（相同） |
| 端点 B 输出变量 | `revised_status / revised_all_passed / revised_repair_count / revised_report_json / revised_report_text`（相同） |
| LLM 节点模型与提示词正文 | **相同**（`deepseek-v4-flash`；`prompt_template[].text` 逐字符相同） |
| LLM 节点 `prompt_template[].id` | **不同**（v1 是随机 uuid4，v2 是 uuid5 —— 这正是本次要修的可复现性问题） |
| 节点 `height`、`viewport` | 不同（Dify UI 自动重算/平移，无功能影响） |

---

## 4. 两次运行的验收证据（本轮的第 12、13 次模型调用）

两次运行都打在**发布前已验证、且发布后 hash 相同的同一份草稿**（`f20ccdd9…`）上。

### 4.1 调用 #1：演示输入（发布前先验草稿）

- 文件：`v2-run1-demo-sse-raw.jsonl`（SSE 原文）、`v2-run1-demo-node-events.json`、`v2-run1-demo-summary.json`
- 节点序列：`用户输入 → N1 → N2 需求分析与三候选（真实 LLM） → N3 Code 首次校验 → N4 校验结果分支 → N7a 未修订报告 → End A 未修订输出`
- **必须确认的"仍产出三候选"** —— 满足：

| 检查 | 结果 |
| --- | --- |
| N2 真实模型节点 | 执行了，`5.245 s`，文本 `1309` 字符 |
| 三候选 | **c1 精品咖啡豆小礼盒 168.00**、**c2 美食体验小份组合 150.00**、**c3 咖啡主题实用小物 180.00** |
| N3 校验 | `status=passed`、`all_passed=true`，`preserved_candidates_json` 键 = `c1/c2/c3` |
| 端点选择集 | `selectable_candidate_ids = ["c1","c2","c3"]`、`selected_candidate_id = null` |
| 禁忌词「巧克力」 | 出现 **0** 次 |
| `LIMIT_EXCEEDED` | **未出现**（预算 200.00 在范围内，符合预期） |
| tokens | **1,514**（prompt 920 / completion 594） |
| 工作流状态 | `succeeded`，`status=passed` |

### 4.2 调用 #2：越界输入 `budget_amount=999999`

- 文件：`v2-run2-boundary-sse-raw.jsonl`、`v2-run2-boundary-node-events.json`、`v2-run2-boundary-summary.json`
- 与演示输入**逐字段相同，只改了 `budget_amount`**，隔离变量。
- **必须确认的 `LIMIT_EXCEEDED`** —— 满足，在**检查节点 N1** 上：

```json
N1 用户输入与确定性适配 → outputs.errors_json =
[{"code":"LIMIT_EXCEEDED","path":"request.budget_amount","message":"预算须在 1 至 10000 之间"}]
```

- 请求侧语义为 `needs_input`（SSE 中出现 5 次）。
- tokens：**1,198**。

### 4.3 调用配额

| 项 | 数值 |
| --- | --- |
| 本轮模型调用 | **2 次**（第 1 次演示输入、第 2 次越界输入） |
| 本轮 tokens | `1514 + 1198` = **2,712** |
| 累计（含前几轮 11 次 / 35,614） | **13 次 / 38,326 tokens** |
| 手上还剩 | **3 次**（上限 16） |
| 第 1 次是否发现问题 | **否**（三候选齐全、校验通过），故按计划使用了第 2 次 |

---

## 5. 字节可复现性结论

**结论：同一份源码连续生成两次，字节已逐字节相同。**

| 产物 | 连续两次运行的 sha256 | 是否相同 |
| --- | --- | --- |
| `graph.json`（接模型之前） | `c6d3dae23ff3650512b465f6be7cd2b9f1e9033275509946933d48358e789c72` | **相同** |
| `graph-llm.json`（待提交的图） | `ad92d232b0d0ae68155e09b189676a5e00c2629e366f5e5d5e85ee798fb202b8` | **相同** |
| `post-graph.js`（实际 POST 的载荷） | `94ac623693105bfbc7d5e775fb728c088a65a69da4345b465b7c3c51cc5cb715` | **相同** |

修复前后对比：**修复前** N2／N5 的 `prompt_template[].id` 由 `uuid4()` 生成，每次运行都不同，导致同一份源码生成的图**字节不确定**（当时只能保证"语义可复现、字节不可复现"）；**修复后**改为 `uuid5(固定命名空间, 节点id + 角色)`，id 稳定，整份图逐字节确定。

---

## 6. 本轮新发现的问题：请求侧拒绝不会短路

越界输入的**验收目标已达成**（`LIMIT_EXCEEDED` 正确发出），但同一份 SSE 也暴露了一个**此前没有证据的设计缺口**：

- `N1` 已经判定请求 `needs_input` 并给出 `LIMIT_EXCEEDED`，**工作流没有停在这里**：
  仍然继续执行了 `N2 需求分析与三候选（真实 LLM）`（`3.901 s`，白耗 **1,198 tokens**），
  然后 `N3` 因为拿不到合法的 `request_json` 而落到 **`INVALID_JSON / request_json`**，
  最终端点 A 输出 `status: "error"`、`all_passed: false`。
- 也就是说：**请求侧校验失败时，用户看到的是 `error`（系统错）而不是 `needs_input`（请补输入）**，而且**多花一次模型调用**。
- 本轮**未修**（改这里要动图的连线/分支逻辑，超出本次"发布 #2"的授权范围）。
  **建议**：要么在 N1 之后按 `status` 分流（`needs_input`/`error` 直接进 N7a 并跳过 N2），
  要么让 `N3` 优先读 `N1` 的结果而不是重解析 `request_json`。**请 PM 决定归属与优先级。**

---

## 7. 回退能力（发布前已报 PM，PM 决定继续）

| 核查项 | 结果 |
| --- | --- |
| 应用内「版本 / 历史 / 恢复 / 回退 / 还原」可交互元素 | **0 个命中**（弹层已展开时全页扫描） |
| `GET /workflows/publish` | 只返回**当前已发布的那一版**，**无版本列表** |
| `/workflows/versions`、`/workflows/draft/versions`、`/workflows/draft/publish` | 405 / 404 / 404 |
| Dify 产品能力 | 版本控制属 **Enterprise** 文档范围（`enterprise-docs.dify.ai`），本租户 cloud.dify.ai **1.18.0** 无该入口 |

**因此：无法回退到版本 #1。** 缓解措施：发布**之前**已把 v1 已发布的整份工作流归档为
`dify-published-v1-workflow.json`（224,862 字节，`version_number: 1`、`hash c6a2c5f3…`），
必要时可重新 POST 该图并发布来**重建** v1 —— 那是**版本 #3 的重建**，**不是真正的回退**。

---

## 8. 本目录文件清单

| 文件 | 说明 |
| --- | --- |
| `dify-published-v1-workflow.json` | **发布前**归档的版本 #1 已发布工作流（回退缓解措施） |
| `dify-published-v2-workflow.json` | 版本 #2 已发布工作流（内嵌 code sha256 的可核对来源） |
| `v2-post-graph-payload.js` | 实际 POST 到草稿的浏览器载荷 |
| `v2-graph-llm-pending.json` | POST 之前的图（本地生成的原始形态） |
| `v2-draft-after-runs-raw.json` | 两次运行之后读回的草稿（用于解释草稿 hash 为何变化） |
| `v2-run1-demo-sse-raw.jsonl` / `v2-run1-demo-node-events.json` / `v2-run1-demo-summary.json` | 调用 #1（演示输入） |
| `v2-run2-boundary-sse-raw.jsonl` / `v2-run2-boundary-node-events.json` / `v2-run2-boundary-summary.json` | 调用 #2（越界输入） |
| `dify-v2-publish-success.png` | 发布成功截图（页头「已发布 几秒前」、弹层 **「# 2」**） |
| `dify-v2-checklist-before.png` | 发布前检查清单（「所有问题均已解决」） |
| `dify-rollback-probe-popover.png` | 回退能力探查截图（弹层内无版本历史入口） |
| `dify-v2-run1-demo.png` / `dify-v2-run2-boundary.png` | 两次运行时的页面截图（运行是经 API 触发的，页面不会变化，**两张相同属预期**；运行证据以上面的 SSE/summary 为准） |
| `tools/summarize-sse.py` | 由 SSE 生成 node-events 与 summary 的离线脚本（纯解析、零模型调用） |
| `materials-stale-publish-claims.md` | PM 要的「未发布 / 未创建版本 / 版本 #1」清单（35 文件 / 172 处 + 分类建议） |

## 9. 怎么复跑

```bash
cd workflow/evidence/WF-003-2026-10-31-publish-v2

# 由 SSE 重新生成 node-events 与 summary（不调用模型）
python -X utf8 tools/summarize-sse.py v2-run1-demo-sse-raw.jsonl demo_forbidden_term_chocolate v2-run1-demo
python -X utf8 tools/summarize-sse.py v2-run2-boundary-sse-raw.jsonl boundary_over_budget_999999 v2-run2-boundary

# 核对版本 #2 内嵌 code 的 sha256（对照第 2 节表格）
python -X utf8 -c "
import json,hashlib
d=json.load(open('dify-published-v2-workflow.json',encoding='utf-8'))
for n in d['graph']['nodes']:
    if (n.get('data') or {}).get('type')=='code':
        print(n['data']['title'], hashlib.sha256(n['data']['code'].encode()).hexdigest())
"
```
