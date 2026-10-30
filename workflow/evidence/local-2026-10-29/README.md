# 关于本目录名（历史固定路径）

**目录名 `local-2026-10-29/` 是 WF-001 时期固定下来的历史路径，不代表里面内容的时间戳。**

`workflow/verify_local.py` 第 21 行把离线探针证据硬编码写入本目录，因此**每次运行该脚本都会重写**本目录下的
`results.json`、`adapted-request.json`、`node-input-*.json`、`report.txt`，内容时间戳会变成**当次运行时间**。

- 判断证据新旧，请以 `results.json` 内部的 **`timestamp` 字段**为准，不要看目录名，也不要看文件系统的 mtime。
- `workflow/evidence/WF-001-2026-10-29.md` 引用本目录作为 2026-10-29 的探针证据；该文件描述的是**当时那次运行**，
  与后来重写的内容不是同一次运行。需要精确对应时请核对 `results.json` 的 `timestamp` 与 `head`。
- 语义不随重写而变：仍是同一组 46 项离线探针、`model_calls = 0`、`cloud_verified = false`；变化的是时间戳、`head` 与平台串。

**待 PM 决定**：是否把本目录纳入版本管理，或让脚本改为写入带时间戳的新目录（不新增目录、保留现行为是本轮的最小改动选择）。
