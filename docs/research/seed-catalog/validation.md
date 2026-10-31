# 资料自查记录

执行位置：独立工作树 `.worktrees/seed-catalog-59-60`。本记录只说明本线资料自查，独立QA和商家结算复核未执行。

## 实际命令与结果

1. `git status --short`、`git branch --show-current`、`git log -1 --oneline`：根目录已有多项他人修改，未暂存；通过 `git fetch origin release/2026-11-01-submission` 和 `git worktree add -b codex/seed-catalog-59-60 .worktrees/seed-catalog-59-60 origin/release/2026-11-01-submission` 建立隔离工作树，基线3890aa5。
2. `Get-Content AGENTS.md`、`Get-Content docs/product-requirements.md`、`Get-Content docs/development-process.md`、`Get-Content docs/product-data-research.md`、`Get-Content docs/research/price-sources-2026-10-31.md`及`rg`定位：已读任务规范与相关价格研究。仅查询，不修改这些文件。
3. `gh issue view 59 --json title,body,url`、`gh issue view 60 --json title,body,url`：首次本地网络失败，授权联网后退出0取得公开正文；Issue #1通过web工具打开成功。`gh pr list --state open --json number,title,headRefName,baseRefName --limit 30`发现契约PR #61；`gh api 'repos/sunnyyang0822-stack/GiftWise-AI/contents/docs/design/retrieval-media-contract.md?ref=codex/retrieval-media' --jq .content`读取草案。首次逐行解码破坏中文显示，随后拼接base64后一次解码成功；没有修改契约。
4. 现有 `web.run` 的搜索及 `open`：20个入表商品均打开官方详情；必要片段、URL、查看时间和缓存提示保存于evidence.json。搜索只用于发现来源。迪卡侬空正文、乐高盆景404未入表；未进行登录或绕过。
5. PowerShell单引号here-string传入 `python -`，使用标准库json/re/decimal/datetime/urllib/pathlib离线自查，退出0。逐条检查唯一ID、官方HTTPS域名、证据ID/URL绑定、查看时间顺序、正整数销售单位、CNY两位小数、**主金额确实出现在对应原始币种报价片段**、条件报价规格/数量对应、未知值和非实时标识、图片门禁与无图片文件。原始执行输出：

```text
PASS: 20 unique products / 20 official detail evidence links; 14 primary prices match raw excerpts; 1 member quote isolated; 6 null prices; 20 blocked image records; no image files.
PASS: timestamp ordering, quantity/variant binding, CNY decimal formatting, unknown shipping/stock/preparation and scope data invariants.
```

6. `git diff --check`：退出0。首次在新增文件尚未暂存时运行，只能检查已跟踪差异；暂存后 `git diff --cached --check` 发现3个Markdown文件末尾多余空行，已去除。最终重复检查退出0；暂存清单仅6个本任务资料文件。
7. 补充樱花数量冲突原始片段、排除来源记录，并修正AirTag的未选择镌刻表述后，再以here-string传入 `python -` 校验最终JSON、20行来源索引及14条主价格与证据绑定，退出0：`PASS: final JSON and 20-row source index; all 14 primary prices still bind to original excerpts; 6 null prices; 20 null image IDs.`

## 修改范围和限制

只新增research/seed-catalog/catalog.json、research/seed-catalog/README.md、docs/research/seed-catalog/README.md、source-index.md、evidence.json和本文件；不修改产品代码、共享契约及其他Agent报告。

没有运行业务测试、后台检索、模型、图像生成、购买或部署。报价与证据片段一致不证明缓存价现在仍有效；没有独立QA结论。20条缺授权、6条缺价格及所有履约未知均保留，不能写成实时功能或可买保证。
