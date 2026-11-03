# 项目恢复归档 · 2026-11-03

本归档用于保存清理本地文件前的源码、未提交工作文件、测试、部署说明、答辩材料与制作源。归档附件发布于当前公有仓库的 `project-archive-20261103` Release。

## 恢复方法

```sh
git clone --branch codex/project-archive-20261103 https://github.com/sunnyyang0822-stack/GiftWise-AI.git
cd GiftWise-AI
gh release download project-archive-20261103 --repo sunnyyang0822-stack/GiftWise-AI --dir restore-assets
python docs/archive/2026-11-03/restore.py --assets restore-assets --destination D:/GiftWise-restored --verify-only
python docs/archive/2026-11-03/restore.py --assets restore-assets --destination D:/GiftWise-restored
```

恢复器校验每个附件、数据块和原文件的 SHA256。目录按原用户主目录的相对结构恢复，例如 `Desktop/giftwise/` 与 `Desktop/GiftWise项目总目录/`。也可加 `--select Desktop/gw-live` 仅恢复一个工作目录。

## 范围与版本

- 答辩运行代码：`19b6819fe80787717571beb7cc0d17f89587c2d9`。
- 部署证据提交：`6e92a9e076d5989f7ad510bebf3639a9dd2dadf8`。
- 本地各工作树原始分支和 HEAD 见 `worktrees.txt`；工作文件快照保留未提交改动，不能把所有候选都视为已集成或验收。
- 完整工作文件清单及哈希保存在附件 `manifest.json.gz`。

公有归档不附密钥、浏览器登录态、原始运行数据库和未脱敏的私有运行文件，也不复制 `.git` 内部数据及可重建依赖缓存。Git 历史以原仓库已公开提交为准。恢复工作文件后，按所选基线克隆仓库再覆盖相应工作目录，重新配置服务端凭据和依赖。

比赛相关文件仅作为历史资料，不代表今天的运行状态。归档上传不等于部署。后续继续项目时，先阅读交接说明和测试记录，核对实际代码，再决定集成哪些改动。

本地原件只有在远端附件、文件哈希与恢复过程核验后才清理。核验结果记录在本目录的 `VERIFICATION.json`（完成后添加）。
