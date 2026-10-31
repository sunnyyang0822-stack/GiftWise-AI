# previous_gifts 接入修复（18:00交付优先小批）

按产品负责人2026-10-31最新优先级，先修后台，再接Seedream。对齐工作流PR58的277b71d版本和前端PR57的dd50fef字段：previous_gifts可省略，类型为string，最多1000 Unicode码点；纯空白归一为空，非空保留原文。新版缺省传空字符串，旧版未提供时不补字段。错误码INVALID_TYPE/LIMIT_EXCEEDED，路径intake.previous_gifts。

已修改web/server/intake.mjs白名单、校验及request_json派生。现有canonical快照/确认一致性/推荐缓存键包含整个输入，因此历史变化不会沿用旧确认或旧运行。生成provider接收冻结request_json；历史不自动转兴趣事实、禁忌或预算。明确“不要重复”的语义识别仍不能靠字段透传证明已完成，需现有确认流程和工作流联调。

实际命令：node --test web/tests/retrieval-media-history.test.mjs，3 PASS；node web/tests/access-layer.test.mjs，41 PASS。均受控，不调用真实Dify、图像或浏览器。测试覆盖非法类型、1000/1001 emoji码点、空白、注入文本仅数据、冻结后原输入变化及缓存隔离。

下一位负责人：前端PR57可直接发送previous_gifts；工作流PR58可消费request_json.previous_gifts；QA按固定提交复核。无需产品负责人账号操作。Seedream实现留在同一工作树下一小批，不混入本次修复提交。
