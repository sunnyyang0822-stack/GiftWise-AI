# 交付镜像重建与三项审计复测（2026-10-31 00:5x / 01:0x 北京时间）

- 角色：GiftWise｜部署 Agent（Issue [#10](https://github.com/sunnyyang0822-stack/GiftWise-AI/issues/10) CLOUD-001）
- 触发：PM 更正口径 + 独立审计实测交付镜像 `latest` **三处过时**；后 PM 决定按 **B** 修第 ③ 条。
- 边界：只改 `deploy/**`（`docs/**` 未动）；**未推送任何镜像仓库、未上传任何主机、未采购**。

## 1. 口径更正（PM 指出，我先前的说法做不到）

**原文（错）**："归档重建后的 manifest digest"。

**为什么做不到**：镜像**从未推送到任何仓库**，所以根本没有 registry manifest。
`docker inspect --format '{{json .RepoDigests}}'` 返回的是**本地 config digest**，与镜像 ID **同值**：

```
$ docker inspect giftwise-validator:latest --format '{{json .RepoDigests}}'      # 重建前（raw/image-audit-prerebuild/01-repodigests.txt）
["giftwise-validator@sha256:23a8c3bed3902798d234f7827567a5f9a39a1b85d6b3ed9517f1645f985e9422"]
$ docker inspect giftwise-validator:latest --format '{{.Id}}'
sha256:23a8c3bed3902798d234f7827567a5f9a39a1b85d6b3ed9517f1645f985e9422      # ← 同一个值
```

**现行口径（本目录以后一律这样写）**

| 用途 | 用什么 |
| --- | --- |
| **稳定标识（首选）** | **`tag` + 构建日期 + `/healthz` 的 `rules_source_sha256`**（必要时再加基础镜像 digest 与字节数） |
| 辅助 | 镜像 ID / config digest —— **会随每次重建漂移**，只能"顺手记一下"，不能作判据 |
| 不存在 | **manifest digest**（`RepoDigests` 里那个不是）——要它必须先把镜像推到仓库，**需要另行授权** |

**ID 漂移在本轮的直接证据**（同一份内容、不同时间重建 → 不同 ID）：

| tag | 镜像 ID | 构建时间 |
| --- | --- | --- |
| `pm-baseline-20261030` | `b42f408b4f07` | 2026-10-30 22:20:54 |
| `coldbuild-20261030` | `ed3fbe912571` | 2026-10-30 22:50:36 |
| `latest`（重建前） | `23a8c3bed390` | 2026-10-30 23:00:00 |
| `latest` / `submission-20261101`（重建后，A 版） | `8304b047cc71` | **2026-10-31 00:55:49** |
| `candidate-observable`（候选，见 §4） | `b8d712a83155` | 2026-10-31 00:57:04 |
| `latest` / `submission-20261101`（B 版，**已被夜间指令取代**） | `c15d1afee2d2` | 2026-10-31 01:08:39 |
| `latest` / `submission-20261101`（**最终交付版**） | `d9a4a35763ee` | **2026-10-31 01:13:59**（`COPY deploy` + 修 N-4，默认 `CMD` 不变） |

> 审计记录过的 `61321052b48b` 现在本机已不存在（被后续构建替换/清理）——**这本身就是"ID 不可作判据"的旁证**。

## 2. 重建前的三项复现（独立复现，不是转述）

命令：`python deploy/evidence/image_source_parity_check.py giftwise-validator:latest`
原始输出：[`raw/image-parity-20261031-005451/`](raw/image-parity-20261031-005451/) ＋ [`raw/image-audit-prerebuild/`](raw/image-audit-prerebuild/)
结论：**4/9 通过**，审计三条**全部复现**，并多查出一条：

| 项 | 审计说 | 我实测（原始输出） | 结论 |
| --- | --- | --- | --- |
| ① 规则文件旧 | `/app/validator/rules.py` = `4782255b…` ≠ 本机 `1f389dad…` | 容器 `4782255bb9c9ab48` vs 本机 `1f389dad4c2589fb`；`/healthz` 也报 `4782255b…` | **复现** |
| ①′ 服务端也旧（我补查） | —— | 容器 `/app/deploy/server.py` = `cdc4a981b688359c`（**I-2 修复前**）vs 本机 `083ed548e8bbb056` | **复现：修复没进镜像** |
| ② 半开正文无修复 | `>25 s` 无响应 | 观察窗口 **26 s**：**零响应、服务端未关闭**；Threads 前/中/后 = **1/2/1**（客户端不关就不释放）；期间 `/healthz` 仍 200 | **复现** |
| ③ 镜像不含可观测入口 | `/app` 只有 3 个文件 | `/app` = `deploy/server.py`、`validator/__init__.py`、`validator/rules.py`（**3 个**），`observable_server.py`/`observability.py` **不存在** | **复现** |
| 口径 | ID 会漂移 | `RepoDigests` ≡ 镜像 ID（见 §1） | **复现** |

## 3. 重建后逐条复测

```bash
# 重建（--no-cache，仓库根为上下文）
docker build --no-cache -t giftwise-validator:submission-20261101 -f deploy/Dockerfile .
docker tag giftwise-validator:submission-20261101 giftwise-validator:latest
```

- 构建时间：**2026-10-31 00:55:47**（`raw/image-audit-prerebuild/05-build-new.txt`，exit 0）
- 新镜像 ID（**辅助信息，会漂移**）：`8304b047cc71`
- **交付标识**：`giftwise-validator:submission-20261101`（= `latest`）+ 构建日期 **2026-10-31** +
  `/healthz` 的 `rules_source_sha256` = `1f389dad4c2589fb8ddbc31d4e749d27a83ae43de422ee5036155d97d3d1a500`
- 旧 `latest` 的 ID `23a8c3bed390…` 已归档（`raw/image-audit-prerebuild/04-old-latest-id.txt`），
  镜像对象仍在本地可按该 ID 取回（只是不再有 tag 指向）。

命令：`python deploy/evidence/image_source_parity_check.py giftwise-validator:submission-20261101`
原始输出：[`raw/image-parity-20261031-005612/`](raw/image-parity-20261031-005612/) → **8/9 通过**

| 项 | 重建后 | 结论 |
| --- | --- | --- |
| ① `/app/validator/rules.py` | 容器 `1f389dad4c2589fb` == 本机 | ✅ 已修 |
| ① `/app/deploy/server.py` | 容器 `083ed548e8bbb056` == 本机（**含 I-2 修复**） | ✅ 已修 |
| ① `/healthz` 的 `rules_source_sha256` | `1f389dad…` == 本机 | ✅ 已修 |
| ② 半开正文探测（26 s 窗口） | **`HTTP/1.0 408 Request Timeout`，耗时 10.02 s，服务端已关闭**；Threads 前/中/后 = 1/2/**1** | ✅ 已修 |
| ② 探测期间 `/healthz` | 200（**无论有没有修复都 200** —— 健康检查掩盖缺陷这一点仍然成立） | 说明 |
| ③ 镜像内含可观测入口 | `/app` 仍是 **3 个文件**，缺 `observable_server.py`/`observability.py` | ❌ 当时仍未修 → **2026-10-31 01:13:59 已修好**：`COPY deploy /app/deploy`（PM 夜间指令修 N-1），`/app` **13 个文件**、哈希全对齐。见 [`image-rebuild-n1n4-2026-10-31.md`](image-rebuild-n1n4-2026-10-31.md) §1.3 |
| ③′（B 版复测，**已被夜间指令取代**） | —— | 当时 9/9 + 矩阵 10/10（`/app` 5 个文件）；但那版把 `CMD` 换成了可观测入口，**PM 明确要求不这么做** |

**③ 为什么重建也修不了**：`deploy/Dockerfile` 只 `COPY validator` 与 `COPY deploy/server.py`
（`CMD` 也是 `python -m deploy.server`），**可观测入口的两份实现从来没被 COPY 进镜像**。
这不是构建时机问题，是 Dockerfile 内容问题——因此我**没有**擅自改它（见 §4 的决定权）。

### 3.1 交付镜像的**端点矩阵逐字节**核验（补充，10/10）

文件哈希一致只说明"内容相同"，所以我再用同一套 10 个用例**同时打本机进程与交付镜像容器**，逐字节比对：

```bash
python deploy/evidence/image_container_matrix_check.py giftwise-validator:submission-20261101
# → exit 0，===== 交付镜像端点矩阵 10/10 逐字节一致 =====
```

| 用例 | 本机 | 容器 | 正文 |
| --- | --- | --- | --- |
| `GET /healthz` | 200 | 200 | 逐字节一致 |
| `GET /` | 200 | 200 | 逐字节一致 |
| `GET /nope` | 404 | 404 | 逐字节一致 |
| `POST /validate` 正常载荷 | 200 | 200 | 逐字节一致 |
| `POST /validate` 字段非字符串 | 400 | 400 | 逐字节一致 |
| `POST /validate` 非法 JSON | 400 | 400 | 逐字节一致 |
| `POST /validate` 超长正文 | 413 | 413 | 逐字节一致 |
| `PUT /validate` 未实现方法 | 501 | 501 | 逐字节一致 |
| `POST /nope` | 404 | 404 | 逐字节一致 |
| `POST /validate` 无 `Content-Length` | 413 | 413 | 逐字节一致 |

原始输出：[`raw/image-matrix-20261031-010418/`](raw/image-matrix-20261031-010418/)
（`host-endpoint-matrix.json`、`container-endpoint-matrix.json`、`parity-diff.json`＝空、`checks.json`、`console.txt`）
脚本：[`image_container_matrix_check.py`](image_container_matrix_check.py)（复用 `slow_body_check.py` 的用例与工具函数，不另起一套口径）

> 第一次运行脚本自身报错（`start_local` 返回 `(proc, log_path)` 元组，我按单值用了）——原始现场留在
> `raw/image-matrix-20261031-010353/`，按纪律未删。

## 4. ③ 的修法已验证（候选 Dockerfile，未动仓库那一份）

候选文件：[`candidate-Dockerfile-observable`](candidate-Dockerfile-observable)（＝现有 Dockerfile **+2 行 COPY**，
`CMD` **保持** `python -m deploy.server`，不改默认入口行为）。

```bash
docker build --no-cache -t giftwise-validator:candidate-observable -f deploy/evidence/candidate-Dockerfile-observable .
python deploy/evidence/image_source_parity_check.py giftwise-validator:candidate-observable
```

原始输出：[`raw/image-parity-20261031-005705/`](raw/image-parity-20261031-005705/) → **9/9 通过**

- `/app` = **5 个文件**（＋`observability.py`、`observable_server.py`），5 个文件的 sha256 **逐一等于本机源码**
- 半开正文仍 **408 / 10.00 s / 已关闭 / Threads 回落**
- 并且**在镜像内真的能跑可观测入口**（命令覆盖 `python -m deploy.observable_server`）：
  `/healthz` 200、`/readyz` → `{"status":"ready",…,"access_log":{"ok":true,"detail":"writable"}}`、
  `/metrics?format=json` → `requests_total=2`、JSONL 单行日志与**优雅退出汇总**都在
  （原始输出 [`raw/image-parity-candidate/observable-in-image.txt`](raw/image-parity-candidate/observable-in-image.txt)）。

**踩坑记录（保留）**：候选 Dockerfile 第一次构建**失败**——
`COPY … # ← 新增` 这种**行内 `#` 在 Dockerfile 里不是注释**，被当成源路径，报
`failed to compute cache key: "/#": not found`。改成独立注释行后成功
（失败的原始输出留在 `raw/image-parity-20261031-005650/`，按纪律不删）。

**另一个踩坑（口径相关）**：直接 `docker run -e GIFTWISE_ACCESS_LOG=/tmp/access.jsonl` 时，
MSYS 把 `/tmp/...` **改写成了 Windows 路径**，日志实际落在容器内
`/app/C:/Users/lenovo/AppData/Local/Temp/access.jsonl`（文件机制本身正常）。
我的校验脚本用 `MSYS_NO_PATHCONV=1`，所以脚本内的容器证据不受影响；
命令行走 `docker` 时要注意这一点（原始输出 [`raw/image-parity-candidate/observable-in-image-accesslog.txt`](raw/image-parity-candidate/observable-in-image-accesslog.txt)）。

## 5. 第 ③ 条的修法：先按 PM 决定「B」做过一版，**夜间指令已把它改成最终版**

**先按 B 做的版本（2026-10-31 01:08，ID `c15d1afee2d2`，已不再是交付镜像）**：`deploy/Dockerfile` 加 2 行 COPY
**并**把 `CMD` 换成 `deploy.observable_server`。该版 9/9 + 矩阵 10/10，证据保留在
`raw/image-parity-20261031-010844/`、`raw/image-matrix-20261031-010905/`。

**PM 夜间指令（2026-10-31 01:13:59）改为最终版**：`COPY deploy /app/deploy`（一处替掉原来的 `COPY deploy/server.py`
与那 2 行 COPY），**默认 `CMD` 保持 `["python", "-m", "deploy.server"]`**。理由（PM 原文口径）：
可观测入口**已随镜像交付、但非默认入口**，`/metrics` 不被默认暴露。最终版 `deploy/Dockerfile`：

```dockerfile
COPY deploy /app/deploy
...
CMD ["python", "-m", "deploy.server"]
```

要用可观测入口就显式覆盖：
`docker run --rm -p 8000:8000 giftwise-validator:<tag> python -m deploy.observable_server`。

**最终版重建与复测（构建时间 2026-10-31 01:13:59 +0800，ID `d9a4a35763ee`）**

| 项 | 结果 | 原始输出 |
| --- | --- | --- |
| 镜像×源码一致性（9 项） | **9/9 全绿**：`/app` **13 个文件**哈希逐一对齐、`/healthz` 规则哈希对齐、半开正文 **408 / 10.01 s / 已关闭 / Threads 回落** | `raw/image-parity-20261031-011520/` |
| 交付镜像端点矩阵（10 用例） | **10/10 逐字节一致** | `raw/image-matrix-20261031-011609/` |
| 并发日志粘连（N-4） | 60 并发 → 粘连 **0** 行（修复前对照 7 行） | `raw/log-interleave-20261031-011548/` |
| 容器 Threads 1→10→1 + 修复前对照 | **43/43** | `raw/slowbody-20261031-011814/` |

> 候选文件 `candidate-Dockerfile-observable` **保留**（它是"两个决定可分开"的对照件）；
> 仓库里生效的是最终版 `deploy/Dockerfile`。

## 6. 本轮真实执行过的命令（全部本机，无上传/无推送/无费用）

```bash
docker inspect giftwise-validator:latest --format '{{json .RepoDigests}}'          # 证明不是 manifest digest
docker run --rm --entrypoint sh giftwise-validator:latest -c "find /app -type f"   # 证明只有 3 个文件
python deploy/evidence/image_source_parity_check.py giftwise-validator:latest      # 重建前 4/9（审计三条复现）
python deploy/evidence/image_source_parity_check.py giftwise-validator:submission-20261101   # 重建后 8/9
docker build --no-cache -t giftwise-validator:submission-20261101 -f deploy/Dockerfile .
docker tag giftwise-validator:submission-20261101 giftwise-validator:latest
docker build --no-cache -t giftwise-validator:candidate-observable -f deploy/evidence/candidate-Dockerfile-observable .
python deploy/evidence/image_source_parity_check.py giftwise-validator:candidate-observable   # 候选 9/9
python deploy/evidence/image_container_matrix_check.py giftwise-validator:submission-20261101 # 端点矩阵 10/10 逐字节
# ↓ B 版（PM 决定）改动 + 重建 + 复测
docker build --no-cache -t giftwise-validator:submission-20261101 -f deploy/Dockerfile .   # 01:08:37，含可观测入口与 CMD 切换
docker tag giftwise-validator:submission-20261101 giftwise-validator:latest
python deploy/evidence/image_source_parity_check.py giftwise-validator:submission-20261101  # 9/9
python deploy/evidence/image_container_matrix_check.py giftwise-validator:submission-20261101 # 10/10
```

## 7. 未做到 / 未核实

1. **③ 已修好**：先按 B（2026-10-31 01:08），再按 PM 夜间指令改成最终版（01:13:59，`COPY deploy` + 默认 `CMD` 不变）；
   剩下的只是"镜像没有推到任何仓库"这件事本身。
2. **manifest digest 不存在**：要它必须先推仓库（需授权）；本轮只给出 tag+日期+rules 哈希的标识口径。
3. **未推任何仓库、未上云**；`docs/architecture/**`、`docs/competition/**` 等**非本线文件里仍有旧的镜像口径**
   （例如把 `61321052b48b`/`b42f408b4f07` 当标识），**我没有改它们**（属其他线），已在回报里列点给 PM。
4. **只核了本机这一台机器**的镜像；没有第二台机器/CI 的独立重建对照。
5. `latest` 现在指向**最终交付版**（ID `d9a4a35763ee`）；**旧对象仍在本地**（`23a8c3bed390…`、`8304b047cc71`、`c15d1afee2d2`），未删除也未归档成 tar。

## 当前进度 / 未完成清单 / 阻塞

**当前进度**：口径已改（本文件 §1 + `docker-2026-10-30.md`、`README.md`、`container-probe.md`、`20261030-local-run.md`、
`observability-2026-10-30.md`、`security-review.md` 同步更正）；交付镜像已重建三次：A 版 `8304b047cc71`（修 ①②）、
B 版 `c15d1afee2d2`（已被取代）、**最终版 `d9a4a35763ee`**（构建 2026-10-31 01:13:59，`COPY deploy /app/deploy` +
`deploy/server.py` 修 N-4 日志粘连 + 默认 `CMD` 保持 `deploy.server`）；
审计三条**逐条复测**：**①②③ 均已修**（最终版：镜像一致性 9/9、端点矩阵 10/10、`/app` 13 个文件哈希全对齐、日志粘连 0 行）。
交付标识：`giftwise-validator:submission-20261101`（= `latest`）+ 构建日期 2026-10-31 + rules `1f389dad…`。
详见 [`image-rebuild-n1n4-2026-10-31.md`](image-rebuild-n1n4-2026-10-31.md)。

**未完成清单**：并发上限（I-2 残留，见 `slow-body-2026-10-30.md`）；S-4 的开关默认关闭（容器仍泄露 Python 3.12.16）；
`/metrics` 未鉴权（N-2，本次按 PM 指令不修，已写公开风险说明）；镜像进仓库 / 上云 / 真 digest（均需授权）；
非本线文档里的旧镜像口径（已报 PM，我没改）。

**阻塞**：无需授权就能做的都做完了；剩下两件事都要授权（推镜像仓库、云资源）。
