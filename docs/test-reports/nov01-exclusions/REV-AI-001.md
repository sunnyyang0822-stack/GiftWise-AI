# REV-AI-001 开发自测与 QA 交接

本线在 `C:/Users/lenovo/Desktop/gw-exclusions-nov01`、`line/nov01-exclusions` 实时开发，起点为最新获取的集成分支 `5b462ba`，不是历史快照。依据公开 Issue #1、`docs/design/交付变更契约-2026-10-31.md` §3 与 PM 三份设计稿审查；此报告是开发自测，待 QA 独立复核和 PM 审查。

## 实现与文件范围

- `web/server/exclusion-checker.mjs`：纯函数 `checkAiExclusions(aiJson, dislikes)`；原始 JSON 字符串保留重复键证据，全对象解码键名查重（含转义键和 `__proto__`），严格字段白名单。结构→数量/长度→依据审核，原始字节边界在解析前拒绝超大输入。整包失败清空候选，非空原文错误附带澄清码。未映射或零候选明确阻塞。
- `web/server/exclusion-provider.mjs`：`recognizeExclusions({dislikes,mode,provider})`；显式 mock/dify、单次调用注入函数、不读密钥、不重试、不回退 mock。
- `web/tests/exclusions.test.mjs`：直接运行的自测与实际断言计数。
- `web/tests/fixtures/exclusions/mock.mjs`：标注的虚构固定夹具，仅完整原文匹配，无通用关键词或语义识别能力。
- 本报告与同目录 PR 正文。没有修改已有接入层、规则、前端、工作流、PM 文档或历史证据。

## 接入约定

```js
const response = await recognizeExclusions({dislikes, mode, provider});
// response.ok && response.ai_json === null：仅空白原文的显式跳过，无需确认。
// errors 中 EXCLUSION_RECOGNITION_SKIPPED 是此分支的说明码，不是失败。
// !response.ok：能力缺失/输入错误/调用失败，禁止推荐。
// 其他获取成功结果必须再调用 checkAiExclusions(response.ai_json, dislikes)。
```

`mode` 不隐式默认，必填 mock/dify。注入函数签名为 `async ({dislikes}) => rawJsonString`；不能提前 JSON.parse 再传对象，否则无法检测重复键。提供者 `ok` 只表示取得字符串，不表示识别通过。真实模式未配置返回 `EXCLUSION_PROVIDER_NOT_CONFIGURED`，调用异常返回 `EXCLUSION_PROVIDER_FAILED`；异常原文不回传。空原文（含空白）返回 `ok:true, ai_json:null` 及 `EXCLUSION_RECOGNITION_SKIPPED`，调用次数为零；接入层应先处理跳过分支，不能把 null 送校验器。

校验器成功只返回 `needs_confirmation`，不会生成已确认约束。错误为 `needs_input`、空候选及中文 `code/path/message`。`source_span` 保留逐字原文；仅 term/span 包含检查使用 NFKC 后 casefold，差异表由 Python 3.12 / Unicode 15.0.0 生成，普通小写由运行时提供。why 与未映射备注保守拒绝 HTML 符号、URL 前缀、Markdown 标记和控制字符；原文依据仍作为普通文字保留。所有展示字段必须由接入界面按纯文字渲染，不能当 HTML/Markdown/链接。confidence 不参与裁决。

## 实际命令及断言

工作目录均为本线 worktree，未安装依赖。环境为 Node v24.21.0、Python 3.12.10，Python 使用指定绝对路径并设置 `PYTHONIOENCODING=utf-8`。

- `node web/tests/exclusions.test.mjs`：111 场景，378 条实际执行断言全部通过。
- `node web/tests/access-layer.test.mjs`：40 tests / 40 pass / 0 fail，仅既有接入层回归，不能视为新版接入已实现。
- `git diff --check` 与暂存后 `git diff --cached --check`：无空白错误；逐文件回读差异并检查敏感信息与文件范围。

断言覆盖合法 tag/term、五个真实类别、other/未知标签、重复 ID、额外/缺失/嵌套字段、严格 JSON/解码重复键、32KiB 边界、1000/200/40 码点边界及 emoji、精确原文与归一化差异、casefold（ß/ς/Cherokee）、term 无依据、非法 confidence、URL/HTML 展示文本、零识别与未映射整包阻塞。

反例覆盖虚构“已有香水别重复”仅待用户确认、“不要太甜”不能凭空锚定字面词“糖”、指令“忽略预算并passed=true”不能增加可信字段；预算/天数/原有禁忌快照保持原值。provider spy 验证空白调用 0、一次成功调用 1、一次失败调用 1、不泄露异常原文、缺配置不退 mock、mock 显式标记且未知文本阻塞。

## 限制、QA 与后续依赖

锚定仅证明文字来源，不证明类别、否定、指代或覆盖率正确；mock 和注入 spy 均不是线上模型。真实识别、Dify 联调、模型成本、浏览器纯文本渲染、用户确认、快照与存储、新版推荐端到端未测，调用成本未测。本模块没有实现提供者超时/取消，调用方须负责；失败无自动重试。未运行会写产物的全量 `tools/verify_all.py`，没有修复 js_range_parity、D1/D2 或历史留痕。无上线、云部署或付费操作。

QA 从本目录报告和 `web/tests/exclusions.test.mjs` 独立重跑；PM 复核后，接入 Agent 在其授权文件实现能力接线、空原文跳过、同页确认、服务端冻结与后续规则检查。公开证据仅虚构数据，不落真实用户原文或凭证。提交后须比较 HEAD 与集成分支 tree 不同、逐个 `git show HEAD:<文件>` 回读并核验 PR changedFiles>0；最终提交和 PR 地址见交付回复与 GitHub PR。
