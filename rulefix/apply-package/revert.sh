#!/usr/bin/env bash
# ============================================================================
# GiftWise AI · 规则门否定语义修复 —— 一条命令完整回滚
#
#   bash rulefix/apply-package/revert.sh
#
# 做四件事：
#   ① 从 .tmp/rulefix-apply-backup/files/ 逐字节还原 4 个被触及的生产文件
#   ② 与开工前 manifest.pre_state 的 sha256 **逐条比对**（不是"看起来一样"，是哈希相等）
#   ③ 打印回滚前后 git status --porcelain 对照（工作区回到原样）
#   ④ 任一文件对不上就判 FAIL 并以退出码 1 结束（不回滚成功不算完）
#
# 幂等：重复执行结果相同。备份丢失/损坏时**拒绝回滚**并报错，不会写出半个文件。
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

TOUCHED="validator/rules.py tests/test_cases.json tests/acceptance/stage_b/pinned_hashes.json docs/validator-contract-decisions.md"

echo "=============================================================================="
echo " GiftWise AI · 规则门否定语义修复回滚（逐字节）"
echo " 仓库根：$ROOT"
echo " 备份目录：$BACKUP"
echo "=============================================================================="

if [ ! -d "$BACKUP/files" ]; then
  echo
  echo "❌ 找不到备份目录 $BACKUP/files —— 拒绝回滚（避免写出半个文件）。"
  echo "   若本次落地未跑过 apply.sh，则本就无需回滚；"
  echo "   若备份被清理，请用快照 snapshot/night-2026-10-31 恢复对应文件后重跑。"
  exit 1
fi

# ---------------------------------------------------------------- 0) 备份自检
echo
echo "──── [0] 备份自检：副本 sha256 必须 == manifest.pre_state ────"
"$PY" - <<'PYEOF'
import hashlib, json, sys
from pathlib import Path
man = json.loads(Path("rulefix/apply-package/manifest.json").read_text(encoding="utf-8"))
backup = Path(".tmp/rulefix-apply-backup/files")
bad = 0
for rel, want in man["pre_state"].items():
    p = backup / rel
    if not p.is_file():
        print(f"  ❌ 备份缺文件：{p}")
        bad += 1
        continue
    got = hashlib.sha256(p.read_bytes()).hexdigest()
    ok = got == want
    bad += 0 if ok else 1
    print(f"  {'✅' if ok else '❌'} {rel}\n      备份 {got}\n      开工前 {want}")
if bad:
    print(f"\n❌ {bad} 处备份与开工前哈希不符 → 拒绝回滚（备份已损坏或被换过）")
    sys.exit(1)
print("  ✅ 4/4 备份副本与开工前哈希一致，可以安全还原")
PYEOF
[ $? -eq 0 ] || { echo; echo "❌ 回滚中止：备份自检未通过"; exit 1; }

# ---------------------------------------------------------------- 1) 记录回滚前
echo
echo "──── [1] 回滚前现状（将被覆盖）────"
for f in $TOUCHED; do
  printf '  %-48s %s\n' "$f" "$(sha256sum "$f" 2>/dev/null | cut -d' ' -f1)"
done
git status --porcelain -- $TOUCHED > "$BACKUP/git-status-before-revert.txt" 2>/dev/null || true

# ---------------------------------------------------------------- 2) 还原
echo
echo "──── [2] 逐字节还原（cp 覆盖，不做任何行尾/编码转换）────"
for f in $TOUCHED; do
  cp -p "$BACKUP/files/$f" "$f" || { echo "❌ 还原 $f 失败"; exit 1; }
  printf '  restored %-48s %s\n' "$f" "$(sha256sum "$f" | cut -d' ' -f1)"
done

# ---------------------------------------------------------------- 3) 校验
echo
echo "──── [3] 回滚校验：各文件 sha256 与开工前逐字节比对 ────"
"$PY" - <<'PYEOF'
import hashlib, json, sys
from pathlib import Path
man = json.loads(Path("rulefix/apply-package/manifest.json").read_text(encoding="utf-8"))
bad = 0
print(f"  {'文件':<48} {'回滚后 == 开工前':<18} 哈希")
for rel, want in man["pre_state"].items():
    got = hashlib.sha256(Path(rel).read_bytes()).hexdigest()
    ok = got == want
    bad += 0 if ok else 1
    print(f"  {rel:<48} {'✅ 逐字节相同' if ok else '❌ 不同':<18} {got}")
print()
if bad:
    print(f"❌ {bad} 个文件未回到开工前状态 —— 回滚不干净，请立即上报，不要继续。")
    sys.exit(1)
print("✅ 4/4 文件与开工前 sha256 完全相同（逐字节）")
PYEOF
[ $? -eq 0 ] || { echo; echo "❌ 回滚校验失败"; exit 1; }

# ---------------------------------------------------------------- 4) git status 对照
echo
echo "──── [4] git status --porcelain 对照（落地前 vs 回滚后）────"
git status --porcelain > "$BACKUP/git-status-after-revert.txt" 2>/dev/null || true
echo "  --- 4 个被触及文件（落地前 / 回滚后）---"
printf '  落地前: '; tr '\n' '|' < "$BACKUP/git-status-before-revert.txt"; echo
printf '  回滚后: '; git status --porcelain -- $TOUCHED | tr '\n' '|'; echo
echo "  --- 全仓（apply.sh 落地前快照 vs 回滚后）---"
if diff -u "$BACKUP/git-status-before.txt" "$BACKUP/git-status-after-revert.txt" > "$BACKUP/git-status.diff"; then
  echo "  ✅ 完全一致：工作区回到 apply.sh 落地前的状态（0 行差异）"
else
  echo "  ⚠ 存在差异（见下）。若差异仅在 rulefix/apply-package/**（本落地包自身的新增文件）"
  echo "    或 .tmp/**（已 gitignore），属预期；其他差异请人工核对。"
  sed 's/^/    /' "$BACKUP/git-status.diff"
fi

echo
echo "=============================================================================="
echo "✅ 回滚完成：4/4 文件逐字节还原，工作区回到落地前状态"
echo "   如需再次落地： bash $PKG/apply.sh"
echo "=============================================================================="
