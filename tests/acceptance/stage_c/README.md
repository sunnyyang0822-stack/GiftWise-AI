# 阶段 C：工作流层独立验收（QA-001）

由 **GiftWise｜测试验收 Agent** 独立编写与执行。只调用公开接口，不导入规则开发 Agent 的自测夹具
（`tests/test_validator.py`、`tests/test_cases.json`），夹具为自建的 `cases.json`。

## 文件

| 文件 | 用途 |
| --- | --- |
| `cases.json` | 自建冻结夹具（虚构数据）。基线为**追求对象**，另含 `colleague` 技术回归变体 |
| `test_stage_c_workflow.py` | 39 个用例：C1 探针／C2 契约缺口／C3 校验／C4 修订保护／C5 生成节点一致／C6 记录方案 |
| `run_stage_c.py` | 运行全部用例并生成逐例证据到 `docs/test-reports/stage-c/<时间戳>/` |
| `extract_dify_evidence.py` | 把 Dify 浏览器实跑的原始日志规范化为可断言的 `dify-run-evidence.json` |
| `dify-qa-runner.cjs` | **测试专属**浏览器执行器，与 `workflow/tools/dify-runner.cjs` 分离（不修改 `workflow/`） |
| `qa-steps-*.json`、`qa-js/` | 浏览器动作清单与页面内取值脚本 |
| `run_verify_local_nopipe.py` | 在禁止匿名管道的沙箱中真实复跑 `workflow/verify_local.py` 的 46 项探针 |
| `probe_web_demo_path.py` | 前端接入层 Demo 路径的**有界预备观察**（mock 模式，14 项）。`web/` 未交付，**不是** WEB-001 验收判定 |

## 运行

```text
python -m unittest discover -s tests/acceptance/stage_c -v
python tests/acceptance/stage_c/run_stage_c.py
```

## 真实状态（2026-10-30 20:53）

- 离线用例：**39 项通过、0 失败**；`model_calls = 0`；`cloud_verified = false`。
- 真实 Dify Code 节点沙箱兼容：**通过**，证据为独立浏览器会话捕获的
  `POST /console/api/apps/<app_id>/workflows/draft/run` SSE 节点轨迹（`status=succeeded`、`error=null`、
  `total_tokens=0`），**未引用 PM 的数字**。
- **仍未执行**：真实模型三候选、真实一次修订轨迹、持续失败的真实模型路径、业务延迟／token／成本、
  选择后呈现阶段、前端与部署。这些项在本套件中一律标为未执行，不得据离线结果推断为通过。

## 浏览器会话纪律

Dify 只能通过项目专用配置目录 `workflow/tools/dify-browser-profile-chrome` 访问，**同一时刻只允许一个会话**。
取用前确认无其他会话（检查 `SingletonLock` 与残留进程），用完由脚本 `context.close()` 退出。
不读取个人 Chrome 配置、Cookie、API Key 或任何凭证；**不点击发布、不创建版本**。
