# 正式架构设计 PDF 可编辑源

- architecture.html + arch.css + assets/（字体、图标），自包含、相对路径。
- 导出：先启动无头 Edge（任意端口，项目内 user-data-dir），再运行
  `CDP=<端口> OUT=<截图目录> PDF_OUT=<输出.pdf> node render-arch.mjs`
  脚本自带本目录静态服务，输出逐页截图、溢出自检与 A4 PDF。
- 本版 v2.0：部署 19b6819 · 证据 6e92a9e · 材料 4a35e18 · 同版 QA eceef056。
