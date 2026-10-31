# PR #55：提交原件指纹修复

根因：core.autocrlf=true，工作区源码可能为CRLF，生成器原样哈希并拼接；git提交却对部分文件转LF，因此工作区9项通过不证明Git blob通过。此前b94d330的交付结论不充分，以本次提交原件证据更正。

修复提交：`81291e8efaa6ed2e826a885759569d429b586557`。

`.gitattributes`仅对workflow/labels.py、intake.py、runtime.py、build_code_node.py、generated/*.py及manifest.json设置text eol=lf。保留validator/rules.py等已有-text规则，不对全仓库运行renormalize。影响仅工作流构建输入/输出的换行，不改变业务语义。生成器摘要继续绑定原始输入字节；拼接代码时统一LF，manifest自身也明确LF，避免CRLF输入传播到输出。

## 提交原件检查（先于任何重建）

直接`git show 81291e8:<路径>`读取4份源码、5份生成Python的原始blob，hashlib SHA256与提交内manifest逐项一致：9/9。

执行指定Python312 `docs/test-reports/nov01-contract/check_committed_bytes.py`。脚本使用`git archive --format=zip 81291e8`导出全新临时副本，先读取导出原件检查9项，通过后才允许运行构建。没有利用重建覆盖旧结果。完整逐项expected/actual在`bytes-20261031T122637856783+0800/results.json`的committed_before_rebuild。

## 重建后检查（单独记录）

同副本执行`python workflow/build_code_node.py`后再验9项：9/9；五份生成Python及manifest与提交原件全部逐字节相同，rebuild_byte_identical=true。不存在“重建后绿掩盖提交原件红”。

## 离线测试原始输出

统一Python `C:/Users/lenovo/AppData/Local/Programs/Python/Python312/python.exe`（3.12.10），PYTHONIOENCODING=utf-8。

| 命令 | 实际结果 |
| --- | --- |
| -m unittest discover -s tests -q | 337 PASS，0 FAIL |
| workflow/verify_local.py | 46 PASS，0 FAIL |
| workflow/verify_local.py --nov01 | 29 PASS，0 FAIL |
| -m unittest discover -s tests/acceptance/stage_c -v | 39 PASS，0 FAIL，0 SKIP |

命令、退出码和stdout/stderr独立归档在上述bytes目录。旧探针所有写入仅发生在全新临时导出副本，未更改历史证据。验证脚本本身在后续证据提交入库，不冒称它已存在于81291e8；被测源码和产物严格来自81291e8。

不改规则语义、前端和历史证据。Dify/模型/部署均未执行，线上调用0；token、模型延迟、成本测量未执行。等待PM在原PR #55复核，不创建重复PR、不自行合并。
