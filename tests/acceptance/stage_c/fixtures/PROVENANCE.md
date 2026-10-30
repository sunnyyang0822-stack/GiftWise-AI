# 固定夹具出处说明

## `labels_before_pursuit.py`

**用途**：为 `test_c2_03_pursuit_was_rejected_before_the_change` 提供**变更前**（尚无 `pursuit`）的
`workflow/labels.py` 内容，使"变更前追求对象确实被拒"这一复现永久可重复。

**为什么需要固定夹具**：该用例最初用 `git show HEAD:workflow/labels.py` 取"变更前版本"。
但 `HEAD` 是会移动的引用——工作流线随后把 `pursuit` 提交进了 `HEAD`（`959aa6a`），
用例于是取到"变更后版本"，由通过变为失败。**历史基线不能挂在移动引用上**，
因此把历史内容逐字节固定进本目录。

**出处（provenance）**

| 项 | 值 |
| --- | --- |
| 来源提交 | `89d6624`（feat(workflow): add intake contract and recommendation pipeline） |
| 该提交的地位 | 最后一个不含 `pursuit` 的 `workflow/labels.py` 版本 |
| 下一含它的提交 | `959aa6a`（release: 2026-11-01 现场提交冻结版本），首次加入 `pursuit` |
| 取得命令 | `git show 89d6624:workflow/labels.py` |
| 夹具 sha256 | `333ad9761d9278c7421c0cdd1c8d43ebbef7b6a6c164dfc54896ec653520d916` |
| 原文 sha256 | 同上（**逐字节一致，未做任何改动**） |
| 取得时间 | 2026-10-30（Asia/Shanghai） |

**核对方法**（任何人都可复跑）：

```bash
python -c "import subprocess,hashlib,pathlib; \
  o=subprocess.run(['git','show','89d6624:workflow/labels.py'],capture_output=True).stdout; \
  f=pathlib.Path('tests/acceptance/stage_c/fixtures/labels_before_pursuit.py').read_bytes(); \
  print(hashlib.sha256(o).hexdigest()); print(hashlib.sha256(f).hexdigest()); print(o==f)"
```

**行为差异（正是被测点）**

| 关系 ID | `89d6624`（本夹具） | 当前工作区 |
| --- | --- | --- |
| `partner` | 伴侣 | 恋人 |
| `pursuit` | **不存在** | 追求对象 |
| `colleague` | 同事 | 同事（仅技术回归） |

因该版本无 `pursuit`，把 `pursuit` 作为 `recipient_relation` 提交会走到
`INTAKE_UNKNOWN_LABEL` 的 `needs_input` 分支——这就是 PM 所声明、需被独立复现的"契约缺口曾真实存在"。
