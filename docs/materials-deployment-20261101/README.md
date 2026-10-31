# 部署状态材料更新与跨设备交接

这是独立审阅/协作包，不是已完成PPT/PDF排版的最终提交包。用户原目录和协作者工作区均未覆盖。

- input：从用户指定项目总目录复制的19个主文件，含最新PPT、PPT备用PDF、10页正式架构设计PDF、架构三源及最新成本分析。它们尚未改为部署版，严格校验INPUT-SHA256.json；当前PPT不是旧仓库723KB留档。
- submission：已更新的非PPT文字材料，包含讲稿、Demo、30题、专项部署增量和当前源码。旧专项分析以历史附录保留，不改原始指标；不要单独使用其中的历史命令作为生产现状。
- CURRENT-FACTS.md：事实与来源。PPT-CHANGE-MAP.md：逐页改稿要求。ARCHITECTURE-CHANGES.md：正式架构PDF逐页审查与附图修改。REPLACEMENT-NOTES.json：新口播文本。
- 源码实际运行 `19b6819fe80787717571beb7cc0d17f89587c2d9`；证据 `6e92a9e076d5989f7ad510bebf3639a9dd2dadf8`。部署报告：https://github.com/sunnyyang0822-stack/GiftWise-AI/blob/6e92a9e076d5989f7ad510bebf3639a9dd2dadf8/docs/deployment/2026-11-01/REPORT.md

下一设备负责按提示词修改PPT原生对象/备注、正式架构PDF及三源，重导全部PDF、渲染检查，再合并submission文字形成最终包，重算清单。当前输入PPT/PDF未改，不能称它们已同步。

源目录变动：快照完成后，原目录中的PPT备用PDF被其他操作移除，PPT和正式10页架构PDF均未变。input内该旧PDF仅为快照留档，不得原样恢复为最终交付；参见SOURCE-DRIFT.json。
