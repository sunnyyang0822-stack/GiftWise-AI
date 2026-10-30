#!/usr/bin/env bash
# ============================================================================
# GiftWise AI · 规则门否定语义修复 —— 一条命令落地
#
#   bash rulefix/apply-package/apply.sh
#
# 依次完成六件事（任一步失败立即停止，并提示 revert.sh；绝不半落地）：
#   ① 应用 rulefix/apply-package/negation-fix.diff（validator/rules.py，+69/−2）
#   ② 追加 6 条回归用例（tests/test_cases.json）
#   ③ 重钉基线（tests/acceptance/stage_b/pinned_hashes.json）
#   ④ 补契约段（docs/validator-contract-decisions.md 追加 §9）
#   ⑤ 跑全量验证：4 条套件 + JS↔Python parity + 接入层
#   ⑥ 打印 PASS/FAIL 汇总（含落地后哈希）
#
# 可选参数：
#   --pinned-at "2026-10-31T09:12:00+08:00"  指定 pinned_hashes.json 的 pinned_at
#   --skip-js                                 跳过 parity 与接入层（仅跑 4 条 Python 套件）
#
# 开工前会把 4 个将被触及的生产文件完整备份到 .tmp/rulefix-apply-backup/（gitignore），
# 回滚用 bash rulefix/apply-package/revert.sh。
# ============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT" || exit 2
PKG="rulefix/apply-package"
BACKUP=".tmp/rulefix-apply-backup"

export PYTHONIOENCODING=utf-8
export PYTHONUTF8=1
PY="${PYTHON:-python}"
NODE="${NODE:-node}"

PINNED_AT=""
SKIP_JS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --pinned-at) PINNED_AT="${2:-}"; shift 2 ;;
    --pinned-at=*) PINNED_AT="${1#*=}"; shift ;;
    --skip-js) SKIP_JS=1; shift ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "未知参数：$1（用 --help 查看用法）"; exit 2 ;;
  esac
done

if [ -z "$PINNED_AT" ]; then
  PINNED_AT="$("$PY" -c "from datetime import datetime,timezone,timedelta;print(datetime.now(timezone(timedelta(hours=8))).strftime('%Y-%m-%dT%H:%M:%S+08:00'))")"
fi

TOUCHED="validator/rules.py tests/test_cases.json tests/acceptance/stage_b/pinned_hashes.json docs/validator-contract-decisions.md"

declare -a ROWS=()
row() { ROWS+=("$1|$2|$3"); }

print_summary() {
  echo
  echo "============================================================ 汇总 ============================================================"
  printf '%-34s %-8s %s\n' "环节" "结果" "细节"
  printf '%-34s %-8s %s\n' "----------------------------------" "--------" "--------------------------------------------------------------"
  local r id st dt
  for r in "${ROWS[@]:-}"; do
    [ -z "$r" ] && continue
    id="${r%%|*}"; r="${r#*|}"; st="${r%%|*}"; dt="${r#*|}"
    printf '%-34s %-8s %s\n' "$id" "$st" "$dt"
  done
}

banner() { echo; echo "──── [$1] $2 ────"; }

fail() {
  echo
  echo "❌ 中止：$1"
  row "流程" "FAIL" "$1"
  print_summary
  echo
  echo "回滚（逐字节还原 4 个文件）： bash $PKG/revert.sh"
  exit 1
}

echo "=============================================================================="
echo " GiftWise AI · 规则门否定语义修复落地"
echo " 仓库根：$ROOT"
echo " pinned_at：$PINNED_AT"
echo " 开始时刻：$("$PY" -c "from datetime import datetime,timezone,timedelta;print(datetime.now(timezone(timedelta(hours=8))).isoformat(timespec='seconds'))")"
echo "=============================================================================="

# ---------------------------------------------------------------- 0) 预检
banner 0 "预检：开工前哈希（与 manifest.pre_state 逐条核对，不符即中止、零写入）"
"$PY" - <<'PYEOF'
import hashlib, json, sys
from pathlib import Path
root = Path(".")
man = json.loads(Path("rulefix/apply-package/manifest.json").read_text(encoding="utf-8"))
bad = 0
for rel, want in man["pre_state"].items():
    got = hashlib.sha256((root / rel).read_bytes()).hexdigest()
    ok = got == want
    bad += 0 if ok else 1
    print(f"  {'✅' if ok else '❌'} {rel}\n      期望 {want}\n      实际 {got}")
if bad:
    print(f"\n❌ {bad} 个文件的开工前哈希不符：可能已落地过、或已被其他线改动。"
          f"先跑 revert.sh，或人工核对后再试。")
    sys.exit(1)
print("  ✅ 4 个文件全部与 manifest.pre_state 一致，可以落地")
PYEOF
[ $? -eq 0 ] || fail "第 0 步预检失败（见上方逐文件哈希）"
row "0 预检（开工前哈希）" "PASS" "4/4 与 manifest.pre_state 一致"

# ---------------------------------------------------------------- 1) 备份
banner 1 "备份：把 4 个将被触及的生产文件完整复制到 $BACKUP"
rm -rf "$BACKUP"
mkdir -p "$BACKUP/files"
for f in $TOUCHED; do
  mkdir -p "$BACKUP/files/$(dirname "$f")"
  cp -p "$f" "$BACKUP/files/$f" || fail "备份 $f 失败"
done
"$PY" - <<'PYEOF'
import hashlib, json
from pathlib import Path
man = json.loads(Path("rulefix/apply-package/manifest.json").read_text(encoding="utf-8"))
Path(".tmp/rulefix-apply-backup/pre-state.sha256").write_text(
    "".join(f"{h}  {r}\n" for r, h in man["pre_state"].items()), encoding="utf-8")
print("  已写出 .tmp/rulefix-apply-backup/pre-state.sha256")
PYEOF
git status --porcelain > "$BACKUP/git-status-before.txt" 2>/dev/null || true
for f in $TOUCHED; do
  a="$(sha256sum "$f" | cut -d' ' -f1)"
  b="$(sha256sum "$BACKUP/files/$f" | cut -d' ' -f1)"
  [ "$a" = "$b" ] || fail "备份校验失败：$f（$a != $b）"
done
echo "  ✅ 备份已校验（4/4 副本与工作区逐字节相同）；git status 快照已存 git-status-before.txt"
row "1 备份" "PASS" "4/4 副本逐字节一致 → $BACKUP"

# ---------------------------------------------------------------- 2) 应用补丁
banner 2 "应用补丁：git apply $PKG/negation-fix.diff（validator/rules.py）"
git apply --check -p1 "$PKG/negation-fix.diff" || fail "git apply --check 未通过（补丁与当前 rules.py 不匹配）"
git apply -p1 "$PKG/negation-fix.diff" || fail "git apply 失败"
NEW_RULES_SHA="$(sha256sum validator/rules.py | cut -d' ' -f1)"
WANT_RULES_SHA="$("$PY" -c "import json;print(json.load(open('$PKG/manifest.json',encoding='utf-8'))['post_state']['validator/rules.py'])")"
[ "$NEW_RULES_SHA" = "$WANT_RULES_SHA" ] || fail "补丁后 rules.py 哈希不符：$NEW_RULES_SHA != $WANT_RULES_SHA"
echo "  ✅ validator/rules.py 已打补丁；新 sha256 = $NEW_RULES_SHA"
row "2 应用补丁 rules.py" "PASS" "sha256=$NEW_RULES_SHA"

# ---------------------------------------------------------------- 3) 加用例
banner 3 "加用例：6 条回归用例 → tests/test_cases.json（写盘前对真实实现逐条自检）"
"$PY" "$PKG/apply_cases.py" || fail "apply_cases.py 失败（用例与实现不符，或哈希不符）"
row "3 加 6 条回归用例" "PASS" "tests/test_cases.json → 326 条"

# ---------------------------------------------------------------- 4) 重钉基线
banner 4 "重钉基线：tests/acceptance/stage_b/pinned_hashes.json（pinned_at=$PINNED_AT）"
"$PY" "$PKG/repin.py" --pinned-at "$PINNED_AT" || fail "repin.py 失败"
row "4 重钉 pinned_hashes" "PASS" "pinned_at=$PINNED_AT"

# ---------------------------------------------------------------- 5) 补契约段
banner 5 "补契约段：docs/validator-contract-decisions.md 追加 §9（字面匹配的定位与责任划分）"
"$PY" "$PKG/apply_contract.py" || fail "apply_contract.py 失败"
row "5 补契约 §9" "PASS" "docs/validator-contract-decisions.md +§9"

# ---------------------------------------------------------------- 6) 落地后哈希复核
banner 6 "复核：落地后 4 个文件字节哈希 == manifest.post_state"
"$PY" - <<'PYEOF'
import hashlib, json, sys
from pathlib import Path
man = json.loads(Path("rulefix/apply-package/manifest.json").read_text(encoding="utf-8"))
post = man["post_state"]
skip = {"tests/acceptance/stage_b/pinned_hashes.json"}  # pinned_at 决定真实字节，另有 canonical 复算
bad = 0
for rel, want in post.items():
    got = hashlib.sha256(Path(rel).read_bytes()).hexdigest()
    if rel in skip:
        print(f"  ~ {rel}\n      {got}  （pinned_at={json.loads(Path(rel).read_text(encoding='utf-8'))['pinned_at']}；"
              f"canonical 值 {want}，由 repin.py 写盘后复算比对）")
        continue
    ok = got == want
    bad += 0 if ok else 1
    print(f"  {'✅' if ok else '❌'} {rel}\n      {got}")
if bad:
    print(f"\n❌ {bad} 个文件落地后哈希不符")
    sys.exit(1)
print("  ✅ 3/3 精确哈希一致；pinned_hashes.json 已按 canonical 复算通过")
PYEOF
[ $? -eq 0 ] || fail "第 6 步落地后哈希复核失败"
row "6 落地后哈希复核" "PASS" "3 精确 + 1 canonical"

# ---------------------------------------------------------------- 7) 四条套件
banner 7 "全量验证（一）：四条互不包含的独立套件"
run_suite() {
  local id="$1" dir="$2" want="$3" out rc ran verdict okline
  out="$("$PY" -m unittest discover -s "$dir" -q 2>&1)"; rc=$?
  echo "$out" | tail -4 | sed 's/^/    /'
  ran="$(printf '%s' "$out" | grep -oE 'Ran [0-9]+ tests?' | head -1)"
  okline="$(printf '%s' "$out" | tr -d '\r' | grep -E '^(OK|FAILED)' | head -1)"
  if [ $rc -eq 0 ]; then verdict="OK"; else verdict="FAILED"; fi
  row "7 $id" "$([ "$verdict" = OK ] && echo PASS || echo FAIL)" "$ran → ${okline:-rc=$rc}（期望 $want）"
  [ "$verdict" = OK ] || fail "$id 套件未通过"
  [ "$ran" = "$want" ] || fail "$id 套件项数异常：$ran（期望 $want）"
}
run_suite "unit（tests）"        "tests"                       "Ran 335 tests"
run_suite "stage_b"             "tests/acceptance/stage_b"     "Ran 275 tests"
run_suite "stage_c"             "tests/acceptance/stage_c"     "Ran 39 tests"
run_suite "boundary"            "tests/acceptance/boundary"    "Ran 45 tests"

# ---------------------------------------------------------------- 8) parity + 接入层
if [ "$SKIP_JS" -eq 1 ]; then
  row "8 JS↔Python parity" "SKIP" "--skip-js"
  row "8 接入层 access-layer" "SKIP" "--skip-js"
else
  banner 8 "全量验证（二）：JS↔Python 语义一致（web/tools/parity-check.mjs）"
  "$NODE" web/tools/gen-parity-fixtures.mjs 2>&1 | sed 's/^/    /' || fail "gen-parity-fixtures.mjs 失败"
  "$PY" web/tools/parity-reference.py 2>&1 | sed 's/^/    /' || fail "parity-reference.py 失败"
  PARITY_OUT="$("$NODE" web/tools/parity-check.mjs 2>&1)"; PARITY_RC=$?
  printf '%s\n' "$PARITY_OUT" | sed 's/^/    /'
  PARITY_LINE="$(printf '%s' "$PARITY_OUT" | grep -E '结果：' | head -1)"
  if [ $PARITY_RC -eq 0 ] && printf '%s' "$PARITY_LINE" | grep -q '全部一致'; then
    row "8 JS↔Python parity" "PASS" "${PARITY_LINE:-rc=0}"
  else
    fail "parity-check.mjs 未通过（rc=$PARITY_RC，${PARITY_LINE:-无结果行}）"
  fi

  banner 9 "全量验证（三）：接入层（web/tests/access-layer.test.mjs）"
  ACCESS_OUT="$("$NODE" web/tests/access-layer.test.mjs 2>&1)"; ACCESS_RC=$?
  printf '%s\n' "$ACCESS_OUT" | tail -8 | sed 's/^/    /'
  ACCESS_LINE="$(printf '%s' "$ACCESS_OUT" | grep -E '^ℹ (pass|fail)' | tr '\n' ' ')"
  if [ $ACCESS_RC -eq 0 ]; then
    row "9 接入层 access-layer" "PASS" "${ACCESS_LINE:-rc=0}"
  else
    fail "access-layer.test.mjs 未通过（rc=$ACCESS_RC）"
  fi
fi

# ---------------------------------------------------------------- 10) 非判据提醒
banner 10 "非判据提醒：落地后必须同步的外部位置（不参与本脚本判据，详见 sync-after-landing.md）"
cat <<'EOF'
    ⚠ 镜像 /healthz 仍返回旧哈希 1f389dad…（镜像不重建就不会变）→ 必须重建 giftwise-validator 镜像
    ⚠ docs/competition/材料清单与自查.md §2 行 93、README.md:82 声明的是旧哈希
    ⚠ docs/validator-contract-decisions.md §7 的 18 处 rules.py 行号引用因补丁位移（+61/+67）
    ⚠ docs/test-reports/contract-001/tools/probe_doc_parity.py 的 :181 引用同步位移为 :242
    ⚠ tools/verify_all.py:59-60 的 KNOWN_GAPS 文案仍写旧哈希
    ⚠ 对外测试总量口径 329 / 688 → 335 / 694
    ⚠ workflow/generated/manifest.json 的 sources_sha256 由 probe46 重建后覆盖
    ⚠ 对外口径必须保留「Q7 未解决」，不得宣称禁忌拦截可靠
EOF
row "10 同步提醒" "INFO" "8 处；见 rulefix/apply-package/sync-after-landing.md"

# ---------------------------------------------------------------- 汇总
row "落地后 rules.py 新 sha256" "INFO" "$NEW_RULES_SHA"
print_summary
echo
echo "✅ 全部通过。落地后哈希："
"$PY" - <<'PYEOF'
import hashlib, json
from pathlib import Path
man = json.loads(Path("rulefix/apply-package/manifest.json").read_text(encoding="utf-8"))
for rel in man["touched_files"]:
    got = hashlib.sha256(Path(rel).read_bytes()).hexdigest()
    tag = "post_state 精确一致" if got == man["post_state"][rel] else "见 canonical 复算"
    print(f"  {rel:<48} {got}  [{tag}]")
PYEOF
echo
echo "回滚： bash $PKG/revert.sh"
echo "PM 落地单： docs/pm-reviews/规则门修复-待应用-2026-10-31.md"
echo
echo "⚠ 对外口径：Q7（用同义表达绕过字面词）仍未解决 —— 不得宣称「禁忌拦截可靠」。"
