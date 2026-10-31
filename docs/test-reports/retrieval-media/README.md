# Issue #59/#60：检索推荐与选后图像工作流离线准备

2026-10-31，Asia/Shanghai。基线3890aa5包含PR55；继续独立worktree gw-context-nov01、codex/workflow-avoid-history及开放PR58，整理此前新增输入工作，不双写提示词。

已读取AGENTS、Issue #1/#59/#60、最新交付变更契约、intake/工作流规范及提示词。后台共享契约docs/design/retrieval-media-contract.md尚不在该release，开工查询没有对应开放PR；本线按#60草案做夹具和内容约束，**未发明冻结计划API或provider字段，接线BLOCKED**。

## 本次差异

- prompts/retrieval-plan.md：只给品类/通用词/预算/必要规格，不产生shell/脚本/浏览器执行代码；不外发完整原文、姓名、关系私密细节或过敏详情。实际schema/脱敏与执行限制由后台实现。
- prompts/evidence-recommendation.md：基于任务内product_id及商品证据解释三个方向，可信服务端绑定价格、规格和sidecar。模型不造来源、不改价、不写passed；不足三件前置澄清，不伪造三项喂validator。页面观察价不保证结算。
- prompts/packaging-image.md：三图source_photo/ai_illustration/demo真实标记；白底完整主体是风格，商品本体颜色不限。未选不生成包装图，同一已选商品参考图能力不支持则明确限制；底图无中文，少量中文标注用0–1坐标由前端叠加。包装不报价。
- generate/repair/presentation明确区分旧估算模式与服务端商品证据模式，保留事实/推断/未知、用户选择、追求对象低压力和全局一次兜底。dislikes“需要避免的”和previous_gifts独立历史语义继续沿用PR58准备。
- workflow-spec追加流程和门禁；examples/retrieval-media含草案sidecar和本线oracle。

本次提交890ab6a只改提示词、规范、示例；不改validator、intake、generated、web/server、前端或后台共享契约。PR58先前previous_gifts/intake/generated变更仍属于前任务，已经单独验原件，不冒称此次完成后台接线。

## 实测命令与结果

Python312=3.12.10，PYTHONIOENCODING=utf-8。执行 `python docs/test-reports/retrieval-media/verify_committed.py`：git archive提交890ab6a导出临时副本，重建前先实际检查9项blob SHA256，再运行如下命令，stdout/stderr独立归档。没有修改历史证据。

| Python312命令 | 结果 |
| --- | --- |
| workflow/build_code_node.py（仅临时副本） | PASS；原件重建前9/9、重建后9/9，产物逐字节一致 |
| -m unittest discover -s tests -q | PASS 337项 |
| workflow/verify_local.py | PASS 46项 |
| workflow/verify_local.py --nov01 | PASS 29项 |
| -m unittest discover -s tests/acceptance/stage_c -v | PASS 39项 |
| workflow/examples/avoid-history/verify.py | PASS 26项 |
| workflow/examples/retrieval-media/verify.py | PASS 20项 |

新证据bytes-20261031T131145805611+0800/results.json保留逐项原件/重建后摘要。git diff --check通过。

## 测试含义与未执行

20项覆盖product_id存在/一对一、改价、未知价、不足、错误任务引用、复制商品凑数、注入字符串仅数据、selected空状态、图像缺失/失败、标注和有限0–1坐标、错误候选选择。实际调用了validator；其余使用固定seed与null图片的本地oracle，不是后台绑定器或provider测试。固定selected=null不证明真实调度被阻止；字符串未执行不证明模型抗注入；固定坐标不证明箭头视觉定位正确。

OpenCLI真实检索、网页证据读取、图片使用授权核实、Dify、付费模型/图像服务、外观一致性、后台/前端同版联调、浏览器布局、部署和DSL均SKIP/未执行。模型调用0；token、真实服务延迟和成本测量未执行。不拼接旧线上证据充当新功能结果。

## 后台接线/PM协调清单

见workflow/examples/retrieval-media/README.md：后台唯一契约需冻结受限计划schema、模型商品引用输出schema、商品/任务/证据版本/过期校验、未知价/条件价/区间处理、有效商品不足三件的前置状态和稳定错误路径、零元非采购礼物来源策略、媒体参考图能力/失败/幂等与任务隔离。价格和商品外观/规格由服务端绑定核实，不接受模型覆盖。全部BLOCKED，未用本线oracle替代实现。

输入线遗留协调：previous_gifts的JS白名单/快照、历史明确不要重复的来源绑定确认、尺码信息缺口结构。过敏/模糊表达未可靠识别应澄清，不能降格偏好或填假禁忌词。合法预算无需额外复选框。

保留现有严格三候选validator：证据不足不上送两项或虚构项；图片失败不阻塞合格文本报告；选前不调包装、重复选择不重复创建付费任务须由后台实现验证。本PR只离线准备，待后台契约同版对齐与PM审查，不自行合并。
