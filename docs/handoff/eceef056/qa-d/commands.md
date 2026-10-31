# 精确命令与原始执行记录

受测代码 eceef056ce80399b83c61f62860a32d0ead16e3d，证据commit见PM远端回执。以下命令包含过滤表达式，必须使用execution.json内argv或启动器，不能把竖线当shell管道。脚本中的本地工作树/输出路径是本次原始配置；跨设备应显式改为对应项目内目录，并重新记录受测SHA。旧工作树不能作为运行依赖。

Node子进程环境用Python subprocess env白名单重建，不继承真实凭据。每组完整环境键和值、起止UTC、真实Node退出码在artifacts/<组>/execution.json。当前根runner用于复现；离线执行当时的guard副本另保留。

## offline

```text
"C:\Program Files\nodejs\node.EXE" --import file:///E:/%E9%BB%91%E5%AE%A2%E6%9D%BE/.tmp/handoff-eceef056/qa-d/network-guard.mjs --test --test-concurrency=1 --test-reporter=tap "--test-name-pattern=^无初始素材|^一条批次真实素材|^多个候选复用|^已知合法文本缓存|^工具无可用素材|^存在真实资料|^有素材却未引用|^伪造source/|^虚构来源域$|^商店来源$|^非HTTPS$|^缺观察时间$|^非法观察时间$|^非公开参考身份$|^缺标题$|^纯图标题无正文$|^空白摘要$|^default text adapter|^legacy reference image request|^unrelated cached material|^actual permitted merchant|^推荐网图已停用|^final sections reflect|^same final gift name|^纯体验无包装|^旧空包装|^实体方案完整|^体验附实体|^实体合理description|^所有章节为空|^AI图ready仅替换|^错误候选图片|^停推荐网图：(真实参考图|pending与|错绑/重复|选后AI|选后读取|错候选|离开选后|选择仍)|^text returns with persisted|^supplier failure retains|^owner/run/candidate isolation|^reading interrupted task" web/tests/recommendation-grounding.test.mjs web/tests/text-material-pipeline.test.mjs web/tests/retrieval-audit-pipeline.test.mjs web/tests/experience-presentation-a.test.mjs web/tests/ui-actual-guide-sections.test.mjs web/tests/ui-recommendation-without-images.test.mjs web/tests/backend-async-image-a.test.mjs
```

cwd=E:\黑客松\.worktrees\independent-qa-eceef056-20261031; exit=0; UTC=2026-10-31T20:38:43.300410+00:00 → 2026-10-31T20:38:46.781890+00:00

## http

```text
"C:\Program Files\nodejs\node.EXE" --import file:///E:/%E9%BB%91%E5%AE%A2%E6%9D%BE/.tmp/handoff-eceef056/qa-d/network-guard.mjs --test --test-concurrency=1 --test-reporter=tap E:\黑客松\.tmp\handoff-eceef056\qa-d\combined-http.test.mjs
```

cwd=E:\黑客松\.worktrees\independent-qa-eceef056-20261031; exit=1; UTC=2026-10-31T20:39:45.507481+00:00 → 2026-10-31T20:39:46.621625+00:00

## http-attempt-2

```text
"C:\Program Files\nodejs\node.EXE" --import file:///E:/%E9%BB%91%E5%AE%A2%E6%9D%BE/.tmp/handoff-eceef056/qa-d/network-guard.mjs --test --test-concurrency=1 --test-reporter=tap E:\黑客松\.tmp\handoff-eceef056\qa-d\combined-http.test.mjs
```

cwd=E:\黑客松\.worktrees\independent-qa-eceef056-20261031; exit=1; UTC=2026-10-31T20:40:01.152533+00:00 → 2026-10-31T20:40:02.263182+00:00

## http-attempt-3

```text
"C:\Program Files\nodejs\node.EXE" --import file:///E:/%E9%BB%91%E5%AE%A2%E6%9D%BE/.tmp/handoff-eceef056/qa-d/network-guard.mjs --test --test-concurrency=1 --test-reporter=tap E:\黑客松\.tmp\handoff-eceef056\qa-d\combined-http.test.mjs
```

cwd=E:\黑客松\.worktrees\independent-qa-eceef056-20261031; exit=0; UTC=2026-10-31T20:40:14.536937+00:00 → 2026-10-31T20:40:16.513493+00:00
