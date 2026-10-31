# PR58：选后赠礼造景、手写感批注与商品引用离线准备

基线3890aa5含PR55，独立worktree gw-context-nov01，codex/workflow-avoid-history。延续原PR58，保留输入历史和此前检索准备，未双写其他工作树。本轮按Issue60最新造景要求和后台PR61@`7204b64718420da2a737610aefec02fbdba02204`的共享契约实施；只读fetch/show后台原件，没有改共享文件。

## 具体行为和字段

- 已选且通过的同一礼物才设计完整赠礼场景，礼物/包装为主体，有光影与环境氛围，不统一方盒。根据可信尺寸/形状/重量/易碎性选纸包、礼袋、圆筒、透明展示或异形包装；未知则明示比例示意或澄清，不伪造精确尺寸，不改变型号颜色数量及相对大小。环境道具不算附送商品。
- 默认3–5处自然简短中文手写感批注，细线弯曲箭头由前端叠加；说明实际配色、包装形态、贺卡位置，不机械编号或抒情堆砌。底图无文字/箭头，AI效果示意，非商品实拍。包装不报价，不计礼物预算不等于免费。
- annotations只用后台既有id/text/target/label，有限0–1坐标。坐标是待复核提案，必须针对最终图片检查物体位置、遮挡和可读性；无真实图或不能核实则不交付ready的selected，本轮夹具unavailable/selected=null。没有新增曲线/字体/定位状态接口字段；前端呈现与后台最终状态载体须PM协调。
- 后台新增输入retrieval_json字符串、输出独立product_references_json字符串（解析值仅candidate_id/product_id对象数组），一一对应c1/c2/c3且不重复商品；候选name=商品name + " · " + variant，estimated_total原样匹配price_amount，不改严格候选结构。缺失/错ID/错型号/改价阻止选择；不足三种商品RETRIEVAL_INSUFFICIENT，不调用生成者。
- 继续dislikes“需要避免的”分类澄清、previous_gifts独立历史、追求对象低压力、用户选择及全局一次失败兜底，无预算重复确认框。

## 修改范围

本轮仅workflow/prompts/{evidence-recommendation,packaging-image,retrieval-plan,presentation}.md、workflow/workflow-spec.md、workflow/examples/retrieval-media/{cases.json,scene-drafts.json,verify.py,README.md}及本线新报告。前任务PR58中的Python/生成物输入增量仍保留，单独边界见docs/test-reports/avoid-history/README.md。本轮不修改intake/validator/web/server/前端/共享契约/生成物；不更改规则语义。

scene-drafts.json的外层description/known_product/unknowns/annotation_drafts等仅离线编辑测试结构，不是provider请求字段；提交到业务API的annotations仍只有后台既定结构。可信尺寸/形状/重量属性未在商品共享字段完整定义，只写内容约束，不把本线测试外层键变为接口。

## 实际命令和证据

实现提交`482dfbbc6d165621cb70ea1dea646753dcf4be67`。Python为指定Python312（3.12.10），PYTHONIOENCODING=utf-8。

`python docs/test-reports/retrieval-scene/verify_committed.py`先git archive实现提交到全新临时副本，检查提交原件9/9指纹后才运行构建。以下stdout/stderr原样归档于bytes-20261031T132446244592+0800：

| 命令 | 结果 |
| --- | --- |
| workflow/build_code_node.py（仅临时副本） | PASS；原件重建前9/9、重建后9/9，产物逐字节不变 |
| -m unittest discover -s tests -q | PASS 337项 |
| workflow/verify_local.py | PASS 46项 |
| workflow/verify_local.py --nov01 | PASS 29项 |
| -m unittest discover -s tests/acceptance/stage_c -v | PASS 39项 |
| workflow/examples/avoid-history/verify.py | PASS 26项 |
| workflow/examples/retrieval-media/verify.py | PASS 44项 |

44项含精确引用字符串与sidecar对应、name/model匹配、改价拒绝oracle、未知/条件价/区间/不足、selected归属、坐标边界、3/4/5条短标注、ID唯一、未定位不ready、同礼物/比例未知/道具说明。调用真实validator，但价格绑定仍为本线测试oracle，不冒称后台接线验收；固定unavailable状态不证明真实调度器已正确拦截。样例文字检查不证明实际生成图保持外观或箭头定位正确。

旧证据未覆盖。git diff --check通过。没有以重建后结果掩盖提交原件；manifest/source原始blob结果和重建后结果分开记录。

## 待后台/前端/PM协调

PR61共享契约已明确商品引用信封。本轮不把后台worker内部category/keywords/limit参数擅自升级为公开计划API：计划精确字段/上限仍需写进共享文档。图像provider输入、参考图支持能力、最终图定位复核状态/说明、可信尺寸重量属性来源尚待PM/后台定义。服务选型等待产品负责人和PM。本线不自行选型、不增加共享字段。

前端负责手写字体/细曲箭头样式、等价文字、窄屏放大；后台负责选后合格归属和幂等、真实证据价格绑定、真实图片权限与SKU核对、最终图定位未确认的状态；这些未同版联调。此前previous_gifts JS/确认来源绑定仍待协调，不声称端到端完成。

## SKIP/BLOCKED

- SKIP：Dify、模型/图像服务、真实检索、真实图生成与最终图定位、前端视觉/手机/缩放、部署与DSL。
- 模型和图像调用数0；token、服务延迟、成本测量均未执行。
- BLOCKED：上述共享接口补充及后台/前端同版接线。固定夹具不代表真实检索或图像生成通过；旧线上证据不能用作本版能力证明。

待PM审查，不自行合并。此前输入和检索工作报告保留于avoid-history、retrieval-media目录；本报告覆盖本轮最终差异，不拼接历史通过数为端到端结论。

## 2026-10-31 v2 对齐小批（本 PR 后续提交）

依据后台 PR #61 最新提交 `e0c76cad548ffa371287837a36e0fae2a48f0ecf` 的 `retrieval-media-v2`：更新了受限计划、商品证据说明、选后造景与曲线标注提示词，并新增 `workflow/examples/retrieval-media/v2-cases.json` 与 `verify_v2.py`。夹具明确是离线结构数据，不是 provider 请求或真实图片结果。

实际命令（Python 3.12.10）：

- `python workflow/examples/retrieval-media/verify.py`：PASS，44 项；旧商品引用、独立 validator、注入字符串不执行、选前无图和旧标注边界。
- `python workflow/examples/retrieval-media/verify_v2.py`：PASS；计划三键白名单、physical 五项 unknown、选后无图仍保留 selected 元数据、包装/场景布尔边界、image_version/handwritten/curve 坐标结构。
- `python -m unittest discover -s tests -q`：PASS，337 项。
- Dify、模型、Seedream/任何图片服务、OpenCLI：未执行；token、延迟、费用：未测。

仍需后台/PM 接线与独立 QA：真实 provider 的 image.version、最终图像目标点核对、换图重新校准、字体与窄屏显示、物理来源真实性。结构通过不代表真实生图或视觉定位通过。

## RM-003 修复（本 PR 后续提交）

按后台 PR #61 最新提交 `e034aa5` 修复 v2 字段遗漏：提示词、夹具和 oracle 现在覆盖 `physical`、`image_version`、`text_style`、`curve`、`annotation_status`、`plan_version`、`execution`。无图状态保持 selected 候选元数据，`image=null`、`annotations=[]`、`status=unavailable`，并使用 `execution=not_submitted`、`annotation_status=not_verified` 的离线状态。

Dify 边界统一为外部 `intake_json`；若可信接入层内部继续使用 `request_json`，必须显式做 `intake_json -> request_json` 映射。`previous_gifts` 随冻结需求传递，仍是软历史，不进入硬禁忌。

最终命令：

- `python workflow/examples/retrieval-media/verify.py`：PASS，49 项。
- `python workflow/examples/retrieval-media/verify_v2.py`：PASS。
- `python -m unittest discover -s tests -q`：PASS，337 项。
- `python workflow/verify_local.py --nov01`：PASS，29 项。
- `git diff --check`：PASS。

Dify、模型及图片服务均未调用。结构 oracle 通过不代表真实图片、视觉坐标或线上 Dify 已验证。

## 最新后台合并基线对齐（RM-003 follow-up）

本次工作树已合入后台 `f080ad51e0f22ca7384ce3a93f75d0dba91d0508`。v2 夹具进一步包含 `previous_gifts`、`retrieval_json`、`product_references_json` 和 `intake_json` 映射；文档中的旧后台 SHA 已更新。工作流自身未修改前端或后台。

最终离线命令：

- `python workflow/examples/retrieval-media/verify.py`：PASS，49 项。
- `python workflow/examples/retrieval-media/verify_v2.py`：PASS。
- `python -m unittest discover -s tests -q`：PASS，337 项。
- `python workflow/verify_local.py --nov01`：PASS，29 项；脱敏产物保存于 `docs/test-reports/nov01-workflow/`。
- `git diff --check`：PASS。

PASS 仅表示固定代码和夹具的离线结构/规则行为。SKIP：Dify、模型、OpenCLI、Seedream、视觉定位、前端联调。真实 Dify 仍需统一 SHA 后按 PM 指示做一次最小调用。

## RM-003 回归（本轮）

检查并清理工作流文件中的旧接线措辞：保留 `intake_json -> request_json` 显式边界映射，移除“缺少 intake_json 返回400”的旧表述。确认 previous_gifts 仍随冻结需求传递为软历史，不进入 hard_exclusions/dislikes；选后媒体继续支持 selected 元数据、image=null、annotations=[]、status=unavailable，并保留 physical、image_version、plan_version、execution、annotation_status、curve。

实际命令：

- `python workflow/verify_local.py --nov01`：PASS，29 项；cloud_not_verified，model_calls=0。
- `python workflow/examples/retrieval-media/verify_v2.py`：PASS；provider/image/visual-coordinate verification SKIP。
- `python workflow/examples/retrieval-media/verify.py`：PASS，49 项；OpenCLI/Dify/image_service 未执行，token/latency/cost 未测。
- `git diff --check`：PASS。

本轮只改 workflow/prompts 与 workflow/workflow-spec.md；未修改 web/server、web/public 或共享契约。

## RM-003 previous_gifts 生成物回归（本轮）

固定后台合并基线 `f080ad51e0f22ca7384ce3a93f75d0dba91d0508`。复核 `workflow/intake.py` 与 `workflow/generated/intake_node.py`：previous_gifts 已在白名单中，非字符串返回 `INVALID_TYPE`，超过1000 Unicode码点返回 `LIMIT_EXCEEDED`，有效值随 request_json 原样传递；不会写入 hard_exclusions 或 dislikes。Dify 外部变量为 intake_json，request_json 仅由适配层生成。

实际命令与结果：

- `python workflow/build_code_node.py`：PASS，manifest 源码/生成物指纹重建完成，cloud_verified=false。
- 原始适配器虚构 intake_json 断言：PASS，status=ready，previous_gifts 原样保留，hard_exclusions 未变，dislikes 为空。
- 生成 `workflow/generated/intake_node.py` 同样断言：PASS。
- `python workflow/verify_local.py --nov01`：PASS，29 项，cloud_not_verified，model_calls=0。
- `python workflow/examples/avoid-history/verify.py`：PASS，26 项；历史明确排除门禁仍 BLOCKED（按契约待 PM/接入线）。
- `python workflow/examples/retrieval-media/verify.py`：PASS，49 项。
- `python workflow/examples/retrieval-media/verify_v2.py`：PASS；provider/image/visual-coordinate verification SKIP。
- `python -m unittest discover -s tests -q`：PASS，337 项。
- `git diff --check`：PASS。

本轮没有 Dify、模型或 provider 调用，model_calls=0，token/延迟/成本未测。历史失败证据未删除。

## previous_gifts release probe（本次交付）

固定工作流分支提交前执行，后台统一基线仍为 `f080ad51e0f22ca7384ce3a93f75d0dba91d0508`。新增 `tests/acceptance/retrieval_media/previous_gifts_release_probe.py`，比较 `workflow/intake.py` 与 `workflow/generated/intake_node.py` 的同一虚构输入：省略、空字符串、全空白、合法文本、非字符串、1001码点超长。

六类均 PASS：省略/空白为 ready 且不造硬约束；合法文本 ready 并原样保留；非字符串为 `INVALID_TYPE` / `intake.previous_gifts`；超长为 `LIMIT_EXCEEDED` / `intake.previous_gifts`；源节点和 generated 节点结果完全一致。

本轮命令退出码：build=0、probe=0、verify_local=0、nov01=0、avoid-history=0、retrieval-media=0、retrieval-media-v2=0、compileall=0、diff-check=0。Dify、Seedream、OpenCLI、模型调用均为0。
