# 重钉计划：`tests/acceptance/stage_b/pinned_hashes.json` 逐字段

> 落地批次：2026-10-31 早间决策「同意落地」四项条件之第 1 项。
> 字段结构逐键照抄 QA 线 2026-10-31 01:20 的版本（`pinned_at` / `reason` / `approved_by` /
> `superseded_sha256` / `changed_since_review` / `files`），由 `repin.py` 执行 —— 它**不新造字段、不改字段顺序**。
>
> 不重钉的后果是确定的：`tests/acceptance/stage_b/test_validator_acceptance.py:133` 会为 `files` 里
> **每个**文件生成 `test_hash_N`，补丁一落地 `test_hash_1`（`validator/rules.py`）必红；
> 本次还追加了 6 条用例，所以 `test_hash_3`（`tests/test_cases.json`）也会红。

## 1. 开工前 → 落地后（逐字段）

| 字段 | 开工前 | 落地后 | 依据 |
| --- | --- | --- | --- |
| `notice` | 不变 | 不变 | 仍是阶段 B 的现行基线说明 |
| `baseline_date` | `2026-10-31（Asia/Shanghai +08:00）` | **不变** | 同一天内第二次重钉，不新起日期 |
| `pinned_at` | `2026-10-31T01:20:45+08:00` | **落地时刻**（apply.sh 默认取本机 +08:00，可用 `--pinned-at` 指定；本次演练用 `2026-10-31T09:12:00+08:00`） | 记录本次重钉时刻 |
| `baseline_owner` | `GiftWise｜测试验收 Agent（Issue #8）` | **不变** | 这是**测试验收线**的基线文件；本线只按 PM 授权执行重钉，不接管归属（避免"谁改的"与"谁负责"混为一谈） |
| `approved_by` | PM 夜间指令授权重钉基线 | `PM（2026-10-31 早间决策「同意落地」四项条件之第 1 项：同一批次重钉本基线；由规则门修复线执行）` | 记录本次授权来源 |
| `reason` | 范围校验落地导致钉住值过时 | `规则门否定语义修复落地（validator/rules.py +69/−2：否定语境识别；同批次 +6 条回归用例）后，规则源码与用例集发生经 PM 早间决策「同意落地」授权的合法变更，导致 2026-10-31 01:20 的钉住值过时。` | 本轮变更根因 |
| `why_not_edit_review` | 不变 | **不变** | 仍是「`docs/pm-reviews/**` 是 B 类历史记录，不得改写数字」 |
| `superseded_review` | `docs/pm-reviews/val-001-rereview-2026-10-29.md` | **一个字都不动** | 见 §2 |
| `superseded_sha256` | 4 条（`4782255b…` 等） | **一个字都不动** | 见 §2 |
| `changed_since_review` | 4 条（相对 2026-10-29 评审） | **4 条，改为"相对 2026-10-29 评审的累计变更"** | 见 §3 |
| `files` | 4 条 | **4 条，2 条变、2 条不变** | 见 §4 |

## 2. 为什么 `superseded_sha256` 一个字都不能动

`test_validator_acceptance.py:56-59` 会：

```python
self.assertEqual("docs/pm-reviews/val-001-rereview-2026-10-29.md", BASELINE_META["superseded_review"])
self.assertEqual(set(REVIEW_HASHES), set(BASELINE_META["superseded_sha256"]))
for name, old in BASELINE_META["superseded_sha256"].items():
    self.assertEqual(REVIEW_HASHES[name], old, f"{name} 的被取代旧值与 2026-10-29 评审不一致")
```

也就是说 `superseded_sha256` **必须等于** 2026-10-29 评审里那 4 个值，而不是"上一版基线"的值。
把它改成 `1f389dad…`（上一版基线）会让这条断言立刻失败，而且会破坏"可追溯到评审"的设计本意。
**结论：本字段是历史锚点，不是"上一版"。** 本次重钉后，2026-10-29 评审 → 本次基线之间共承载了
两个批次（2026-10-30 范围校验 + 2026-10-31 否定语义修复），这一事实记录在 `changed_since_review` 的措辞里。

## 3. `changed_since_review` 要写"累计"，不是"只写本批次"

该字段的语义是"相对 `superseded_review`（2026-10-29）变了什么"。若只写本批次，
就会丢掉 2026-10-30 那次变更，读者无法从基线解释 `validator/__init__.py` 之外三个文件的全部差异。因此逐条写累计：

- `validator/__init__.py`：未变（自 2026-10-29 评审以来未改动）
- `validator/rules.py`：累计 **+74/−2** —— 先 +5 行请求侧范围校验（2026-10-30），
  再 **+69/−2** 否定语境识别（2026-10-31，`rulefix/negation-fix.diff`）；**278 行 → 345 行**
- `tests/test_validator.py`：累计 +6/−2（2026-10-30）
- `tests/test_cases.json`：累计 **313 → 326 条**（+13/−0）—— 2026-10-30 新增 7 条范围用例；
  2026-10-31 新增 6 条（RF01–RF06，其中 RF04 是断言「仍被拒」的已知限制固定夹具）

> 口径说明：`validator/rules.py` 的 "+69/−2" 沿用上一线在提案与 diff 说明里的记法
> （含注释与外层空行的补丁行数概念）。**补丁文件自身的真实行数是 `+68/−1`**，
> 净增 **+67 行**（278 → 345 行）。落地后若要引用精确数字，请用后者，并注明是"diff 行数"还是"净行数"。

## 4. `files` 的四个新值（落地后真实字节哈希）

| 文件 | 开工前（2026-10-31T01:20 基线） | 落地后 | 变化 |
| --- | --- | --- | --- |
| `validator/__init__.py` | `f94446ea4292f37bfb11d9db94f7ef6fc1c5823d00ab5a631a36c6126fb50bc5` | 同左 | **不变**（补丁只动 `rules.py`） |
| `validator/rules.py` | `1f389dad4c2589fb8ddbc31d4e749d27a83ae43de422ee5036155d97d3d1a500` | **`0a57365ba8320a441f13ca8f22e7f884b59ad2161290ad823e2bc7c683913800`** | 变了 → 必须重钉 |
| `tests/test_validator.py` | `9c83a4c6c6341ed54c724498ca4d1bab6c196071c7809c6d144696d2339c601e` | 同左 | **不变**（6 条用例走夹具自动生成，未改该文件） |
| `tests/test_cases.json` | `07f2ad6fb5853bf440fe8150107cef08f6665a6d4b9a3088b9138e30f45fb1db` | **`a68e315551ad46116cfe8e654340f372d55f79d86db2fddab3fe89f4349fdded`** | 变了（+6 条用例）→ 必须重钉 |

**`validator/rules.py` 新 sha256 的算法（可复现、不碰生产文件）：**

```bash
mkdir -p /tmp/ap && cp validator/rules.py /tmp/ap/rules.py     # 在仓库外的副本上算
cd /tmp/ap && mkdir -p validator && mv rules.py validator/rules.py
git apply -p1 /path/to/repo/rulefix/apply-package/negation-fix.diff
sha256sum validator/rules.py
# 0a57365ba8320a441f13ca8f22e7f884b59ad2161290ad823e2bc7c683913800
```

> 两个坑（本次踩过，记下来省得别人再踩）：
> 1. `git apply` 在**仓库内**的子目录里执行时，路径是相对**仓库根**解析的，不是相对 cwd
>    （第一次尝试因此静默 "Skipped patch 'validator/rules.py'"，哈希没变还以为算出来了）。
>    要在副本上算，就把副本放到仓库**外面**，或用 `patch -p1`。
> 2. `validator/rules.py` 工作区是 **CRLF**，补丁文件本身也是 CRLF。用会做换行规范化的编辑器改补丁，
>    哈希就对不上了。

## 5. `pinned_at` 的不确定性怎么被钉住

`pinned_at` 是落地时刻 → 该文件的**真实字节哈希随时刻变化**，无法预先钉死。
处理方式：`manifest.json` 的 `post_state["tests/acceptance/stage_b/pinned_hashes.json"]` 钉的是
`canonical_pinned_at = 2026-10-31T00:00:00+08:00` 下的**规范化字节哈希**
`44db6fcafc77e9b5d2d48a53c10d85964e11a4670443d5532bfe4d275c7cab75`；
`repin.py` 写盘后会按 canonical 复算一遍并与该值比对（本次演练中复算通过）。
这样既允许真实时刻，又保证"结构与内容 == 审计过的结构"。
其余三个文件都是确定性重建，`post_state` 是**精确字节哈希**，apply.sh 第 [6] 步逐条核对。

## 6. 本次演练实测（apply.sh 真实输出的 [4] 与 [6] 步）

```
  files 将写为：
     validator/__init__.py        f94446ea4292f37bfb11d9db94f7ef6fc1c5823d00ab5a631a36c6126fb50bc5
     validator/rules.py           0a57365ba8320a441f13ca8f22e7f884b59ad2161290ad823e2bc7c683913800
     tests/test_validator.py      9c83a4c6c6341ed54c724498ca4d1bab6c196071c7809c6d144696d2339c601e
     tests/test_cases.json        a68e315551ad46116cfe8e654340f372d55f79d86db2fddab3fe89f4349fdded
   superseded_sha256 保持不动（4 条，与 2026-10-29 评审逐条一致）
   canonical 复算（2026-10-31T00:00:00+08:00）= 44db6fcafc77e9b5d2d48a53c10d85964e11a4670443d5532bfe4d275c7cab75
```

落地后 stage_b 套件实测 **Ran 275 tests … OK**（其中 `test_hash_0..3` 与 `test_review_manifest_has_four_files` 全绿），
见 `evidence/apply-run.txt` 第 [7] 步。

## 7. 顺带提醒：这份基线**只覆盖 4 个文件**

`test_review_manifest_has_four_files` 会断言 `files` 的键集合与 2026-10-29 评审**完全相同**，
所以**不能**借这次重钉往里加文件（例如把 `docs/validator-contract-decisions.md` 也钉进去）—— 那会红。
契约文档的变更由 `contract-text.md` + `apply_contract.py` 承载，不走这条基线。
