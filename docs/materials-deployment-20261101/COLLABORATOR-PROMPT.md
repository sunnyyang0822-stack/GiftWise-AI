# 可直接转发给另一设备协作者的完整提示词

你是 GiftWise AI 提交材料集成负责人，在另一台设备工作。产品负责人已授权：以已完成的 Compshare 公网部署更新答辩 PPT、正式架构设计 PDF 和架构附件，保持现有视觉风格并交付远端可读取的最终文件。请直接完成，不只给建议。

## 先从云端取得真实底板

仓库：https://github.com/sunnyyang0822-stack/GiftWise-AI

材料固定提交：`3758e869a5d9e87b5cffe321c51a201b9e88302d`

材料分支：`codex/deployment-materials-handoff-20261101`

唯一材料入口：
https://github.com/sunnyyang0822-stack/GiftWise-AI/tree/3758e869a5d9e87b5cffe321c51a201b9e88302d/docs/materials-deployment-20261101

必读事实：
https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/3758e869a5d9e87b5cffe321c51a201b9e88302d/docs/materials-deployment-20261101/CURRENT-FACTS.md

PPT逐页改稿表：
https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/3758e869a5d9e87b5cffe321c51a201b9e88302d/docs/materials-deployment-20261101/PPT-CHANGE-MAP.md

正式架构PDF及附图逐页修改表：
https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/3758e869a5d9e87b5cffe321c51a201b9e88302d/docs/materials-deployment-20261101/ARCHITECTURE-CHANGES.md

原始部署验收报告：
https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/6e92a9e076d5989f7ad510bebf3639a9dd2dadf8/docs/deployment/2026-11-01/REPORT.md

先阅读仓库AGENTS.md、产品定位Issue #1和材料README。可在独立目录执行：

```sh
git clone --filter=blob:none --no-checkout https://github.com/sunnyyang0822-stack/GiftWise-AI.git giftwise-materials
cd giftwise-materials
git fetch origin codex/deployment-materials-handoff-20261101
git checkout --detach 3758e869a5d9e87b5cffe321c51a201b9e88302d
git switch -c codex/materials-deployment-final-20261101
```

所有文件都从固定提交读取，不依赖部署负责人的电脑路径。校验该目录的SHA256SUMS.json与INPUT-SHA256.json。input是用户指定项目总目录的完整主材料快照，submission是已经更新的非PPT文字与源码覆盖层。

PPT唯一输入为 `input/01-答辩材料/GiftWise-AI-答辩.pptx`，SHA256：`cd387e867bb4e71292745fdd653a60639ce601cc6b8d09a4a4b211903f856966`。保持8页、原视觉与原生可编辑文本。不要使用旧仓库docs/deliverables中723KB的另一底板，不要用旧构建脚本反向覆盖用户保存版。

用户指定的正式架构设计为 `input/02-提交材料/专项材料/GiftWise-AI-系统架构设计.pdf`，10页，SHA256：`ee97175b863f54eb68ed6c258b4d4fa7717fb10abe766be2e288cf4e2f72e8e6`。它是正式交付文档，不能仅改PPT P04或旧架构PNG就声称架构设计已同步。

注意SOURCE-DRIFT.json：快照后原目录里的PPT备用PDF被其他操作删除，PPT和正式架构PDF未变。input中的旧PPT备用PDF只供历史核对，不原样恢复为正式交付；修改后可生成新的审阅PDF，并与正式架构PDF分开命名。

## 在你这台设备开启子Agent协作

本提示词明确授权你在本任务中启动子Agent，按文件归属协作，不要让多人写同一文件。

1. PPT Agent：负责PPT原生对象、P01–P08正文与8页备注。使用当地可用的PPT技能执行原生编辑和渲染检查；读取PPT-CHANGE-MAP、PPT-TEXT-AUDIT、REPLACEMENT-NOTES。保留成本协作者已经补充的成本假设和fixture口径，按当前事实修正正文/备注不一致，不整套重设计。
2. 架构 Agent：负责正式10页架构设计PDF、P04所用的新架构图资产，以及单独PNG/SVG/drawio三源。使用PDF技能，逐页按ARCHITECTURE-CHANGES修改并渲染检查。若正式PDF缺可编辑源，在独立目录补建可编辑源并保留10页结构与视觉，不把整页截图打字伪装为原生源；图件完成后交由PPT Agent放入P04，架构Agent不要直接写PPT。
3. 独立复核 Agent：在前两者完成后只读核对事实、页数、原生可编辑对象、备注/讲稿、链接、图文边界与全部渲染页。开发自检不能冒称独立验收。发现问题交回文件负责人修复。

你作为根负责人管理分工、合并文件、清单与最后推送。若工具/技能有真实缺口，报告具体缺什么，不要假造渲染或质量检查；已明确授权的定点编辑不需再向部署PM重复申请上线批准。

## 统一事实，严禁退回旧口径

- 公网入口 **http://117.50.83.57/**，仅HTTP，不能写HTTPS或把二维码补成https。用户已实际确认首页可见。
- 实际部署SHA：`19b6819fe80787717571beb7cc0d17f89587c2d9`，部署分支codex/deploy-portable-material-root-20261101，PR #125尚未合并。证据SHA `6e92a9e076d5989f7ad510bebf3639a9dd2dadf8`与材料SHA另列。不得写成main已经自动升级；不再把9887572、307或0ad650当当前公网版本。
- 真实运行：Compshare Ubuntu22.04.4、Node24.16.0、Nginx公网80转内部8787、systemd单实例。没有用Docker/K8s/Redis，没有在P40上本地跑模型；8核64GB/P40是配置，不是实耗证明。
- 真实文字素材HTTP检索+合法历史摘要→模型结合完整需求给三个可选方案→独立预算/禁忌/结构校验→用户明确选择。时间不影响可选性。不要恢复推荐卡网图、搜图槽位或推荐轮询。选择后文字先回、AI图异步更新；纯体验无实体交付时不强行包装空章。
- 本轮公网样本：推荐39.391秒，文字12.797秒，后台图10.960秒；三者不是可相加的完整端到端，更不是P95。文本5次全部ok、29513 tokens，业务修订1次；生图1张、2304×1728、877634字节，无参考图输入。另会话读run/task/asset404。自然语言解析未在本轮另付费实测。
- 保留成本协作者约0.35元/任务、100次约35.22元的明确用量假设与fixture峰值86.54MiB；与公网样本分开。云资源0.38元/小时、两天约18.24元是推算；供应商实付未测。
- 独立SQLite、缓存、媒体、审计、账本已落盘，在线数据库备份检查ok。run/analysis/selection/签名密钥仍在内存，重启旧流程失效；媒体文件不能保证旧会话可读。多副本未实现，重启恢复、实际回滚、压测和完整浏览器点击闭环未验收。
- 正式架构PDF第3页HTTP与实际Nginx/systemd边界、第7页跨重启可查、第9页检索必然降级成功/生图免费重试/关闭页面不再花费、第10页上云仍待完成等必须按修改表纠正。不要用“检索失败始终纯模型继续”掩盖没有合法文字依据时的真实失败。
- 平台计划北京时间2026-11-03 05:11关机，届时站点停止，不宣称永久可用。不得改服务器、延长费用、操作8903/演示库或重跑付费模型/生图来补材料。

## 完成交付

以input为底板，应用submission更新；原始历史数据保留且显式标历史，不篡改原测量。重点更新主PPT、8页备注、独立讲稿、Demo、30题、正式架构PDF及三源、版本/文件清单和总README。submission中已提供当前部署19b6819完整源码ZIP，不能把旧9887572包改名冒充新代码；包SHA256见随附README。

最终不得把输入旧PPT/PDF、旧manifest里的32文件数和旧哈希直接算作已更新交付。先渲染全部8页PPT与全部10页正式架构PDF，逐页目视溢出、截断、文字可读和图件一致；PPT备注与讲稿逐页核对。源图、PNG、drawio与P04标签一致。二维码/超链接必须编码正确HTTP公网入口。

将修改后的PPTX、审阅PDF、正式架构PDF、PNG/SVG/drawio、可编辑源、更新文字、全文件SHA256清单和复核报告推送到你的独立远端分支，正常开PR到材料分支供审阅，不擅自合并或发布到生产服务。没有远端文件和完整SHA，不算跨设备交接完成。

最终回报：完整提交SHA、分支/PR、PPTX/架构PDF/图件的固定云端下载链接、具体改页、独立复核命令与结果、未完成项及影响。把结果交产品负责人转回材料PM；不创建重复部署Issue，不关闭或改动他人的Issue。可在明确获授权的Issue #109补材料交接链接。
