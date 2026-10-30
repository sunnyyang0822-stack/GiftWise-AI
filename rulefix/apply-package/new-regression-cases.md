# 6 条回归用例：落点、原文、断言理由

> 落地批次：2026-10-31 早间决策「同意落地」四项条件之第 2 项。
> 现有 320 条用例对**否定路径的覆盖率是 0**（`docs/rulefix/规则门语义缺陷-复现与修复提案.md:211`），
> 所以这 6 条不是"锦上添花"，而是把提案里的机制结论钉成可执行断言。

## 1. 落点选择（为什么是 `tests/test_cases.json` 数组末尾）

| 候选落点 | 结论 |
| --- | --- |
| **`tests/test_cases.json` 的 `cases` 数组末尾** ✅ 采用 | `tests/test_validator.py:138` 为 **每一条** case 自动生成一个 fixture 测试（`test_fixture_NNN_<id>`），因此追加即获得 6 个真实断言，**不需要改任何生产测试文件**；数组末尾追加 → 既有 320 条的字节**零位移**，diff 干净可 review |
| `tests/test_validator.py` 里手写 6 个方法 | 要改生产测试文件（多一个哈希要重钉、多一处与他人冲突面），且断言写法与夹具风格分裂 |
| 新建 `tests/acceptance/**/negation_cases.json` | 要新建生产文件 + 改 `discover` 目标；且 stage_b 的 `cases.json` 由 `build_cases.py` 独立生成、按 275 项计数，混进去会动到别人钉住的基线 |
| `tests/acceptance/stage_b/cases.json` | 同上：该文件是测试验收线的独立夹具，**明确约定不由规则线改**（`docs/test-plan.md:35`） |

**唯一副作用**：`tests/test_cases.json` 的 sha256 会变（`07f2ad6f…` → `a68e3155…`），
所以它必须与 `validator/rules.py` **同一批次**重钉进 stage_b 基线 —— 已在 `repin-plan.md` 逐字段写明。

## 2. 为什么用「哈希校验 + 序列化重建」而不是文本 diff

`tests/test_cases.json` 在 `.gitattributes` 里是 `-text`，工作区是 **CRLF**，且 stage_b 按**原始字节**核对 sha256。
文本 diff 只要被任何工具做过一次换行规范化就再也 apply 不上。因此 `apply_cases.py` 做的是等价物：
先校验开工前字节哈希 → 按原换行风格重建整份文件 → 再校验落地后字节哈希，**哈希对不上就中止、不做部分写入**。
同时随包提供 `regression-cases.diff`（真实的 `git diff` 产物，1366 行，已验证 `git apply --check --reverse` 通过）供人工 review。

## 3. 六条用例一览（断言是重点）

| # | 用例 ID | 触发路径 | 断言 | 修复前 | 修复后 |
| --- | --- | --- | --- | --- | --- |
| 1 | `RF01_negation_bu_han_jiu_jing` | `description` 含「不含酒精」 | **通过** | ❌ `FORBIDDEN_TERM`（红） | ✅ `passed` |
| 2 | `RF02_negation_wu_jiu_in_name` | `name` 含「无酒」 | **通过** | ❌ `FORBIDDEN_TERM`（红） | ✅ `passed` |
| 3 | `RF03_negation_bu_han_jiu_lei` | `description` 含「不含酒类」（否定词与词条之间夹填充词「类」） | **通过** | ❌ `FORBIDDEN_TERM`（红） | ✅ `passed` |
| 4 | `RF04_KNOWN_LIMIT_wu_jiu_jing_pijiu_still_rejected` | `description` 含「无酒精啤酒」 | **仍被拒**（已知限制固定夹具） | ❌ `FORBIDDEN_TERM` | ❌ `FORBIDDEN_TERM`（**故意保持红**） |
| 5 | `RF05_true_positive_red_wine_in_description` | `description` 真含「红酒」且未声明不含 | **仍被拒**（真阳性） | ❌ `FORBIDDEN_TERM` | ❌ `FORBIDDEN_TERM` |
| 6 | `RF06_true_positive_maotai_in_name` | `name` 真含「茅台酒礼盒」且未声明不含 | **仍被拒**（真阳性） | ❌ `FORBIDDEN_TERM` | ❌ `FORBIDDEN_TERM` |

三条要点：

1. **RF04 是"已知限制的固定夹具"，断言的是「仍被拒」，不是「该通过」。**
   中文无词边界，词条「酒」会命中更长词「啤酒」内部的子串；否定标记「无」只作用于紧随其后的「酒精」，
   救不了被嵌进更长词里的字面命中。用例的 `note` 字段里用原话写死了这一点，
   并在用例 ID 里带 `KNOWN_LIMIT` 前缀 —— 将来若有人把它改成通过（例如引入分词/词边界），
   必须**先改契约与提案文档**，而不是悄悄改断言。
2. **RF05 / RF06 是"防过度放宽"的护栏**：一条走 `description`、一条走 `name`，
   防止「只看描述不看名称」式的放宽。它们修复前后行为相同，作用是**锁死**，不是救回。
3. 六条用例都以既有夹具 `T01_normal` 的 `request` / 候选 c2、c3 为底板
   （`forbidden_tags: ["alcohol"]`、`forbidden_terms: ["酒"]`），
   只改候选 c1 的**一个字段**，因此"为什么红/为什么绿"可以一眼归因。

## 4. 落地时的机器自检（比断言更早的一道闸）

`apply_cases.py` 在**写盘之前**会用当前（已打补丁的）`validator.validate` 逐条跑这 6 条用例并比对 `expected`，
输出 `[OK ] / [BAD]` 逐条结论；任一条不符就中止、不写盘。本次真实运行的输出见
`rulefix/apply-package/evidence/apply-run.txt` 第 [3] 步，6/6 全 OK。

## 5. 怎么单独复跑这 6 条

```bash
# 落地后（validator/rules.py 已打补丁）应得 335 项全绿；6 条新用例的 id 可直接过滤：
python -m unittest discover -s tests -q -k RF0
```

## 6. 用例原文（与落地后的 `tests/test_cases.json` 逐字节一致）

字段说明：`note` 是**文档性字段**（与既有用例的 `request_raw` / `request_argument` 同类，消费者忽略），
用途是把「这条断言的是什么」写进夹具本身，避免以后被误读。

```json
[
  {
    "id": "RF01_negation_bu_han_jiu_jing",
    "request": {
      "recipient_relation": "青年用户与关系不错但不太熟悉的同事",
      "occasion": "生日",
      "budget_amount": "200.00",
      "currency": "CNY",
      "available_days": 2,
      "facts": [
        {
          "id": "f1",
          "text": "喜欢咖啡"
        }
      ],
      "forbidden_tags": [
        "alcohol"
      ],
      "forbidden_terms": [
        "酒"
      ],
      "notes": "希望表达祝福，不造成关系压力"
    },
    "candidate_batch": {
      "candidates": [
        {
          "id": "c1",
          "name": "咖啡主题杯垫与马克杯",
          "description": "冬季热饮粉与马克杯组合，不含酒精，适合不饮酒的人。",
          "estimated_total": "150.00",
          "currency": "CNY",
          "estimated_preparation_days": 1,
          "tags": [
            "other"
          ],
          "reason": "呼应用户提供的咖啡兴趣，不假定具体口味",
          "fact_refs": [
            "f1"
          ],
          "inferences": [
            "桌面实用品可能适合同事关系"
          ],
          "unknowns": [
            "是否已有同类物品",
            "实际售价与供应情况"
          ],
          "presentation": "简洁中性包装，详细方案待选择后生成"
        },
        {
          "id": "c2",
          "name": "桌面收纳套装",
          "description": "小型收纳组合，估算包括礼物、基础包装、贺卡及配送",
          "estimated_total": "120.00",
          "currency": "CNY",
          "estimated_preparation_days": 2,
          "tags": [
            "other"
          ],
          "reason": "提供不同于咖啡主题的实用方向，不假定收纳偏好",
          "fact_refs": [],
          "inferences": [
            "收纳用品可能适合工作桌面"
          ],
          "unknowns": [
            "桌面空间和收纳习惯",
            "实际售价与供应情况"
          ],
          "presentation": "素色材料，详细方案待选择后生成"
        },
        {
          "id": "c3",
          "name": "便携笔记本与书签",
          "description": "纸品组合，估算包括礼物、基础包装、贺卡及配送",
          "estimated_total": "80.00",
          "currency": "CNY",
          "estimated_preparation_days": 1,
          "tags": [
            "other"
          ],
          "reason": "提供轻量书写方向，不把书写习惯当成已知事实",
          "fact_refs": [],
          "inferences": [
            "轻量礼物可能较少造成关系压力"
          ],
          "unknowns": [
            "是否使用纸质笔记本",
            "实际售价与供应情况"
          ],
          "presentation": "基础纸包装，详细方案待选择后生成"
        }
      ]
    },
    "expected": {
      "status": "passed",
      "all_passed": true,
      "candidate_passed": [
        true,
        true,
        true
      ]
    },
    "note": "救回用例（否定路径）：描述含「不含酒精」。修复前该处必报 FORBIDDEN_TERM（词条「酒」字面命中「酒精」），修复后视为已声明不含，不再命中。断言的是「修复后通过」。"
  },
  {
    "id": "RF02_negation_wu_jiu_in_name",
    "request": {
      "recipient_relation": "青年用户与关系不错但不太熟悉的同事",
      "occasion": "生日",
      "budget_amount": "200.00",
      "currency": "CNY",
      "available_days": 2,
      "facts": [
        {
          "id": "f1",
          "text": "喜欢咖啡"
        }
      ],
      "forbidden_tags": [
        "alcohol"
      ],
      "forbidden_terms": [
        "酒"
      ],
      "notes": "希望表达祝福，不造成关系压力"
    },
    "candidate_batch": {
      "candidates": [
        {
          "id": "c1",
          "name": "单一产地挂耳咖啡礼盒（无酒）",
          "description": "桌面杯具组合，估算包括礼物、基础包装、贺卡及配送",
          "estimated_total": "150.00",
          "currency": "CNY",
          "estimated_preparation_days": 1,
          "tags": [
            "other"
          ],
          "reason": "呼应用户提供的咖啡兴趣，不假定具体口味",
          "fact_refs": [
            "f1"
          ],
          "inferences": [
            "桌面实用品可能适合同事关系"
          ],
          "unknowns": [
            "是否已有同类物品",
            "实际售价与供应情况"
          ],
          "presentation": "简洁中性包装，详细方案待选择后生成"
        },
        {
          "id": "c2",
          "name": "桌面收纳套装",
          "description": "小型收纳组合，估算包括礼物、基础包装、贺卡及配送",
          "estimated_total": "120.00",
          "currency": "CNY",
          "estimated_preparation_days": 2,
          "tags": [
            "other"
          ],
          "reason": "提供不同于咖啡主题的实用方向，不假定收纳偏好",
          "fact_refs": [],
          "inferences": [
            "收纳用品可能适合工作桌面"
          ],
          "unknowns": [
            "桌面空间和收纳习惯",
            "实际售价与供应情况"
          ],
          "presentation": "素色材料，详细方案待选择后生成"
        },
        {
          "id": "c3",
          "name": "便携笔记本与书签",
          "description": "纸品组合，估算包括礼物、基础包装、贺卡及配送",
          "estimated_total": "80.00",
          "currency": "CNY",
          "estimated_preparation_days": 1,
          "tags": [
            "other"
          ],
          "reason": "提供轻量书写方向，不把书写习惯当成已知事实",
          "fact_refs": [],
          "inferences": [
            "轻量礼物可能较少造成关系压力"
          ],
          "unknowns": [
            "是否使用纸质笔记本",
            "实际售价与供应情况"
          ],
          "presentation": "基础纸包装，详细方案待选择后生成"
        }
      ]
    },
    "expected": {
      "status": "passed",
      "all_passed": true,
      "candidate_passed": [
        true,
        true,
        true
      ]
    },
    "note": "救回用例（否定路径）：名称含「无酒」。修复前名称字段必报 FORBIDDEN_TERM，修复后视为已声明不含。断言的是「修复后通过」。"
  },
  {
    "id": "RF03_negation_bu_han_jiu_lei",
    "request": {
      "recipient_relation": "青年用户与关系不错但不太熟悉的同事",
      "occasion": "生日",
      "budget_amount": "200.00",
      "currency": "CNY",
      "available_days": 2,
      "facts": [
        {
          "id": "f1",
          "text": "喜欢咖啡"
        }
      ],
      "forbidden_tags": [
        "alcohol"
      ],
      "forbidden_terms": [
        "酒"
      ],
      "notes": "希望表达祝福，不造成关系压力"
    },
    "candidate_batch": {
      "candidates": [
        {
          "id": "c1",
          "name": "咖啡主题杯垫与马克杯",
          "description": "商务茶具与办公桌面摆件，不含酒类，稳重得体。",
          "estimated_total": "150.00",
          "currency": "CNY",
          "estimated_preparation_days": 1,
          "tags": [
            "other"
          ],
          "reason": "呼应用户提供的咖啡兴趣，不假定具体口味",
          "fact_refs": [
            "f1"
          ],
          "inferences": [
            "桌面实用品可能适合同事关系"
          ],
          "unknowns": [
            "是否已有同类物品",
            "实际售价与供应情况"
          ],
          "presentation": "简洁中性包装，详细方案待选择后生成"
        },
        {
          "id": "c2",
          "name": "桌面收纳套装",
          "description": "小型收纳组合，估算包括礼物、基础包装、贺卡及配送",
          "estimated_total": "120.00",
          "currency": "CNY",
          "estimated_preparation_days": 2,
          "tags": [
            "other"
          ],
          "reason": "提供不同于咖啡主题的实用方向，不假定收纳偏好",
          "fact_refs": [],
          "inferences": [
            "收纳用品可能适合工作桌面"
          ],
          "unknowns": [
            "桌面空间和收纳习惯",
            "实际售价与供应情况"
          ],
          "presentation": "素色材料，详细方案待选择后生成"
        },
        {
          "id": "c3",
          "name": "便携笔记本与书签",
          "description": "纸品组合，估算包括礼物、基础包装、贺卡及配送",
          "estimated_total": "80.00",
          "currency": "CNY",
          "estimated_preparation_days": 1,
          "tags": [
            "other"
          ],
          "reason": "提供轻量书写方向，不把书写习惯当成已知事实",
          "fact_refs": [],
          "inferences": [
            "轻量礼物可能较少造成关系压力"
          ],
          "unknowns": [
            "是否使用纸质笔记本",
            "实际售价与供应情况"
          ],
          "presentation": "基础纸包装，详细方案待选择后生成"
        }
      ]
    },
    "expected": {
      "status": "passed",
      "all_passed": true,
      "candidate_passed": [
        true,
        true,
        true
      ]
    },
    "note": "救回用例（否定路径）：「不含酒类」——否定标记与词条之间夹一个填充词「类」。修复前必报 FORBIDDEN_TERM，修复后视为已声明不含。断言的是「修复后通过」。"
  },
  {
    "id": "RF04_KNOWN_LIMIT_wu_jiu_jing_pijiu_still_rejected",
    "request": {
      "recipient_relation": "青年用户与关系不错但不太熟悉的同事",
      "occasion": "生日",
      "budget_amount": "200.00",
      "currency": "CNY",
      "available_days": 2,
      "facts": [
        {
          "id": "f1",
          "text": "喜欢咖啡"
        }
      ],
      "forbidden_tags": [
        "alcohol"
      ],
      "forbidden_terms": [
        "酒"
      ],
      "notes": "希望表达祝福，不造成关系压力"
    },
    "candidate_batch": {
      "candidates": [
        {
          "id": "c1",
          "name": "咖啡主题杯垫与马克杯",
          "description": "无酒精啤酒，适合不饮酒的人。",
          "estimated_total": "150.00",
          "currency": "CNY",
          "estimated_preparation_days": 1,
          "tags": [
            "other"
          ],
          "reason": "呼应用户提供的咖啡兴趣，不假定具体口味",
          "fact_refs": [
            "f1"
          ],
          "inferences": [
            "桌面实用品可能适合同事关系"
          ],
          "unknowns": [
            "是否已有同类物品",
            "实际售价与供应情况"
          ],
          "presentation": "简洁中性包装，详细方案待选择后生成"
        },
        {
          "id": "c2",
          "name": "桌面收纳套装",
          "description": "小型收纳组合，估算包括礼物、基础包装、贺卡及配送",
          "estimated_total": "120.00",
          "currency": "CNY",
          "estimated_preparation_days": 2,
          "tags": [
            "other"
          ],
          "reason": "提供不同于咖啡主题的实用方向，不假定收纳偏好",
          "fact_refs": [],
          "inferences": [
            "收纳用品可能适合工作桌面"
          ],
          "unknowns": [
            "桌面空间和收纳习惯",
            "实际售价与供应情况"
          ],
          "presentation": "素色材料，详细方案待选择后生成"
        },
        {
          "id": "c3",
          "name": "便携笔记本与书签",
          "description": "纸品组合，估算包括礼物、基础包装、贺卡及配送",
          "estimated_total": "80.00",
          "currency": "CNY",
          "estimated_preparation_days": 1,
          "tags": [
            "other"
          ],
          "reason": "提供轻量书写方向，不把书写习惯当成已知事实",
          "fact_refs": [],
          "inferences": [
            "轻量礼物可能较少造成关系压力"
          ],
          "unknowns": [
            "是否使用纸质笔记本",
            "实际售价与供应情况"
          ],
          "presentation": "基础纸包装，详细方案待选择后生成"
        }
      ]
    },
    "expected": {
      "status": "failed",
      "all_passed": false,
      "candidate_passed": [
        false,
        true,
        true
      ],
      "code": "FORBIDDEN_TERM",
      "path": "candidates[0].description"
    },
    "note": "【已知限制的固定夹具——断言的是「仍被拒」，不是「该通过」】中文无词边界，词条「酒」会命中更长词「啤酒」内部的子串；否定标记「无」只作用于紧随其后的「酒精」，救不了被嵌进更长词里的字面命中。本用例**故意**保留为红：它是「本轮修复的边界」的可执行证据。将来若有人把它改成通过（例如引入分词/词边界），必须先改契约与提案文档，而不是悄悄改断言。修复前后均被拒，因此它在落地批次里不改变判定，只固定边界。"
  },
  {
    "id": "RF05_true_positive_red_wine_in_description",
    "request": {
      "recipient_relation": "青年用户与关系不错但不太熟悉的同事",
      "occasion": "生日",
      "budget_amount": "200.00",
      "currency": "CNY",
      "available_days": 2,
      "facts": [
        {
          "id": "f1",
          "text": "喜欢咖啡"
        }
      ],
      "forbidden_tags": [
        "alcohol"
      ],
      "forbidden_terms": [
        "酒"
      ],
      "notes": "希望表达祝福，不造成关系压力"
    },
    "candidate_batch": {
      "candidates": [
        {
          "id": "c1",
          "name": "咖啡主题杯垫与马克杯",
          "description": "精选礼盒，内含一瓶红酒，包装考究。",
          "estimated_total": "150.00",
          "currency": "CNY",
          "estimated_preparation_days": 1,
          "tags": [
            "other"
          ],
          "reason": "呼应用户提供的咖啡兴趣，不假定具体口味",
          "fact_refs": [
            "f1"
          ],
          "inferences": [
            "桌面实用品可能适合同事关系"
          ],
          "unknowns": [
            "是否已有同类物品",
            "实际售价与供应情况"
          ],
          "presentation": "简洁中性包装，详细方案待选择后生成"
        },
        {
          "id": "c2",
          "name": "桌面收纳套装",
          "description": "小型收纳组合，估算包括礼物、基础包装、贺卡及配送",
          "estimated_total": "120.00",
          "currency": "CNY",
          "estimated_preparation_days": 2,
          "tags": [
            "other"
          ],
          "reason": "提供不同于咖啡主题的实用方向，不假定收纳偏好",
          "fact_refs": [],
          "inferences": [
            "收纳用品可能适合工作桌面"
          ],
          "unknowns": [
            "桌面空间和收纳习惯",
            "实际售价与供应情况"
          ],
          "presentation": "素色材料，详细方案待选择后生成"
        },
        {
          "id": "c3",
          "name": "便携笔记本与书签",
          "description": "纸品组合，估算包括礼物、基础包装、贺卡及配送",
          "estimated_total": "80.00",
          "currency": "CNY",
          "estimated_preparation_days": 1,
          "tags": [
            "other"
          ],
          "reason": "提供轻量书写方向，不把书写习惯当成已知事实",
          "fact_refs": [],
          "inferences": [
            "轻量礼物可能较少造成关系压力"
          ],
          "unknowns": [
            "是否使用纸质笔记本",
            "实际售价与供应情况"
          ],
          "presentation": "基础纸包装，详细方案待选择后生成"
        }
      ]
    },
    "expected": {
      "status": "failed",
      "all_passed": false,
      "candidate_passed": [
        false,
        true,
        true
      ],
      "code": "FORBIDDEN_TERM",
      "path": "candidates[0].description"
    },
    "note": "真阳性用例：真含酒精且**未声明不含**。修复只放宽「已声明不含」的表述，绝不放过未否定的字面命中。断言的是「修复后仍被拒」。"
  },
  {
    "id": "RF06_true_positive_maotai_in_name",
    "request": {
      "recipient_relation": "青年用户与关系不错但不太熟悉的同事",
      "occasion": "生日",
      "budget_amount": "200.00",
      "currency": "CNY",
      "available_days": 2,
      "facts": [
        {
          "id": "f1",
          "text": "喜欢咖啡"
        }
      ],
      "forbidden_tags": [
        "alcohol"
      ],
      "forbidden_terms": [
        "酒"
      ],
      "notes": "希望表达祝福，不造成关系压力"
    },
    "candidate_batch": {
      "candidates": [
        {
          "id": "c1",
          "name": "茅台酒礼盒",
          "description": "桌面杯具组合，估算包括礼物、基础包装、贺卡及配送",
          "estimated_total": "150.00",
          "currency": "CNY",
          "estimated_preparation_days": 1,
          "tags": [
            "other"
          ],
          "reason": "呼应用户提供的咖啡兴趣，不假定具体口味",
          "fact_refs": [
            "f1"
          ],
          "inferences": [
            "桌面实用品可能适合同事关系"
          ],
          "unknowns": [
            "是否已有同类物品",
            "实际售价与供应情况"
          ],
          "presentation": "简洁中性包装，详细方案待选择后生成"
        },
        {
          "id": "c2",
          "name": "桌面收纳套装",
          "description": "小型收纳组合，估算包括礼物、基础包装、贺卡及配送",
          "estimated_total": "120.00",
          "currency": "CNY",
          "estimated_preparation_days": 2,
          "tags": [
            "other"
          ],
          "reason": "提供不同于咖啡主题的实用方向，不假定收纳偏好",
          "fact_refs": [],
          "inferences": [
            "收纳用品可能适合工作桌面"
          ],
          "unknowns": [
            "桌面空间和收纳习惯",
            "实际售价与供应情况"
          ],
          "presentation": "素色材料，详细方案待选择后生成"
        },
        {
          "id": "c3",
          "name": "便携笔记本与书签",
          "description": "纸品组合，估算包括礼物、基础包装、贺卡及配送",
          "estimated_total": "80.00",
          "currency": "CNY",
          "estimated_preparation_days": 1,
          "tags": [
            "other"
          ],
          "reason": "提供轻量书写方向，不把书写习惯当成已知事实",
          "fact_refs": [],
          "inferences": [
            "轻量礼物可能较少造成关系压力"
          ],
          "unknowns": [
            "是否使用纸质笔记本",
            "实际售价与供应情况"
          ],
          "presentation": "基础纸包装，详细方案待选择后生成"
        }
      ]
    },
    "expected": {
      "status": "failed",
      "all_passed": false,
      "candidate_passed": [
        false,
        true,
        true
      ],
      "code": "FORBIDDEN_TERM",
      "path": "candidates[0].name"
    },
    "note": "真阳性用例：名称字段真含酒精且未声明不含。与 RF05 一起覆盖 name / description 两条文本路径，防止「只看描述不看名称」式的过度放宽。断言的是「修复后仍被拒」。"
  }
]
```

