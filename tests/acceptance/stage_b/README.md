# 阶段 B：推荐校验器契约验收

仅运行本地公开 `validator.validate`，不调用模型、Dify、商品服务或部署服务。
本套件另建虚构基线、输入变体和预期断言，不导入开发自测，不读取开发 fixture 的业务数据。
四个交付文件只为版本核对计算 SHA256。测试代码与数据独立，但本聊天此前参与开发，不能视为人员隔离的第三方验收。

在仓库根目录运行：

```powershell
python tests/acceptance/stage_b/run_acceptance.py
```

此命令运行 254 个独立输入案例及 6 个版本/快照一致性检查；将逐例原始参数、预期、实际响应、断言失败详情、环境、命令和哈希写入 `docs/test-reports/stage-b/` 下全新的时间戳目录。失败返回非零退出码。不会覆盖先前证据。

也可以只运行 unittest（该方式不生成完整证据）：

```powershell
python -m unittest discover -s tests/acceptance/stage_b -v
```

`cases.json` 已包含完整可复现数据，无需重新生成。`build_cases.py` 是构造来源，只在目标不存在时生成，使用独占创建以避免覆盖；需要比较生成内容时，应在独立副本中运行。

依据为 Issue #2 的 PM 契约确认评论、PM 修复复审评论及本地 `docs/validator-contract-decisions.md`。
空标签测试检查三个候选位置，并验证仅失败项不通过、其他合格项保持通过；另验请求空禁忌和候选可空数组仍可用。
固定前后快照只证明离线检查结果，不证明模型修订、修订次数或工作流状态保护。
