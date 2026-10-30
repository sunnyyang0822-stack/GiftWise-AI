#!/usr/bin/env bash
# GiftWise AI · Demo 服务启停（DEMO-001）
#
# 为什么不用 `timeout`：已复现，MSYS coreutils 的 `timeout` 杀不掉原生 Windows
# node.exe —— `timeout 3 node ...` 之后 node 仍存活、心跳继续写，端口被永久占住。
# 因此本脚本一律用 PID 文件 + 精确 PID 终止，并且**优先用 PowerShell Stop-Process**
# （对原生 Windows 进程可靠），失败才退回 taskkill，再失败才 kill。
#
# 用法：
#   bash docs/demo/bin/servers.sh start     # 起两个服务并打印 URL（含**界面服务身份自检**）
#   bash docs/demo/bin/servers.sh stop      # 精确停掉本脚本起的服务
#   bash docs/demo/bin/servers.sh status    # 先真探测（netstat+HTTP+TCP）再报端口占用与身份
#
# 起止端口（2026-10-31 新增，默认不变）：只改**搜索起点**，脚本仍会自动避让占用端口；
#   GW_DEMO_WEB_BASE=8916 GW_DEMO_VAL_BASE=8917 bash docs/demo/bin/servers.sh start
#   —— 现场若 8787 整段都不干净，用这两个变量把起点挪到干净区间，然后**只认它打印的端口**。
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RUNDIR="$ROOT/web/.tmp/demo-rehearsal/servers"
mkdir -p "$RUNDIR"
VALIDATOR_PID="$RUNDIR/validator.pid"
WEB_PID="$RUNDIR/web.pid"
WEB_PORT_FILE="$RUNDIR/web.port"
VAL_PORT_FILE="$RUNDIR/validator.port"

is_free() { ! (echo > "/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1; }

# ────────────────────────────────────────────────────────────────────────────
# A7 修补（2026-10-31）：`status` 以前只凭 is_free（/dev/tcp 单次连接）就宣布
# "端口空闲"。已实测：同一次运行里它打印「8787 空闲」，而 curl 127.0.0.1:8787/healthz
# 明明返回 {"mode":"mock"} —— 单一探测（还是一次性的 TCP connect）不足以定"空闲"。
# 现在改成**三个相互独立的证据**：netstat 有无 LISTENING、HTTP 有无响应、TCP 能否连上；
# 三者全否才允许说"空闲"，而且必须把探测动作写出来。
# ────────────────────────────────────────────────────────────────────────────
PUBLIC_DIR="$ROOT/web/public"

is_num() { case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }

pid_on() { netstat -ano 2>/dev/null | grep LISTENING | grep -E ":$1 " | awk '{print $5}' | head -1; }

disk_size() { # disk_size <file> -> 字节数（取不到返回空）
  local n=""
  [ -f "$1" ] && n="$(wc -c < "$1" 2>/dev/null)"
  n="$(printf '%s' "$n" | tr -d '[:space:]')"
  is_num "$n" && printf '%s' "$n"
}

http_code() { curl -sS -m 3 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$1$2" 2>/dev/null; }
http_size() { curl -sS -m 3 -o /dev/null -w '%{size_download}' "http://127.0.0.1:$1$2" 2>/dev/null; }
http_head() { curl -sS -m 3 "http://127.0.0.1:$1$2" 2>/dev/null | head -c 160; }

# 身份判据（A2）：端口号 ≠ 身份，`"mode":"mock"` 也 ≠ 身份。
# 唯一硬判据是「服务返回的 / 与 /landing.css 字节数 = 本工作区 web/public 磁盘字节数」。
# 2026-10-31 实测：8787 上曾挂着另一个仓库副本（换行符 CRLF），/ 返回 21039 B，
# 而本工作区磁盘是 20724 B —— server-identity.mjs 因此不认 8787。
# 返回：0 = 相符（就是本工作区）；1 = 不符（别的工作区副本）；2 = 不是 web 服务
identity_verdict() { # identity_verdict <port>
  local p="$1" sz_root sz_css d_root d_css mark1 mark2
  d_root="$(disk_size "$PUBLIC_DIR/index.html")"
  d_css="$(disk_size "$PUBLIC_DIR/landing.css")"
  sz_root="$(http_size "$p" /)"
  sz_css="$(http_size "$p" /landing.css)"
  if ! is_num "$sz_root" || [ "$sz_root" = "0" ]; then
    printf '        / 取不到内容（不是 web 服务，或拒绝了连接）\n'
    return 2
  fi
  [ "$sz_root" = "$d_root" ] && mark1="相符" || mark1="不符 !!"
  [ "$sz_css" = "$d_css" ] && mark2="相符" || mark2="不符 !!"
  printf '        /            = %s B（判据 %s B）%s\n' "$sz_root" "${d_root:-?}" "$mark1"
  printf '        /landing.css = %s B（判据 %s B）%s\n' "$sz_css" "${d_css:-?}" "$mark2"
  if [ "$sz_root" = "$d_root" ] && [ "$sz_css" = "$d_css" ]; then return 0; else return 1; fi
}

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
  local msys_pid="" port="" win_pid="" sig=""

  [ -f "$pidfile" ] && msys_pid="$(tr -d '[:space:]' < "$pidfile" 2>/dev/null)"
  [ -f "$portfile" ] && port="$(tr -d '[:space:]' < "$portfile" 2>/dev/null)"
  rm -f "$pidfile"

  if [ -z "$port" ]; then
    echo "  $name：没有端口记录（可能不是本脚本起的），未动任何进程"
    return 0
  fi

  # 端口已经空着 → 服务本来就不在了，**不要去 kill 任何 pid**（避免误杀被复用的 pid）
  if is_free "$port" && [ -z "$(http_head "$port" /healthz)" ]; then
    echo "  $name：端口 $port 本来就空着（无监听、无 /healthz 响应），只清理记录"
    rm -f "$portfile"
    return 0
  fi

  # 端口上有东西 → 先确认它**确实是本仓库的服务**，否则绝不自动杀
  win_pid="$(pid_on "$port")"
  sig="$(http_head "$port" /healthz)"
  case "$sig" in
    *giftwise-validator*|*'"mode":"mock"'*) ;;
    *)
      echo "  [FAIL] 端口 $port 被占用（pid ${win_pid:-?}），但 **/healthz 签名不匹配本仓库服务**"
      echo "         !! 不自动杀（很可能是别人的服务）。请人工确认：netstat -ano | findstr :$port"
      rm -f "$portfile"
      return 0
      ;;
  esac

  echo "  停止 $name：端口 $port 监听者 Windows pid ${win_pid:-?}（MSYS 记录 pid ${msys_pid:-无}）"
  # MSYS 的 pid 与 Windows 的 pid **不是一套**：PowerShell 拿 MSYS pid 杀不动原生 node/python。
  # 2026-10-31 实测：只杀 MSYS pid 时，stop 打印"已停止"而 8916/8917 仍在 LISTENING。
  [ -n "$msys_pid" ] && kill -9 "$msys_pid" 2>/dev/null
  [ -n "$win_pid" ] && hard_kill "$win_pid"
  sleep 0.5

  # 只有**重新探测确认端口真的空了**，才允许说"已停止"
  if is_free "$port" && [ -z "$(http_head "$port" /healthz)" ]; then
    echo "  [ OK ] $name 已停止，端口 $port 已释放（已重新探测确认）"
  else
    echo "  [FAIL] $name 端口 $port 仍被占用（pid $(pid_on "$port")）—— 脚本没能停掉它，请人工处理"
  fi
  rm -f "$portfile"
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
      VAL_BASE="${GW_DEMO_VAL_BASE:-8000}"
      is_free "$VAL_BASE" || echo "  !! $VAL_BASE 已被占用（别的 Agent 或残留进程），自动改用备用端口"
      VP="$(pick_port "$VAL_BASE")" || { echo "找不到空闲端口给校验器"; exit 1; }
      echo "  校验器端口：$VP"
      # 无论 VP 是否等于默认端口，都显式把端口传进去（否则 server.py 会绑它自己的默认 8000，
      # 启动器报的端口与实际监听不一致 —— 2026-10-31 已实测到这个不一致）。
      GIFTWISE_PORT="$VP" PYTHONIOENCODING=utf-8 detach_run "$RUNDIR/validator.log" "$VALIDATOR_PID" python -m deploy.server
      echo "$VP" > "$VAL_PORT_FILE"
    fi

    # 2) web 界面预览（mock）
    if [ "$REUSED" = "0" ]; then
      WEB_BASE="${GW_DEMO_WEB_BASE:-8787}"
      WP="$(pick_port "$WEB_BASE")" || { echo "找不到空闲端口给界面"; exit 1; }
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

    # A2：让主持人照念之前，先证明这个端口吐的是**本工作区**的页面。
    echo ""
    echo "  --- 界面服务身份自检（端口号不是身份，字节数才是）---"
    identity_verdict "$WP"
    IV=$?
    case "$IV" in
      0) echo "  [ OK ] 身份相符 —— 可以照念上面的「演示入口」" ;;
      1) echo "  [FAIL] 身份不符：这个端口上不是本工作区的页面（多半是另一个仓库副本）"
         echo "         !! 不要演示它；改开 docs/demo/replay/offline-replay.html，"
         echo "         !! 并照念：「界面这一屏我用本地预览页，端口是刚才启动器打印的那个，不是 8787。」" ;;
      *) echo "  [FAIL] 界面端口没有 HTTP 响应，见 $RUNDIR/web.log" ;;
    esac
    ;;

  stop)
    echo "== 停止演示服务 =="
    stop_one "web 界面" "$WEB_PID" "$WEB_PORT_FILE"
    stop_one "校验器" "$VALIDATOR_PID" "$VAL_PORT_FILE"
    echo "  完成"
    ;;

  status)
    echo "== 端口占用（**先探测再下结论**：netstat + HTTP + TCP 三个独立证据）=="
    echo "   身份判据（本工作区磁盘字节数）：/ = $(disk_size "$PUBLIC_DIR/index.html") B，/landing.css = $(disk_size "$PUBLIC_DIR/landing.css") B"
    echo "   端口号不是身份：2026-10-31 实测 8787 上曾挂着另一个仓库副本（/ = 21039 B）。"
    echo ""

    # 候选端口：先放本脚本记录的端口（启动器会避让到 8787 之外），再放固定区间
    PORTS=""
    for f in "$VAL_PORT_FILE" "$WEB_PORT_FILE"; do
      [ -f "$f" ] || continue
      _p="$(tr -d '[:space:]' < "$f" 2>/dev/null)"
      is_num "$_p" && PORTS="$PORTS $_p"
    done
    for p in 8000 8787 8788 8789 8790 8791 8792 8793 8794 8795 8796 8797 8798 8799; do
      PORTS="$PORTS $p"
    done

    SEEN=" "
    FREE_PORTS=""
    for p in $PORTS; do
      case "$SEEN" in *" $p "*) continue ;; esac
      SEEN="$SEEN$p "
      PID="$(pid_on "$p")"
      CODE="$(http_code "$p" /)"
      HEALTH="$(http_head "$p" /healthz)"
      TCP="free"; is_free "$p" || TCP="busy"

      # A7：三个证据全否才敢说"空闲"；以前只凭 is_free 单次连接就下结论
      if [ -z "$PID" ] && { [ -z "$CODE" ] || [ "$CODE" = "000" ]; } && [ -z "$HEALTH" ] && [ "$TCP" = "free" ]; then
        FREE_PORTS="$FREE_PORTS $p"
        continue
      fi

      echo "  $p  被占用${PID:+（pid $PID）}"
      KIND="unknown"
      case "$HEALTH" in
        *giftwise-validator*) echo "        /healthz → $HEALTH"
                              echo "        服务类型：确定性校验 API（本仓库 deploy/server.py）"
                              KIND="validator" ;;
        *'"mode":"mock"'*)    echo "        /healthz → $HEALTH"
                              echo "        服务类型：界面预览 mock（⚠️ 只说明是 mock，**不构成身份证明**）"
                              KIND="web" ;;
        '')                   [ "$TCP" = "busy" ] && echo "        /healthz 无响应（有 TCP 监听，但不是本仓库的 HTTP 服务）" ;;
        *)                    echo "        /healthz → $HEALTH" ;;
      esac
      if [ "$KIND" = "validator" ]; then
        echo "        → 判定：本仓库确定性校验 API（界面身份判据不适用于它）"
      elif [ -n "$CODE" ] && [ "$CODE" != "000" ]; then
        identity_verdict "$p"
        IV=$?
        case "$IV" in
          0) echo "        → 判定：**就是本工作区的界面预览**（字节数相符，可以照念这个端口）" ;;
          1) echo "        → 判定：**不是本工作区的服务**（字节数不符，多半是另一个仓库副本）——不要在这个端口上演示" ;;
          *) echo "        → 判定：有 HTTP 服务，但不是本工作区的页面" ;;
        esac
      fi
    done
    if [ -n "$FREE_PORTS" ]; then
      echo "  空闲（已逐个探测：netstat 无 LISTENING ＋ HTTP / 无响应 ＋ TCP 连不上）：$FREE_PORTS"
    fi
    ;;

  *)
    echo "用法: bash docs/demo/bin/servers.sh {start|stop|status}"
    exit 2
    ;;
esac
