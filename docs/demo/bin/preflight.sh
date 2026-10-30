#!/usr/bin/env bash
# GiftWise AI · 演示当天 T-10 分钟自检（DEMO-001）
#
# 设计原则：
#   1) 只依赖 bash + curl + netstat（Windows 自带），不需要 node/python 就能跑完大半；
#   2) **绝不使用 `timeout`** —— 已复现它杀不掉原生 node.exe，会把自检本身挂死；
#   3) 每一项都给出「不满足时怎么办」，不是只报红；
#   4) 结论分三档：OK / WARN（可降级继续）/ FAIL（必须处理）。
#
# 用法：bash docs/demo/bin/preflight.sh
#   退出码 0 = 没有 FAIL；1 = 有 FAIL
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT" || exit 1

OK=0; WARN=0; FAIL=0

ok()   { printf '  \033[32m[ OK ]\033[0m %s\n' "$1"; OK=$((OK+1)); }
warn() { printf '  \033[33m[WARN]\033[0m %s\n        ↳ %s\n' "$1" "$2"; WARN=$((WARN+1)); }
bad()  { printf '  \033[31m[FAIL]\033[0m %s\n        ↳ %s\n' "$1" "$2"; FAIL=$((FAIL+1)); }
sec()  { printf '\n\033[1m%s\033[0m\n' "$1"; }

is_free() { ! (echo > "/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1; }
pid_on()  { netstat -ano 2>/dev/null | grep LISTENING | grep -E ":$1 " | awk '{print $5}' | head -1; }

printf '\033[1m=== GiftWise Demo 开演前自检（T-10 分钟）===\033[0m\n'
printf '工作目录：%s\n' "$ROOT"

# ── 1. 控制台编码（已复现的翻车点：GBK 打印 ↳/✅ 直接崩） ──────────────
sec "1. 控制台编码"
CP="$(powershell -NoProfile -Command '[Console]::OutputEncoding.CodePage' 2>/dev/null | tr -d '[:space:]')"
if [ "$CP" = "65001" ]; then
  ok "控制台代码页已是 65001（UTF-8）"
else
  warn "控制台代码页为 ${CP:-未知}（不是 65001）" \
       "本机已复现：codepage 936 下 Python 打印 ↳/✅/⚠ 会抛 UnicodeEncodeError 并以 exit 1 结束。先执行：chcp 65001 并设 PYTHONIOENCODING=utf-8"
fi

# ── 2. 运行时 ───────────────────────────────────────────────────────
sec "2. 运行时可用性"
if command -v node >/dev/null 2>&1; then
  NODE_V="$(node --version 2>&1)"
  ok "node 可用：$NODE_V  ($(command -v node))"
  case "$NODE_V" in
    v1[89]*|v2[0-9]*) ;;
    *) warn "node 版本偏旧：$NODE_V" "web/server/server.mjs 要求 node >= 18（package.json engines）" ;;
  esac
else
  bad "找不到 node" "界面预览将无法启动 → 直接走离线回放：docs/demo/replay/offline-replay.html（不需要 node）"
fi

if command -v python >/dev/null 2>&1; then
  PY_EXE="$(command -v python)"
  PY_V="$(python --version 2>&1)"
  ok "python 可用：$PY_V  ($PY_EXE)"
  case "$PY_EXE" in
    *msys64*) warn "当前 python 是 MSYS2 版（$PY_EXE）" \
      "按本机 AGENTS.md，MSYS2 Python 没有 pip/第三方包。本 Demo 的规则层只用标准库，可跑；但若要用 other 脚本请改用 C:\\Users\\lenovo\\AppData\\Local\\Programs\\Python\\Python312\\python.exe" ;;
  esac
else
  bad "找不到 python" "纯规则层与 46 项探针无法跑 → 用离线回放页的「本机真实规则代码」一节（已内联结果）"
fi

# ── 3. 端口 ─────────────────────────────────────────────────────────
sec "3. 端口占用（8000=校验器，8787=界面预览）"
if is_free 8000; then
  ok "8000 空闲，可直接 python -m deploy.server"
else
  PID="$(pid_on 8000)"
  if curl -sS -m 3 http://127.0.0.1:8000/healthz 2>/dev/null | grep -q '"status":"ok"'; then
    ok "8000 已被占用，但**就是** GiftWise 校验器（pid ${PID:-?}）—— 可以直接用"
  else
    warn "8000 被别的进程占用（pid ${PID:-?}）且不是校验器" \
         "改用 bash docs/demo/bin/servers.sh start（会自动避让到 8001+）"
  fi
fi

if is_free 8787; then
  ok "8787 空闲"
else
  PID="$(pid_on 8787)"
  H="$(curl -sS -m 3 http://127.0.0.1:8787/healthz 2>/dev/null)"
  if echo "$H" | grep -q '"mode":"mock"'; then
    warn "8787 已被**另一个 Agent 的**界面预览占用（pid ${PID:-?}，$H）" \
         "多 Agent 共用工作目录时这是正常的。**不要杀掉它**；用 servers.sh start 会自动换端口，或直接用 http://127.0.0.1:8787"
  else
    warn "8787 被未知进程占用（pid ${PID:-?}）" "用 servers.sh start 自动避让"
  fi
fi

# ── 4. 残留孤儿进程（timeout 陷阱的后遗症） ─────────────────────────
sec "4. 残留进程"
N_NODE="$(ps -W 2>/dev/null | grep -ci 'node' || true)"
N_PY="$(ps -W 2>/dev/null | grep -ci 'python' || true)"
printf '  当前可见：node 进程 %s 个，python 进程 %s 个\n' "${N_NODE:-0}" "${N_PY:-0}"
warn "提醒：绝不要用 MSYS 的 timeout 包裹 node/python" \
     "已复现：timeout 3 node ... 之后心跳仍继续写（9 秒写了 8 行），kill -9 包装进程后 node 仍孤儿存活并占住端口。"
ok "本轮自检未使用 timeout"

# ── 5. 网络与 Dify ──────────────────────────────────────────────────
sec "5. 网络与 Dify 可达性（任一失败即走降级）"

# 注意：curl 在连接失败时仍会通过 -w 打印 000，且自身退出码非 0。
# 早期版本的写法 `$(curl ... || echo 000)` 会把 "000" 与 "000" 拼成 "000000"，
# 导致 `!= "000"` 恒真、把断网误报成「可达」。这里分开取 code 与退出码。
probe() { # $1=url -> 输出 "code exit"
  local code rc
  code="$(curl -sS -m 8 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null)"
  rc=$?
  printf '%s %s' "${code:-000}" "$rc"
}

probe_report() { # $1=url $2=label $3=降级动作
  local url="$1" label="$2" fallback="$3" out code rc
  out="$(probe "$url")"; code="${out%% *}"; rc="${out##* }"
  if [ "$code" = "200" ] || [ "$code" = "301" ] || [ "$code" = "302" ] || [ "$code" = "401" ] || [ "$code" = "403" ]; then
    ok "$label 可达（HTTP $code）"
  elif [ "$code" = "000" ]; then
    warn "$label 不可达（TLS/连接失败，curl exit=$rc）" "$fallback"
  else
    ok "$label 有响应（HTTP $code）"
  fi
}

probe_report "https://cloud.dify.ai/" "Dify Cloud（HTTPS）" \
  "按脚本第 1 节判定为模式 C —— 全程用离线回放页，并声明「本次没有发起新的模型调用」"
probe_report "http://www.baidu.com/" "公网（明文 HTTP）" \
  "同样走模式 C；本 Demo 的规则层与离线回放都不需要网络"

# 本机实测记录：HTTPS 在本机**整体不可用**，与是否断网无关。
HTTPS_ANY=0
for u in https://cloud.dify.ai/ https://www.baidu.com/; do
  out="$(probe "$u")"; [ "${out%% *}" != "000" ] && HTTPS_ANY=1
done
if [ "$HTTPS_ANY" = "0" ]; then
  warn "本机 HTTPS 整体不可用（不只是 Dify）" \
       "本机实测：curl(schannel) 报 SEC_E_NO_CREDENTIALS 0x8009030e；Python urllib 报 CERTIFICATE_VERIFY_FAILED；DNS 把 cloud.dify.ai 解析到 198.18.0.94（198.18.0.0/15 保留段，非公网真实地址）。这是**本机环境**限制，不能推断会场网络同样如此；但既然本机无法预演模式 A，模式 C 兜底必须万无一失。明文 HTTP 正常（baidu 200），说明不是断网。"
fi

if [ -n "${DIFY_API_KEY:-}" ]; then
  ok "检测到 DIFY_API_KEY 环境变量（值不打印）"
else
  warn "未设置 DIFY_API_KEY" "web 接入层只能跑 mock；这**不影响** Demo，因为界面预览本来就标注为模拟数据"
fi

# ── 6. 关键文件存在性 ───────────────────────────────────────────────
sec "6. 关键文件"
check_file() {
  if [ -f "$1" ]; then ok "$2  →  $1"; else bad "缺少 $2" "$1 不存在，请确认工作区完整"; fi
}
check_file "docs/demo/replay/offline-replay.html" "离线兜底回放页（模式 C 主力）"
check_file "docs/demo/snapshot/demo-snapshot.json"  "离线快照 JSON"
check_file "web/server/server.mjs"                 "界面预览服务"
check_file "deploy/server.py"                      "确定性校验 API"
check_file "docs/demo/bin/run-rules-layer-demo.py" "纯规则层演示脚本"

# ── 7. 离线回放页真的自包含吗 ───────────────────────────────────────
sec "7. 离线回放页自包含性（file:// 可开、无网络依赖）"
REPLAY="docs/demo/replay/offline-replay.html"
if [ -f "$REPLAY" ]; then
  # 只认「会被浏览器真的加载」的资源引用，避免把 payload 里出现的
  # http://127.0.0.1:8000 之类字符串（那是规则层演示的地址说明）误报成外部依赖。
  EXT="$(grep -oE '<(script|link|img|iframe|source)[^>]*(src|href)="[^"]*"' "$REPLAY" 2>/dev/null \
        | grep -oE '(src|href)="[^"]*"' \
        | sed 's/.*="//; s/"$//' \
        | grep -vE '^(#|data:|javascript:)' | sort -u | head -8)"
  if [ -z "$EXT" ]; then
    ok "未引用任何外部资源（无 CDN / 无字体 / 无图片 / 无 script src）"
  else
    warn "发现外部资源引用（离线时会加载失败）" "$EXT"
  fi
  if grep -q '__SNAPSHOT_JSON__' "$REPLAY"; then
    bad "回放页里还有未替换的占位符 __SNAPSHOT_JSON__" "重新运行 python docs/demo/tools/build-replay.py"
  else
    ok "快照已内联（不需要 fetch，file:// 直接可开）"
  fi
  printf '  文件大小：%s 字节\n' "$(wc -c < "$REPLAY" | tr -d ' ')"
else
  bad "回放页不存在" "运行 python docs/demo/tools/build-snapshot.py && python docs/demo/tools/build-replay.py"
fi

# ── 8. 冻结版本 ─────────────────────────────────────────────────────
sec "8. 版本冻结（评分规则 1.4）"
if [ -f .git/HEAD ]; then
  H="$(cat .git/HEAD)"
  case "$H" in
    ref:*)
      REF="${H#ref: }"
      if [ -f ".git/$REF" ]; then
        CUR="$(cat ".git/$REF")"
      elif [ -f .git/packed-refs ]; then
        # 本仓库的分支 ref 收在 packed-refs 里，.git/refs/heads/ 是空的。
        # 早期版本只看文件，导致这里显示成 "?"。
        CUR="$(grep -E " refs/heads/$REF$| ${REF}$" .git/packed-refs 2>/dev/null | head -1 | awk '{print $1}')"
        [ -z "$CUR" ] && CUR="$(awk -v r="$REF" '$2==r {print $1}' .git/packed-refs 2>/dev/null | head -1)"
      fi
      ;;
    *) CUR="$H" ;;
  esac
  if [ -n "${CUR:-}" ]; then
    printf '  当前 HEAD：%s\n' "$CUR"
  else
    warn "读不到 HEAD 对应的 sha" "现场直接用离线回放页（快照里已记录冻结 HEAD）"
  fi
  DIRTY="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  if [ "${DIRTY:-0}" -gt 0 ]; then
    warn "工作区有 $DIRTY 个改动文件（多 Agent 并发中，属正常）" \
         "现场必须主动说明：「本次现场运行使用的是工作区版本，与提交版本的差异是……」——不要说成与提交版本一致"
  else
    ok "工作区干净，与 HEAD 一致"
  fi
else
  warn "读不到 .git/HEAD" "无法冻结版本；现场改用离线回放页（快照里已记录冻结 HEAD）"
fi

# ── 结论 ────────────────────────────────────────────────────────────
sec "结论"
printf '  OK %s ｜ WARN %s ｜ FAIL %s\n' "$OK" "$WARN" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '\n  \033[31m有 FAIL 项。\033[0m 若来不及修：直接走模式 C —— 打开 docs/demo/replay/offline-replay.html，\n'
  printf '  照读顶部红条声明，本页不需要网络、不需要模型、不需要 node/python。\n'
  exit 1
fi
printf '\n  \033[32m没有 FAIL。\033[0m 按 docs/demo/timeline-3min.md 走时间轴。\n'
exit 0
