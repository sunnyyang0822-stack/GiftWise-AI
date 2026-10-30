# Docker 日志驱动对每请求 CPU 的影响 · 对照实验（**已修正**）

简体中文 · 截至 2026-10-31 01:56（+08:00）

## 为什么要保留这份"修正记录"

本文件的第一版结论是**错的**，这里把错误、错因和修正后的结论一并留下，
因为"测量方法的坑"本身就是本线最重要的产出之一。

### 第一版（错误，已废弃）

第一版结论：「日志占每请求 CPU 的比例 = **34.9%**，差值 638 us/请求」。

**错因**：第一版用「两次 `docker exec` 夹一段 6 秒 sleep」来测容器的**空转 CPU**，
再用它去扣减压力段的 CPU。但实测发现（见本目录 `exec-overhead.txt`）：

- 每次 `docker exec` 会给**目标容器的 cgroup** 记上约 **17~21 ms** 的 CPU；
- 一个只跑 `sleep 900` 的容器，用这个方法测出的"空转 CPU"是 1894 us/s，
  而 `docker stats` 显示 0.00% —— 说明测到的**几乎全是 exec 自己的开销**；
- 6 秒的基线窗口里只有 2 次 exec，噪声占比极大，扣减结果完全不可信。

另外第一版还记录了一个自相矛盾的现象：`--log-driver none` 的容器
"空转 CPU"（70121 us/s）反而**高于** `json-file` 容器（6116 us/s）。
这个矛盾本身就是基线不可靠的信号。

### 第二版（本轮采用）

**方法**：把整个测量塞进**一次** exec，用 `compose/lb/incontainer_cpu_probe.py`：
- 整个负载段 + 前后两次 cgroup 读数都在同一次 exec 里完成；
- exec 自身开销（约 20 ms）相对于数秒的负载段可忽略（<1%）；
- 服务端 CPU = cgroup 增量 − 本测量进程自己的 CPU（`time.process_time()`，含其全部客户端线程）。

**命令**：

```bash
docker exec -i -e PROBE_REQUESTS=3000 -e PROBE_CONCURRENCY=8 gw-logtest-json python - < compose/lb/incontainer_cpu_probe.py
docker exec -i -e PROBE_REQUESTS=3000 -e PROBE_CONCURRENCY=8 gw-logtest-none python - < compose/lb/incontainer_cpu_probe.py
```

其中 `gw-logtest-json` 与 `gw-logtest-none` 是**同镜像、同命令、同端口映射**的两个容器，
唯一差别是 `--log-driver json-file`（默认）与 `--log-driver none`。
两者都没有 healthcheck、都不在任何 LB 后面，背景请求为 0。

**原始输出（关键行）**：

```
=========== A. --log-driver json-file（默认）===========
  完成请求              : 3000（HTTP 200: 3000）
  吞吐                  : 817.84 req/s
  服务端 CPU (相减)     : 4389852 us  = 4.3899 core-seconds
  每请求服务端 CPU      : 1463.28 us
  其中 validate() 纯计算 : 170.87 us = 11.7%
  其余(HTTP/线程/socket) : 1292.41 us = 88.3%
  单核吞吐上限(按实测每请求 CPU) = 683.4 req/s/核
  => 框架开销把单核上限压低约 8.6 倍

=========== B. --log-driver none（关日志）===========
  完成请求              : 3000（HTTP 200: 3000）
  吞吐                  : 838.31 req/s
  服务端 CPU (相减)     : 4337303 us  = 4.3373 core-seconds
  每请求服务端 CPU      : 1445.77 us
  其中 validate() 纯计算 : 170.87 us = 11.8%
  其余(HTTP/线程/socket) : 1274.90 us = 88.2%
  单核吞吐上限(按实测每请求 CPU) = 691.7 req/s/核
  => 框架开销把单核上限压低约 8.5 倍
```

**修正后的结论**：

| 指标 | json-file | none | 差值 |
| --- | --- | --- | --- |
| 每请求服务端 CPU | 1463.28 us | 1445.77 us | **17.51 us** |
| 吞吐 | 817.84 req/s | 838.31 req/s | +2.5% |

- 关掉日志只省下 **17.51 us/请求**，占每请求 CPU 的 **1.2%**；
- 因此 **日志不是瓶颈**。第一版的 34.9% 是测量污染造成的假象，予以撤回。

**那么 88% 的框架开销到底是什么？**
本实验只能确定它**不是** stdout 日志路径。剩余开销来自每请求新建线程、
`BaseHTTPRequestHandler` 的请求行/头解析、socket 收发、以及 Python 层的逐请求调度。
要进一步拆开需要逐项改成对照实现（例如换 `socketserver` 的线程池），
**本轮没有做**，因此这部分仍是**未分解的推断**，不作为"已测量"结论。

## 附：exec 开销的独立测量（本目录 `exec-overhead.txt`）

连续两次 `docker exec … cat /sys/fs/cgroup/cpu.stat` 之间的 cgroup 增量：

| 容器 | 5 次增量 (us) | 中位数 (us) |
| --- | --- | --- |
| `gw-idle-test`（`sleep 900`，零请求） | 32739, 34205, 34432, 37509, 37497 | 34432 |
| `gw-logtest-json`（零请求） | 36045, 40813, 37657, 34814, 32422 | 36045 |
| `validator-a`（有健康探测） | 42980, 44694, 36706, 43859, 37234 | 42980 |

即使是一个只跑 `sleep` 的容器，两次 exec 之间也会被记上约 34 ms 的 CPU。
这就是"用 exec 间隔测空转"必然失败的原因。
