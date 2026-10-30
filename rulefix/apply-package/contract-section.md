## 9. 字面匹配的定位与责任划分（2026-10-31）

`request.forbidden_terms` 的匹配是**字面匹配**。它是禁忌约束的**不完整兜底**，不是禁忌语义的判定者。

- **本层只做确定性字面识别**：词条出现在候选文本即 `FORBIDDEN_TERM`。自 2026-10-31 起，**明确声明不含**的表述（`不含酒精`、`无酒`、`不含酒类` 等）视为已声明，不计为命中。该识别仍是字面模式：不调用模型、不引入分词、不新增依赖。
- **语义禁忌由生成侧负责**：把「忌酒」这类意图解析为类别（`hard_exclusions.tags` → `forbidden_tags`）与字面词（`terms` → `forbidden_terms`），是生成／适配侧的职责；校验器不推断意图、不猜同义词、不做语义等价，也不自动由类别生成词条或由词条推断类别。
- **已知不完整（必须与「通过」结论同时陈述）**：中文无词边界，词条会命中更长词内部的子串（词条「酒」命中「啤酒」），因此 `无酒精啤酒` 这类表述**仍会被判 `FORBIDDEN_TERM`**；反之，用「陈年佳酿」等避开字面词的表达**不会被本层拦住**。
- **因此**：「候选通过规则门」**不等于**「禁忌已被可靠拦截」。对外口径不得据本层通过宣称禁忌拦截可靠。
- 上述残留各有一个可执行的固定夹具：`tests/test_cases.json#RF04_KNOWN_LIMIT_wu_jiu_jing_pijiu_still_rejected`（字面命中嵌在更长词内，断言的是**仍被拒**）与 `tests/test_cases.json#RF05_true_positive_red_wine_in_description`、`#RF06_true_positive_maotai_in_name`（真阳性，断言的是**仍被拒**）。
- 本节的落地批次：`validator/rules.py` 否定语境识别（+69/−2），补丁与沙箱证明见 `rulefix/negation-fix.diff`、`rulefix/variant/`、`rulefix/evidence/`；该修复**不解决**「用同义表达绕过字面词」的路径，对外记法为 **Q7 未解决**。
