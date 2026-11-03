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

公开工作文件不附明文密钥、登录态、原始运行数据库或 `.git` 内部数据。需要保留的私有资料另存为 AES-256-GCM 加密附件，解密密钥不在 GitHub，单独交付项目负责人。可重建的依赖、安装包和浏览器模型缓存不保存。

## 可选：恢复加密的私有资料与本地 Git 历史

```sh
python -m pip install cryptography==50.0.2
python docs/archive/2026-11-03/recover_encrypted.py --assets restore-assets --output decrypted-assets
python docs/archive/2026-11-03/restore.py --assets decrypted-assets --destination D:/GiftWise-restored
```

第一条恢复命令会安全提示输入单独保存的恢复密钥，不要把密钥提交或粘贴进 Issue。附件 `encrypted-index.json` 记录加密文件 SHA256；每个加密文件有独立随机 nonce 与认证标签。解密后再用恢复器验证原文件 SHA256，恢复本地 Git 元数据、数据库和运行资料。若只恢复公开源码，不需要此密钥。

比赛相关文件仅作为历史资料，不代表今天的运行状态。归档上传不等于部署。后续继续项目时，先阅读交接说明和测试记录，核对实际代码，再决定集成哪些改动。

本地原件只有在远端附件、文件哈希与恢复过程核验后才清理。核验结果记录在本目录的 `VERIFICATION.json`（完成后添加）。
