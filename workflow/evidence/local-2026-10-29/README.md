# 关于本目录（历史固定路径 + 追加式写入）

**目录名 `local-2026-10-29/` 是 WF-001 时期固定下来的历史路径，不代表里面内容的时间戳。**
产品负责人 2026-10-30 裁决：**目录名保留**（它被 `WF-001-2026-10-29.md` 等文档引用），
但写入方式改为**追加式**，见下。

## 现在的写入规则（`workflow/verify_local.py`）

1. **每次运行写入新目录 `runs/<时间戳>/`**，其中的
   `results.json`、`adapted-request.json`、`node-input-*.json`、`report.txt` 用独占创建写入，
   **绝不覆盖任何已存在的文件**；同一秒撞名会自动加 `-2`／`-3` 后缀。
2. **`latest.json` 是唯一的可变文件**，它只是"最新一次运行"的**指针**，不是证据；
   里面有 `latest_run` 指向的目录。
3. **`runs-index.jsonl` 只追加、从不重写**，每行一次运行的目录、`head` 与结论。
4. 每次运行的证据写出后**即冻结**，之后任何一次运行都不会改动它。

## 顶层那几个文件是冻结的历史快照

本目录顶层的 `results.json`、`adapted-request.json`、`node-input-*.json`、`report.txt`
是**旧行为（每次运行都覆盖）最后一次运行**留下的快照，**不再更新**，脚本也不会再改写它们。
它们对应的时间戳见其内部 `timestamp` 字段。

- 判断"最新一次运行"，**看 `latest.json`**，不要看顶层文件，也不要看目录名或文件系统 mtime。
- `workflow/evidence/WF-001-2026-10-29.md` 引用本目录作为 2026-10-29 的探针证据；
  该文件描述的是**当时那次运行**，与后来的运行不是同一次，需要精确对应时请核对 `timestamp` 与 `head`。
- 语义不随运行而变：仍是同一组 **46 项**离线探针、`model_calls = 0`、`cloud_verified = false`；
  变化的是时间戳、`head` 与平台串。

## 给其他文件线的提示（不属于工作流线边界）

`tests/acceptance/stage_c/run_verify_local_nopipe.py` 第 67 行仍在读**顶层的冻结快照**
`workflow/evidence/local-2026-10-29/results.json`，因此它打印的是旧数据（该脚本只 print、无断言，不会失败）。
若要读当次运行结果，应改读 `latest.json` 指向的 `runs/<时间戳>/results.json`。
该文件在 `tests/` 下，**工作流线不改**，仅在此登记。
