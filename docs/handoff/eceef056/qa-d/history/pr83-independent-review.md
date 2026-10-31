> 发布副本：历史 PR#83，受审代码 `26df1432218a15f49f3de1a796dc19d3d63da287`。独立 Agent 复核，非另一位人类账户批准；不是最终 eceef056 的新增执行证据。历史服务/合并状态和已被后续改动替代的说明不代表当前状态。原文SHA256与发布SHA256见 publication-manifest.json。

# PR83 异步生图后端最终必要独立复核

结论：无实质代码阻断，可由PM合并到integration。只认可本后端异步/复用/隔离范围，不标记E前端或完整模型推荐端到端验收通过。
Issue #82 / PR #83：https://github.com/sunnyyang0822-stack/GiftWise-AI/pull/83
绑定HEAD：26df1432218a15f49f3de1a796dc19d3d63da287
基线：b2cc4b62739f3b9e83ed5e196de284ad110b78c9

## 完整差异及关键路径

已审完整5文件diff：pipeline.mjs选后缓存/生图尾段、media/plan.mjs、provider.mjs、task-store.mjs和backend-async-image-a.test.mjs。五文件作者工作树与固定git对象内容一致（仅CRLF/LF归一），指纹见pr83-evidence-audit.json。没有web/public或C推荐tools前段改动。

- pipeline移除图片等待Promise.race及30秒notice；只有文字校验通过、选定冻结后才建立媒体任务。packaging等待任务持久化建立，execute的供应商网络Promise留后台；立即返回completed文字/sections和真实media pending/task_id。media_wait兼容保留但waited=false、waited_ms/timeout_ms=0，没有伪造图片ready。
- 同候选并发仍由原presentation_jobs去重；重复已完成文字的POST进入selections缓存，恢复当前selected_candidate_id和冻结文字，只调用mediaProvider.task刷新媒体状态，不调用文本/图片供应商。切回旧方案复用同任务。不同候选首次选择可各有一张图，不承诺全run不论换选都只有一次生图。
- provider的WeakMap/key沿用run对象+candidate+plan版本，磁盘task ID由run/candidate/版本指纹确定；创建用wx排他，仅saved.created才execute。此次补强已有记录的owner/run/candidate校验，读cached pending也使用task(run,id)归属校验。失败/缺配置保持原任务或unavailable，无新增自动重生成入口。
- 未配置图片/未授权路径立即unavailable，不建假pending任务；图片失败/超时只影响media，完成文字与选择仍保留。付费门禁、参考图授权沿用原实现。
- task-store.read对非当前executor的pending仅在读出的对象派生failed/IMAGE_EXECUTION_UNKNOWN，不再save。GET任务路由先按存储run找内存run并验owner，再验candidate；读资产还验ready和字节哈希，状态查询不提交供应商、不写任务文件（路由更新内存run.media属于当前视图刷新）。跨会话与未就绪asset保持404。
- plan v4显式加入所选style/card_text/giving_advice和完整request.exclusion_context，原话/用户修正优先、解释/置信度不是用户事实；JSON为数据，原有真实reference许可未移除。无参考图仍标注主题示意，不声称SKU或尺寸一致。

## 已有证据核验

只读核验，没有重跑测试、真图、模型、浏览器或HTTP服务。

1. targeted-async-1.txt原始8/8、0失败/跳过；源码包含未完成图片Promise时文字已回、ready/失败/缺配置、同选并发/重放、切回旧方案、owner/run/candidate、上下文、GET只读及真实HTTP路由的受控字节证据。
2. targeted-existing-media.txt原始3/3、0失败/跳过，仅指定三个受影响既有测试。没有重跑全量，不宣称既有其他失败消失。
3. real-async-image.txt和原始presentation-response.json：POST424ms，HTTP200/completed，四段文字，pending与64hex任务244d06bba8b0029a8664e3f07201e4b8aa0a9d997cd5e1e7ea5ed3b7bd35b85f。duplicate-response是同任务pending；task00–04 pending，05 ready；ready-replay同任务ready。原图结果后台elapsed_ms=10148，账本一条submission+一条result，usage.generated_images=1；跨owner任务/图片404由同次原始HTTP记录支持。
4. 独立读取原图image.jpg并解析JPEG SOF：660375字节、magic ffd8ffe000104a4649460001、2304×1728，SHA256=3412964d8df46b5d019c2e1737ed16a4df7bd6a589a475c7d1225ec1db1a7663，和原响应image/jpeg/代际元数据相符。E共享副本逐字节相同，能复用既有真图而无需新付费。
5. 独立打开该图：为笔记本/纸袋/卡片主题示意，封面可见“简洁笔记本方向1”字样。因此没有把prompt“不绘制说明文字”等要求宣称已全面符合；异步链路通过与生成图视觉质量分开。reference_count=0、product=null，不证明真实SKU外观、包装适配或场景禁忌完全遵循。

原始证据：E:\黑客松\.worktrees\backend-async-image-a\.tmp\delivery-async-image-a.md、targeted-async-1.txt、targeted-existing-media.txt、real-async-image.txt、real-image-ledger.jsonl、real-async-evidence/。
共享：E:\黑客松\.tmp\async-media-shared\backend-82-244d06bb。
本复核：E:\黑客松\.worktrees\backend-independent-review\.tmp\pr83-full.diff、pr83-evidence-audit.json及-raw.txt。

## 限制与运行状态

需求/候选/呈现文字均为受控夹具，真实文本调用0，只有这一次Seedream图片是真实供应商执行；cost_status=not_measured。真实请求上下文进入图计划已核对，不冒充真实推荐/呈现模型闭环。没有前端原位加载/poll/离开失效的本轮验收，E后续PR独立交付；不因其未ready阻塞本后端，也不把本后端当完整UI通过。C OpenCLI/京东淘宝实际商品图不在本单门禁内。

run/选择仍是内存快照，进程重启后原run不可恢复。脱离内存run的旧任务HTTP可为404；task-store自身读旧pending则派生执行未知失败。不要将store读取行为夸大为重启后原HTTP业务链可恢复；没有新worker/持久run工程承诺。没有实测进程重启的完整HTTP恢复。

本复核无新测试/新失败、无代码修改或push/merge，没有读取.env/认证、没有启动服务/浏览器/模型/图片/采集。作者原始日志记录自有8904关闭与释放，无新登录会话；本轮不重复查其进程，不冒称独立关停。保留已有证据，不再生成第二张图。
