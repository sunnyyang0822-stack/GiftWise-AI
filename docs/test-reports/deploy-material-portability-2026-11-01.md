# 部署增量：匿名素材导入根可移植性

关联 Issue #124 / #109。基线为产品负责人锁定的 main `15e29edcc150c3a4a8a9ba04e9f0c8a2bb614879`，其代码树与已验收 `eceef056` 相同。本增量不变更产品范围或推荐/选后生图流程。

原导入器将允许根固定为 `resolve('E:/黑客松')`，其他设备和正常 Linux 运行目录中的合法匿名素材包会被拒绝。现使用当前模块位置推导的 `REPO_ROOT`，与运行副本的工作树边界一致；不依赖启动时 cwd，也不扩大到任意外部路径。

保留原有逐祖先 symlink/junction 检查、源码树外拒绝、256KiB/80条上限、严格JSON、公开来源、匿名字段及原观察时间校验。现有树外测试改为平台无关路径，补充切换到系统临时工作目录后仍能导入当前源码树内素材的回归。

【实测】本机 Windows / Node v24.21.0，执行：

```text
node --test web/tests/material-bundle.test.mjs web/tests/material-cache.test.mjs
tests 18 / pass 18 / fail 0 / skipped 0
git diff --check
exit 0
```

测试仅使用本独立clone的临时虚构素材及注入cache，未读取原演示库、真实用户状态或秘密；没有模型/检索/图片调用。已有基线51项必要QA与受控HTTP结果复用，本轮只补路径相关验证，不将开发定向测试记作独立QA。

【未测】该报告生成时尚未完成Compshare Linux运行、真实数据导入或公网/供应商验收；相关结果后续在 #109 单独记录。Linux若需进一步源码适配，仍须提交新版本并更新证据，禁止仅在服务器留未提交补丁。
