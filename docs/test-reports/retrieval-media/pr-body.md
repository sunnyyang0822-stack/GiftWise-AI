为 #59 / #60 建立独立验收准备，尚未执行新版业务测试。

- 准备基线 `3890aa57a2c728d3bd94fea00b9117f9d0a8aa93`；独立 worktree/分支，不修改主工作区。
- 已读取 AGENTS、Issue #1/#59/#60、最新QA报告和测试计划；共享契约以后台PR #61固定提交 `dbb4cad9370d04ed07742be820fc7383981797d2` 为设计来源，尚未进入release，未擅自更改业务字段。
- 交付63项矩阵：检索15、价格推荐18、图像20、表单10；含虚构商品/条件价/隐私哨兵/安全负例/坐标夹具及分层执行入口设计。
- 仅运行新增资产生成与自检：退出0；资产PASS 1，业务PASS 0 / FAIL 0 / SKIP 0 / BLOCKED 63。
- 真实检索、mock、离线夹具与真实图像服务分别设计/记录；不拼接结论。真实接口驱动待契约/交付/SHA锁定后编写执行。
- 待PM/后台对齐任务路由/状态/队列/取消/幂等、价格条件/有效期、图片任务和previous_gifts类型；不自行发明字段或阈值。
- 仅新增 `tests/acceptance/retrieval_media/**` 与 `docs/test-reports/retrieval-media/**`；保留PR #51及历史失败证据，不改业务、开发自测或旧断言，不重复执行旧版全量套件，不调用模型/图像付费服务/部署。

审阅入口：`docs/test-reports/retrieval-media/preparation.md`、`matrix.md`；机器矩阵/夹具及runner设计位于新的测试目录。原始自检输出、退出码、版本、来源快照和哈希均已保留。等待PM提供锁定集成SHA后执行实际独立HTTP、浏览器及适用回归。本PR请PM复核，不自动合并。
