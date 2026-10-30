# 阶段 A 仓库证据采集

在仓库根目录使用已有的 **PowerShell 7**：

```powershell
pwsh -NoProfile -File tests/acceptance/stage-a/audit.ps1
```

每次自动生成新的证据文件，路径显示在命令输出中。默认目录为 `docs/test-reports/stage-a/evidence/`，文件名包含北京时间及随机后缀，既有证据不会被覆盖。

也可指定仓库内尚不存在的文件：

```powershell
pwsh -NoProfile -File tests/acceptance/stage-a/audit.ps1 -OutputPath docs/test-reports/stage-a/evidence/my-audit.json
```

采集内容包括 Git 版本、工作区状态、指定文档哈希、受版本管理文档的本地链接及本地导出元数据。输出 JSON 中 `business_tests_executed` 固定为 0；它不是业务测试或 Dify 运行证据。

本机受限环境中的 Windows PowerShell（`powershell.exe`）子进程读取策略注册表失败；PowerShell 7（`pwsh`）已实际运行成功。无需更改注册表、系统执行策略或以管理员运行。历史失败记录保留在报告证据中。
