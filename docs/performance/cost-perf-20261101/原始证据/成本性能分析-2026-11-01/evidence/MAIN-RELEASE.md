# 主线收口与版本对应

【授权】产品负责人在 PM 会话明确：走查通过，可以合并主线。

【实测：GitHub】PR [#111](https://github.com/sunnyyang0822-stack/GiftWise-AI/pull/111) 于 2026-10-31T20:54:40Z 合并。

- 最终代码分支：main。
- 最终代码 SHA：15e29edcc150c3a4a8a9ba04e9f0c8a2bb614879。
- 实际独立 QA / 走查提交：eceef056ce80399b83c61f62860a32d0ead16e3d。
- 两者完整代码树：2772f6d022a15ca98d0d8be9ec0f82033445c182。
- 主线合并父提交：bd1b17e5a9232ee3ced1987990531f84bfeccd2a、eceef056ce80399b83c61f62860a32d0ead16e3d。
- 代码、提示词、测试、必需静态资源字节完全一致；合并前 merge-tree 与合并后 GitHub commit tree 都核对为上述代码树。
- 没有为相同代码树重复运行测试或调用供应商。QA 报告原文继续标注实际受测 SHA，不重新贴成主线提交的运行记录。

材料分支只增加 docs/handoff/eceef056；目录名沿用受测提交前缀。独立 QA 报告、组件证据和原始输出保持原版本溯源；本记录与 version-manifest.json 提供主线映射。证据提交 SHA 在推送后的固定远端回执给出，不在自身文件中循环引用。

【未测】Compshare 资源、公网、跨设备启动及最终真实供应商验收尚未执行。有条件交接、路径迁移与其他限制继续按 HANDOFF-REPORT.md；主线合并不等于云端部署放行。
