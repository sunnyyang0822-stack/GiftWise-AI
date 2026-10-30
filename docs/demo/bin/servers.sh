#!/usr/bin/env bash
# GiftWise AI · Demo 服务启停（DEMO-001）
#
# 为什么不用 `timeout`：已复现，MSYS coreutils 的 `timeout` 杀不掉原生 Windows
# node.exe —— `timeout 3 node ...` 之后 node 仍存活、心跳继续写，端口被永久占住。
# 因此本脚本一律用 PID 文件 + 精确 PID 终止，并且**优先用 PowerShell Stop-Process**
# （对原生 Windows 进程可靠），失败才退回 taskkill，再失败才 kill。
#
# 用法：
#   bash docs/demo/bin/servers.sh start     # 起两个服务并打印 URL
#   bash docs/demo/bin/servers.sh stop      # 精确停掉本脚本起的服务
#   bash docs/demo/bin/servers.sh status    # 看端口与健康检查
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RUNDIR="$ROOT/web/.tmp/demo-rehearsal/servers"
mkdir -p "$RUNDIR"
VALIDATOR_PID="$RUNDIR/validator.pid"
WEB_PID="$RUNDIR/web.pid"
WEB_PORT_FILE="$RUNDIR/web.port"
VAL_PORT_FILE="$RUNDIR/validator.port"

is_free() { ! (echo > "/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1; }

pick_port() {
  local p="${1:-8787}" max=$(( ${1:-8787} + 60 ))
  while [ "$p" -lt "$max" ]; do
    if is_free "$p"; then echo "$p"; return 0; fi
    p=$((p + 1))
  done
  return 1
}

# 对原生 Windows 进程可靠的终止方式
hard_kill() {
  local pid="$1"
  [ -z "$pid" ] && return 0
  powershell -NoProfile -Command "Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue" >/dev/null 2>&1
  sleep 0.3
  if kill -0 "$pid" 2>/dev/null; then
    taskkill //F //PID "$pid" >/dev/null 2>&1 || kill -9 "$pid" 2>/dev/null
  fi
  sleep 0.3
  kill -0 "$pid" 2>/dev/null && return 1 || return 0
}

# 已复现的挂住问题：`servers.sh start | tail -12` 会卡住不返回。
# 原因是后台子进程会继承外层管道的写端，管道永远等不到 EOF。
# 因此这里对每个后台进程做**三重脱离**：stdin 接 /dev/null、stdout/stderr 落文件。
# 另外：**不要把 start 接管道**（`| tail`、`| tee`），要看输出就重定向到文件。
detach_run() { # detach_run <logfile> <pidfile> <cmd...>
  local log="$1" pidfile="$2"; shift 2
  ( cd "$ROOT" && "$@" > "$log" 2>&1 < /dev/null & echo $! > "$pidfile" )
}

# 判断某个服务是否已经在跑（PID 文件存在 + 健康检查通过）
already_up() { # already_up <pidfile> <portfile>
  local pidfile="$1" portfile="$2" pid port
  [ -f "$pidfile" ] || return 1
  [ -f "$portfile" ] || return 1
  pid="$(tr -d '[:space:]' < "$pidfile" 2>/dev/null)"
  port="$(tr -d '[:space:]' < "$portfile" 2>/dev/null)"
  [ -n "$pid" ] && [ -n "$port" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  curl -sS -m 3 "http://127.0.0.1:$port/healthz" 2>/dev/null | grep -q '"status":"ok"'
}

stop_one() {
  local name="$1" pidfile="$2" portfile="$3"
  if [ -f "$pidfile" ]; then
    local pid; pid="$(cat "$pidfile" 2>/dev/null | tr -d '[:space:]')"
    if [ -n "$pid" ]; then
      if hard_kill "$pid"; then echo "  已停止 $name (pid $pid)"; else echo "  !! 停止失败 $name (pid $pid) —— 请手工处理"; fi
    fi
    rm -f "$pidfile"
  else
    echo "  $name 没有 PID 文件（可能不是本脚本起的）"
  fi
  if [ -f "$portfile" ]; then
    local port; port="$(cat "$portfile" | tr -d '[:space:]')"
    if ! is_free "$port"; then
      echo "  !! 端口 $port 仍被占用 —— 找出占用者：netstat -ano | findstr :$port"
    fi
    rm -f "$portfile"
  fi
}

case "${1:-}" in
  start)
    echo "== 启动演示服务 =="

    # 0) 复用：已经在跑就直接报"已复用"，不重复起（避免留下无法回收的孤儿进程）
    REUSED=0
    if already_up "$WEB_PID" "$WEB_PORT_FILE"; then
      WP="$(tr -d '[:space:]' < "$WEB_PORT_FILE")"
      echo "  界面已在运行，复用端口 $WP（pid $(tr -d '[:space:]' < "$WEB_PID")）"
      REUSED=1
    fi
    if already_up "$VALIDATOR_PID" "$VAL_PORT_FILE"; then
      VP="$(tr -d '[:space:]' < "$VAL_PORT_FILE")"
      echo "  校验器已在运行，复用端口 $VP（pid $(tr -d '[:space:]' < "$VALIDATOR_PID")）"
    fi

    # 1) 确定性校验 API（先定端口，只启动一次，避免先起一个注定绑不上的进程）
    if [ -z "${VP:-}" ]; then
      is_free 8000 || echo "  !! 8000 已被占用（别的 Agent 或残留进程），自动改用备用端口"
      VP="$(pick_port 8000)" || { echo "找不到空闲端口给校验器"; exit 1; }
      echo "  校验器端口：$VP"
      if [ "$VP" = "8000" ]; then
        detach_run "$RUNDIR/validator.log" "$VALIDATOR_PID" python -m deploy.server
      else
        GIFTWISE_PORT="$VP" detach_run "$RUNDIR/validator.log" "$VALIDATOR_PID" python -m deploy.server
      fi
      echo "$VP" > "$VAL_PORT_FILE"
    fi

    # 2) web 界面预览（mock）
    if [ "$REUSED" = "0" ]; then
      WP="$(pick_port 8787)" || { echo "找不到空闲端口给界面"; exit 1; }
      echo "  界面端口：$WP"
      GW_MODE=mock GW_PORT="$WP" detach_run "$RUNDIR/web.log" "$WEB_PID" node web/server/server.mjs
      echo "$WP" > "$WEB_PORT_FILE"
    fi

    # 3) 等待并验证
    sleep 2
    echo ""
    echo "  --- 健康检查 ---"
    VH="$(curl -sS -m 5 "http://127.0.0.1:$VP/healthz" 2>&1)"
    echo "  校验器 http://127.0.0.1:$VP/healthz"
    echo "    $VH"
    WH="$(curl -sS -m 5 "http://127.0.0.1:$WP/healthz" 2>&1)"
    echo "  界面   http://127.0.0.1:$WP/healthz"
    echo "    $WH"
    echo ""
    echo "  演示入口： http://127.0.0.1:$WP"
    echo "  停止：     bash docs/demo/bin/servers.sh stop"
    case "$VH" in *'"status":"ok"'*) ;; *) echo "  !! 校验器未就绪，见 $RUNDIR/validator.log";; esac
    case "$WH" in *'"status":"ok"'*) ;; *) echo "  !! 界面未就绪，见 $RUNDIR/web.log";; esac
    ;;

  stop)
    echo "== 停止演示服务 =="
    stop_one "web 界面" "$WEB_PID" "$WEB_PORT_FILE"
    stop_one "校验器" "$VALIDATOR_PID" "$VAL_PORT_FILE"
    echo "  完成"
    ;;

  status)
    echo "== 端口占用（含备用区间 8790–8799）=="
    for p in 8000 8787 8788 8789 8790 8791 8792 8793 8794 8795 8796 8797 8798 8799; do
      [ -z "$p" ] && continue
      if is_free "$p"; then echo "  $p 空闲"; else echo "  $p 被占用  $(netstat -ano 2>/dev/null | grep -E "LISTENING" | grep ":$p " | awk '{print $5}' | head -1)"; fi
    done
    echo "== 健康检查 =="
    for u in "http://127.0.0.1:8000/healthz" "http://127.0.0.1:8787/healthz" "http://127.0.0.1:8788/healthz" "http://127.0.0.1:8789/healthz"; do
      printf "  %-40s %s\n" "$u" "$(curl -sS -m 3 "$u" 2>&1 | head -c 120)"
    done
    ;;

  *)
    echo "用法: bash docs/demo/bin/servers.sh {start|stop|status}"
    exit 2
    ;;
esac
