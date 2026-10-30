# WF-003 可入库验证脚本

## 为什么有这个目录

原始脚本都在 `workflow/tools/`，而该目录的 `.gitignore` 是 `*`（整目录不入库），
所以 WF-003 报告里引用的脚本**别人拿不到、跑不了**。本目录是它们的**可入库副本**，
由 `workflow/tools/gen-includable-tools.py` 生成（幂等，可反复运行）。

副本只改了 **ROOT 解析**（改为向上查找仓库根，因此**在任何 cwd 下都能跑**）、
**输入目录**（`inputs/`）、**输出目录**（`build/`、`outputs/`），业务逻辑未改。

**有意不复制**：`gh-cred.py`（凭证）、`dify-runner.cjs` 与 `lib/*.js`
（浏览器自动化，依赖作者本机已登录的 Dify 会话与浏览器档案）、以及需要 GitHub 凭证的 Issue 脚本。

> ⚠️ **重要局限**：这些脚本复现的是**当前仓库源码**的结果。
> 2026-10-30 23:04 发布到 Dify 的那份图内嵌的是**当时**的 `validator/rules.py`；
> 该文件在 **23:11** 被另一条线修改（新增请求侧数值范围检查）。
> 因此重新生成会得到**比已发布版本新 5 行**的图 —— 详见 `../WF-003-2026-10-30.md` 第 13 节。

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `demo-local-verify.py` | **零模型调用**验证：直接调用与 Dify 节点相同的入口函数 |
| `parse-runs.py` | 把浏览器运行器的原始输出解析成节点级事件 |
| `run-table.py` | 压成可核对的对照表（含 N2 耗时／字符数／tokens） |
| `gen-node-io.py` | 生成节点级输入输出逐字附录 |
| `capture-wf003-real.py` | 真实模型运行的一整套证据归档 |
| `capture-wf003.py` | 无模型阶段的证据归档 |
| `gen-graph.py` | 生成 Dify 图（接模型之前） |
| `gen-graph-llm.py` | 把图转成真实 LLM 节点版 |
| `gen-demo-run.py`／`gen-real-run.py` | 生成浏览器运行脚本 |
| `inputs/` | **复跑所需输入快照**（入库） |
| `build/`、`outputs/` | 运行副产物（由 `.gitignore` 排除） |

`inputs/graph.json` = **实际部署到 Dify 的那份图**（含真实 LLM 节点标题）；
`inputs/graph-pre-llm.json` = 接模型之前的图，用于验证生成器确定性。

## 可照抄的命令行

在**仓库根目录**（或任何目录，路径解析不依赖 cwd）执行：

```bash
# ① 零模型调用验证（最常用；退出码 0 = 断言通过）
python -X utf8 workflow/evidence/WF-003-2026-10-30/tools/demo-local-verify.py

# ② 从原始运行输出重新解析出节点级事件，再压成对照表
cd workflow/evidence/WF-003-2026-10-30/tools
python -X utf8 parse-runs.py inputs/run-demo.out run-demo run-parsed.json
python -X utf8 run-table.py

# ③ 生成节点级输入输出逐字附录（幂等，重跑哈希不变）
python -X utf8 gen-node-io.py

# ④ 重建整段证据链（真实运行那次）
python -X utf8 capture-wf003-real.py run-demo-parsed.json run-demo.out dify-demo run-demo

# ⑤ 验证图生成器的确定性（两次运行应完全相同）
python -X utf8 gen-graph.py && sha256sum build/graph.json
python -X utf8 gen-graph.py && sha256sum build/graph.json
```

输入目录可用环境变量覆盖：`WF003_INPUTS=/path/to/dir python ...`。

## 实测结果（2026-10-30，均从 cwd=`~/Desktop` 执行以验证路径解析）

| 命令 | 结果 |
| --- | --- |
| `demo-local-verify.py` | 断言 **通过**，退出码 **0** |
| `parse-runs.py` + 比对 | 重新解析结果与归档解析结果 **`==` 完全相等**（14 个事件） |
| `run-table.py` | 输出路径 `N3 -> N4[true] -> N7a -> EndA`；N2 `4.43872 s` / `1257` 字符 / **`1487` tokens** |
| `gen-node-io.py` | 幂等：重跑前后 sha256 一致 |
| `gen-graph.py` ×2 | 确定性：两次 `graph.json` sha256 一致（`c6d3dae23ff3650512b465f6be7cd2b9…`） |
| `capture-wf003-real.py` | 见下方修复说明 |

## 本次顺带修掉的两个真实缺陷

1. **`capture-wf003-real.py` 会静默产出 0 字节证据文件**：步骤名被写死为 `run-real`，
   而演示运行的步骤名是 `run-demo`，匹配不上就写出空文件。
   已改为可传步骤名 + 兜底匹配 + **匹配不到直接报错退出**（不再允许静默空文件）。
   因此 `../dify-demo-run-sse-raw.jsonl` 从 0 字节修成 **96,497 字节**的真实内容。
2. **`run-table.py` 的 N2／N5 节点标题写死为占位期名称**，接模型后取不到节点，显示 `null`。
   副本改为按 `inputs/graph.json` 的真实标题前缀查找；并补上真实 LLM 节点有意义的字段
   （`N2_elapsed_s`／`N2_text_chars`／`N2_total_tokens`）。
   注意 `N2_status`／`N2_model_called` 对真实运行**恒为 `null`**——那是占位期 Code 节点的字段，
   真实 LLM 节点的 `outputs` 只有 `text`／`reasoning_content`／`usage`／`finish_reason`。

---

## 追加：2026-10-31 版本 #2 相关变化

1. **`gen-graph-llm.py` 改用 `uuid5`**（原本是 `uuid4()` 随机值），命名空间由仓库 URL 派生：
   ```python
   UUID_NS = uuid.uuid5(uuid.NAMESPACE_URL, "https://github.com/sunnyyang0822-stack/GiftWise-AI/workflow")
   ```
   效果：**同一份源码连续生成两次，图逐字节相同**（`graph-llm.json` sha256 `ad92d232b0d0ae68155e09b189676a5e00c2629e366f5e5d5e85ee798fb202b8`，
   本副本生成的结果与原目录一致）。修复前只能保证"语义可复现"。
2. **新增 `scan-stale-claims.py`**：扫描材料里「未发布 / 未创建版本 / 版本 #1」类过期表述，
   输出带 `文件:行号 — 原句` 的清单。纯文本扫描，**零模型调用**：
   ```bash
   python -X utf8 workflow/evidence/WF-003-2026-10-30/tools/scan-stale-claims.py
   ```
3. **`inputs/graph.json` 现在含新 5 行范围检查**（因为它在 2026-10-31 重新生成过）；
   它是**当前源码**的产物，与 2026-10-30 部署的版本 #1 图不同（差那 5 行）。
   版本 #1 与版本 #2 的整份已发布工作流分别归档在
   `../WF-003-2026-10-31-publish-v2/dify-published-v1-workflow.json` 与 `-v2-workflow.json`。
