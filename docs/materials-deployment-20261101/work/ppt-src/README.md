# 答辩 PPT 可编辑源（GiftWise 视觉版）

- `s01.html`–`s08.html`：8 页源文件（1920×1080），共用 `base.css`、`common.js`，图标 `assets/icons.js`，字体 `assets/fonts/`，截图与证据图 `assets/shots/`。
- 出图：`node serve.mjs`（本地静态服务 8921）+ 无头 Edge（CDP 9342）后 `SCALE=1.5 node render.mjs s01 … s08`，输出 `out/s0N.png`（2880×1620）。
- 打包：`python build_deploy.py`——整页图 + 备注（`notes-deploy.json`，来自 REPLACEMENT-NOTES.json，P01/P08 附完整 SHA）+ P01/P08 透明超链接（`linkrects.json`，指向 http://117.50.83.57/），同时合成带链接注释的 8 页 PDF。脚本内路径为本机绝对路径，换设备时改顶部常量。
