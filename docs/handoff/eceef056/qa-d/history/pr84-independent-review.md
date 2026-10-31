> 发布副本：历史 PR#84，受审代码 `e2899a1c0789fa929b39de3a26ede77458f52c36`。独立 Agent 复核，非另一位人类账户批准；不是最终 eceef056 的新增执行证据。历史服务/合并状态和已被后续改动替代的说明不代表当前状态。原文SHA256与发布SHA256见 publication-manifest.json。

# PR84 前端异步图片最终必要独立复核（与PR83配套）

结论：无实质阻断，PR84可由PM与已复核PR83配套合并，不等待C。未重做PR83、未运行新测试或模型/图片/浏览器。
Issue #81 / PR #84：https://github.com/sunnyyang0822-stack/GiftWise-AI/pull/84
前端HEAD：e2899a1c0789fa929b39de3a26ede77458f52c36
后端依赖：PR83 HEAD26df1432218a15f49f3de1a796dc19d3d63da287
共同基线：b2cc4b62739f3b9e83ed5e196de284ad110b78c9
PR83原正式复核：https://github.com/sunnyyang0822-stack/GiftWise-AI/pull/83#pullrequestreview-5724187752

## 差异及代码确认

已审完整5文件diff/新增测试：results-view.js、media-view.js、app.js一行生命周期清理、styles.css一行pending样式、ui-async-presentation-media.test.mjs。五文件作者树与最终git对象相同（仅CRLF/LF归一），与PR83改动路径无交集。PR83协议已复核，直接复用其结论，没有改聊天、C工具或其他已交付模块。

results-view仅在所选candidate匹配、64hex真实task_id、media.status与selected.status同时pending时排程与loading；presentation_failed不查询，unavailable不假转pending。自动延时总63000ms/最多10次，每次HTTP超时10000ms，因此63秒是排程等待累计，不是保证总墙钟时长精确63秒。持续pending用尽保持真实pending并给只读刷新，不伪造供应商failed。

轮询/刷新唯一调用apiFetch('/api/media/tasks/<id>',null,{track:false,...})，没有新生图POST或重生成端点。active poll的inFlight防重复点击和并发；重复重绘同view保留attempt，不重启无穷窗口。手动刷新仅GET，若仍pending可开始新一轮有界查询，属于用户显式读取，不是图片重生。

异步响应检查active poll、epoch、view对象、requestVersion、candidate_id、task_id及双层状态一致后才写当前media。stopMediaPoll清timer、移除update并提升epoch；app离开/忙碌/完成/错误等路径调用清理。切任务或切版本创建新poll，离开后返回同view也不能接纳离开前旧epoch响应。旧GET不一定物理中止，但其结果失效，不覆盖新方案、不触发图调用。

更新通过mediaSlot.replaceWith只替换包装图片区，不调用全局render重建贺卡或赠送段落。每次GET开始/结束只更新该区域，原文字节点保持。media-view沿用同源图片URL校验，加载失败的“重试加载图片”只是重取既有字节；状态错误显示“刷新图片状态”，不声称重新生成。真实image.kind/version/attribution继续保留数据属性。候选图原逻辑未新增价格/来源门槛。

与PR83配套：后端先回completed文字和真实pending/task，GET直接media对象，字段/候选绑定及终态吻合；PR83服务端owner/run/candidate与只读隔离继续有效。两PR可以进入集成，不要求先等待C或扩成全产品E2E。

## 复用的原始验证

- async-media-targeted-2.txt为11/11、0失败/跳过；60s后端边界追加后只重跑持续pending专项，async-media-window-final.txt为1/1。已审源码/输出，未重复运行。最初DOM helper缺replaceChildren失败保留在-1日志，不宣称首轮全部成功。
- browser-output-1.txt保留ready/failed/unavailable三个通过及最后leave夹具选择器错误；browser-output-2.txt和browser-leave-results.json单独补验leave通过。初次总运行非exit0，不能改写为四场景一轮全绿。failed场景390px无横向溢出；四流程每场景presentation POST1次，状态刷新GET，未触发新生图。
- browser-a-real-task-replay.json/txt读取A共享原始pending/ready响应和JPEG；同task244d06bba8b0029a8664e3f07201e4b8aa0a9d997cd5e1e7ea5ed3b7bd35b85f、图hash3412964d8df46b5d019c2e1737ed16a4df7bd6a589a475c7d1225ec1db1a7663、660375B，Chrome解码naturalWidth2304、kind ai_illustration、贺卡与present-grid保持同一DOM节点。已读回放脚本：本地server回放既有A响应/字节，没有调用图片供应商。已独立查看a-real-task-ready-in-place.png，文字仍在原页、示意图出现。
- A这张图的原始JPEG SOF/magic/hash及共享副本逐字节一致已在PR83核过，此处复用，不再读成第二次真实供应商任务。A原424ms文本先回/10148ms真图完成/1次生图/外owner404属于PR83真实HTTP证据，E回放证明前端消费与展示，不是新一轮真实后端/认证链验收。
- final-syntax-and-diff.txt已有三份脚本语法和diff通过；本次未额外执行。

原始目录：E:\黑客松\.worktrees\frontend-async-presentation-media\.tmp\delivery.json、async-media-targeted-1/2.txt、async-media-window-final.txt、browser-output-1/2.txt、browser-leave-results.json、browser-a-real-task-replay.txt/json、verify-async-media-browser.mjs、shots/a-real-task-ready-text-first.png、shots/a-real-task-ready-in-place.png、final-syntax-and-diff.txt、service-status-final.txt。
共享：E:\黑客松\.tmp\async-media-shared\backend-82-244d06bb。
独立记录：E:\黑客松\.worktrees\backend-independent-review\.tmp\pr84-full.diff、pr84-evidence-audit.json及-raw.txt；PR83报告pr83-independent-review.md继续有效。

## 边界和运行状态

无新增验证失败或实质代码阻断。前端额外真实模型/图片调用0；其浏览器是实际app控制器+本地回放，未证明真实文字模型→呈现→图片整体同会话链、授权参考图/SKU一致、无烘焙文字视觉约束。PR83样图封面有商品名称，原已如实报告；显示该样图不消除视觉质量限制。内存run重启不恢复等PR83限制保持。

本复核没有代码修改、push/merge，没启动服务/浏览器/模型/图片/平台请求，不读.env或认证材料。作者service-status-final.txt记录8911无监听及自有三次Chrome进程退出、无登录/持续预览；本轮没有重复查其进程。最终只读必要核验完成，PM决定合并。
