# P04 架构图交付（架构 Agent → PPT Agent）

- 图件：架构图-GiftWise-AI-2026-11-01.png（2880×1620，16:9）与同名 .svg（1440×810）。与正式架构 PDF 第 3 页、final/01-答辩材料/架构图/ 三源同一文案表生成。
- 文字标签表：P04-labels.json（节点标题与副行、连线标签、分区标题、页脚）。
- 置入 PPT 时按 16:9 等比放入内容区，不拉伸、不裁切；需要改字时改 work/diagram/build_diagram.py 的表后重新生成，三源与 P04 同步更新。
- 关键标签：浏览器 → Nginx 为 HTTP :80（未配置 HTTPS）；Node → 外部模型/Seedream 为 HTTPS；文字检索为匿名 HTTP 公开文字 + 合法历史摘要；内存状态与 /var/lib/giftwise/runtime、/var/lib/giftwise/db 分列；推荐阶段不抓取网图；OpenCLI 仅为运维通道。
