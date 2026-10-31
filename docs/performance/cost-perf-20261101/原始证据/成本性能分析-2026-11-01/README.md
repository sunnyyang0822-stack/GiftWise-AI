# 成本性能公开证据包

代码SHA为15e29edcc150c3a4a8a9ba04e9f0c8a2bb614879；交接证据SHA为147e45a60f7a7fc9f2cc8c7e9d8146af3dc5f405。分析代码与本证据发布提交是两个版本标识。

本目录含预算、详细审查稿、一页摘要、官方公开价目快照、全部主测采样、准备失败/最终通过记录，以及此前远端已发布的脱敏handoff证据。历史专项原稿保留当时语境，不代表当前结论。审查稿中“未提交/推送”是原分析执行时点；随后用户已明确授权本次远端发布。没有新增模型调用、部署或修改架构/PPT。

## 无网络复算

从本目录运行 `python summarize.py --data-only`，无需凭据、安装软件或模型调用。此选项只重算资源与预算并验证fixture结果，不重复验证源码ZIP/627文件；完整来源核验结果已在provenance.json。CSV含输入假设与未测实付，generated_images未知保留预算区间。

## 完整复跑

需要已有Windows PowerShell、Node24、Python3。先从本目录运行 `powershell -NoProfile -File ./prepare-runtime.ps1`，只下载固定公开GitHub源码和证据ZIP，解出独立runtime，不联网采集或调用模型。然后运行 `node measure.mjs`、`node check-fixtures.mjs`、`python summarize.py`。measure只起自有进程、用动态临时端口；check-fixtures需8904空闲，会先探测，冲突即退出，不停止占用者。都不碰8903，不加载.env或演示库。

源码ZIP与重复runtime未提交，防止证据分支携带大份重复业务代码；固定下载链接及原采样ZIP哈希见provenance.json。运行准备脚本将产生本目录内被.gitignore排除的下载/运行副本。新运行保留独立runs子目录，资源/预算重算文件会更新，应在独立checkout运行，旧采样仍在原runs目录。

原始记录中的本地用户名/家目录已替换为[LOCAL_USER_HOME]；Git提交元数据只发布sha/tree/来源，省略作者邮箱与签名。发布变换前后SHA256见上级PUBLICATION-MANIFEST.json；上游已脱敏证据不伪装成本轮真实运行。原provenance哈希用于原输入快照，上级manifest用于本次发布字节。
