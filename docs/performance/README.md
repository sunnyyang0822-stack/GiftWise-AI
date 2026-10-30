# GiftWise 性能与容量基准（复现指南）

> 这一目录回答一个问题：**「你这个单进程服务，到底能扛多少？瓶颈在哪？」**
> 所有数字都由本目录的脚本实测得到，**脚本零第三方依赖**（只用 Python 标准库），
> 评委可以在一台装了 Docker 的机器上逐条复现。

---

## 0. 前置

| 项 | 值（本机实测环境） |
| --- | --- |
| Python | 3.12.10（`C:\Users\lenovo\AppData\Local\Programs\Python\Python312\python.exe`） |
| Docker | 29.9.2（client = server） |
| 被测镜像 | `giftwise-validator:submission-20261101`（= `latest`） |
| 网络 | **只绑 `127.0.0.1`**，高位端口（189xx）；不暴露公网 |
| 模型调用 | **0 次**（本目录所有测量都不触达模型） |

> ⚠️ Git-Bash 下需要 `export PATH="$PATH:/c/Program Files/Docker/Docker/resources/bin"`；
> 进容器查路径要 `MSYS_NO_PATHCONV=1`。

---

## 1. 一条命令跑完全部

```bash
# 1) 起交付镜像
docker run -d --rm --name gwbench -p 127.0.0.1:18901:8000 giftwise-validator:submission-20261101

# 2) 确认契约与样本（同时生成 bench/_sample_*.json）
python bench/probe_contract.py http://127.0.0.1:18901

# 3) 纯规则层基准（不经 HTTP，用于分离「HTTP 开销」与「规则计算开销」）
python bench/bench.py rules --iterations 3000

# 4) 延迟/吞吐阶梯（容器）
python -u bench/bench.py ramp --url http://127.0.0.1:18901 --container gwbench \
    --levels 1,10,50,100,200,300 --requests 60

# 5) 并发连接承载上限（半开连接压住不放，同时验证 I-2 的 408）
python bench/hold_probe.py --url http://127.0.0.1:18901 --connections 100 --hold 12

# 6) 冷/热启动
python bench/bench.py startup --image giftwise-validator:submission-20261101 --runs 3

# 7) 归档汇总
python bench/analyze.py
```

对照实验（**去掉 Docker 端口转发这一层**）：

```bash
GIFTWISE_BIND=127.0.0.1 GIFTWISE_PORT=18902 python -m deploy.server &
python -u bench/bench.py ramp --url http://127.0.0.1:18902 --container __none__ \
    --levels 1,10,50,100,200,300 --requests 60
```

---

## 2. 脚本清单

| 文件 | 作用 |
| --- | --- |
| `bench.py` | 主入口：`rules` / `http` / `ramp` / `startup` 四个子命令 |
| `probe_contract.py` | 实测契约（`/healthz`、`/validate`、`/metrics`）并挑出**合法样本** |
| `hold_probe.py` | **并发连接承载上限**：半开连接压住不放，数服务端 ESTABLISHED 与线程 |
| `server_variant.py` | **单变量对照用**的服务端变体（只改 backlog / 日志开关），不是交付物 |
| `analyze.py` | 汇总 `bench/runs/*.json` 成表格 |

原始归档全在 `bench/runs/*.json`（含每次请求的延迟分布统计与错误构成）。

---

## 3. 方法论上踩过并修正的两个坑

这两个坑**必须写下来**，否则读者会把假象当结论：

### 3.1 客户端 TIME_WAIT / 临时端口耗尽（**已修正**）

第一轮阶梯在 c≥50 出现大量 `WinError 10048「每个套接字地址只允许使用一次」` 与 `ConnectionRefused`。
根因**不在服务端**：服务是 HTTP/1.0、**每请求新建连接**，客户端关闭的连接进入 `TIME_WAIT` 数十秒，
高并发下**客户端自己的临时端口先耗尽**。

→ 修正：对客户端 socket 设 `SO_LINGER(1,0)` 强制 RST 关闭以跳过 `TIME_WAIT`（`bench.py` 默认开启，
可用 `--no-linger0` 复现原现象）。

### 3.2 不要把「连接被拒」当成「服务端算不过来」

高并发下的错误全是**连接建立阶段**的（`ConnectionReset` / `ConnectionRefused` / `RemoteDisconnected`），
而服务端日志显示 **0 次超时、0 次异常、0 个 408**——**服务端为它看到的每个请求都回了 200**。
这说明瓶颈在**连接接纳**，不在计算。这一点由 §单变量对照实验 直接证实。

---

## 4. 口径声明

- 延迟 = **完整的一次请求往返**（含 TCP 连接建立），因为协议是 HTTP/1.0 无 keep-alive——
  这是真实客户端体验，不是"纯服务端处理时间"。
- 所有 worker 在 `threading.Barrier` 上**对齐后同时起跑**，避免逐个启动把长尾算进 p99。
- 每档并发**固定请求数**（每 worker 60 个），使不同档位样本量可比。
- 资源采样：容器 cgroup 内存（`memory.current`）与 `/proc/1/status` 的 `Threads`，
  每 0.35 s 一次；并发连接数取 `netstat` 中**本地地址为被测端口**的 ESTABLISHED 行（只数服务端侧）。

---

*本目录所有测量都在本机 `127.0.0.1` 完成，未使用任何云资源，未产生任何模型调用。*
