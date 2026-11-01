# 架构图三源生成器

`python build_diagram.py <输出目录> <前缀>` 由同一张文案/坐标表生成 .drawio、.svg 与 -labels.json；
`CDP=<端口> node render_png.mjs <in.svg> <out.png>` 用无头 Edge 渲染 2× PNG（不拉伸、不裁切）。
