# Tavily 与 Firecrawl 实测记录

日期：2026-10-30，北京时间约 09:32–09:36。执行者：当前开发 Agent；这是开发侧探索记录，尚无独立测试验收。

## 结论

- **Tavily：已验证免 Key API 可调用，能够搜索并读取部分中国商品页；具备做“来源参考价推荐”的基础能力，尚不能作为可靠实时商品源验收。**
- **Firecrawl：本机出口的免 Key 路径被 403 拒绝，需要 API Key 后才能继续；没有验证到商品提取能力，不能由此判定付费／有 Key 路径不可行。**
- **“无需人工整理、一天内稳定返回三种符合预算的具体商品与价格”尚未验证通过。** 本轮未完成模型排序、规则集成、前端或部署测试。

## 实际请求与结果

原始证据为本目录对应 JSON，含请求、UTC 时间、HTTP 状态、耗时和响应。下表不把 HTTP 200 等同于业务成功。

| 操作 | HTTP / 结果 | 本机耗时 |
| --- | --- | --- |
| Tavily，较长中文 KINTO 型号搜索 | 200；返回新闻／金融内容等，偏题 | 5.656 秒 |
| Tavily，读取已知 KINTO 商品页 | 200；读到 SCS-S03 320ml 与页面标价 ￥168.00 | 4.922 秒 |
| Tavily，英文 KINTO 型号搜索 | 200；含相关美国商品页，也混入加密资产内容；美元不能直接用于 CNY 预算 | 2.547 秒 |
| Tavily，简短中文查询且限定 kintocn.cn | 200；召回中国商品页，但未命中指定型号 | 4.500 秒 |
| Tavily，恋人／咖啡送礼长查询 | 200；混入台币商品与新闻，未形成预算内三方案 | 2.719 秒 |
| Tavily，文具送礼长查询 | 200；含品牌聚合页、台湾品牌站及无关内容，未形成可靠商品报价 | 2.860 秒 |
| Tavily，朋友／拼图送礼长查询 | 200；偏题，未形成可靠商品报价 | 4.922 秒 |
| Tavily，advanced + 简短型号 + KINTO 域名 | 200；找到相关商品列表页及标价，也有不对应型号的页面 | 7.032 秒 |
| Tavily，advanced + 百乐 78G + jd.com | 200；找到相关京东列表页及商品链接，未取得可用标价 | 6.938 秒 |
| Tavily，advanced + 拼图 1000 片 + jd.com | 200；找到京东导购页，含商品、参考价及详情链接 | 5.469 秒 |
| Tavily，批量读取自己搜到的三个 KINTO 详情页 | 200；3/3 返回商品内容和人民币页面标价 | 1.360 秒 |
| Tavily，批量读取京东钢笔列表／拼图导购页 | 200；2/2 返回内容。钢笔列表无可用标价；拼图页明确声明价格非实时 | 2.828 秒 |
| Tavily，沿页面链接读取钢笔／拼图实际商品详情 | HTTP 200，但 results 为空；2/2 failed_results：Failed to fetch url | 4.171 秒 |
| Firecrawl，无 Key 读取同一 KINTO 商品页 | 403；服务称出口 IP 类似代理／VPN，要求 API Key | 1.656 秒 |

共完成 14 次取得 HTTP 响应的服务调用：Tavily 13 次、Firecrawl 1 次。Tavily 包括 9 次搜索和 4 次 extract 请求；单个 extract 可含多个 URL。另有最初两次 Python TLS 失败的传输记录，不能算成功服务调用，也未确认其上游是否收到请求。

三组长查询是检索压力样例，**不是完整关系适配验收**；其中标识为 pursuit 的实际查询只写了“朋友／文具”，不应据文件名推定已经验证追求关系场景。

## 自动找到并读到的商品标价

以下来自 `tavily_search_kinto_domain.json` → `tavily_extract_discovered.json`，不是预先人工指定的商品详情页。

| 来源页标题 | 页面标价 | 局限 |
| --- | --- | --- |
| TRAVEL TUMBLER 经典保温杯 500ml 白色 | ￥268.00 | 超过 200 元示例预算 |
| TO GO TUMBLER 桌上杯 360ml 黑色 | ￥278.00 | 超预算，与下一项仅颜色不同 |
| TO GO TUMBLER 桌上杯 360ml 狼棕色 | ￥278.00 | 超预算，不能作为独立送礼思路 |

页面含微信扫码购买提示，不代表拿到了可直接结算的链接。页面标价不证明库存、运费、当前结算价或到货时间。已有样例 ￥168.00 只证明已知页面可提取，不能用它冒充自动搜索已命中。

京东拼图导购页提供多项明确标为参考价格的记录，但沿其商品链接读取失败，因此不能升级为已核验商品报价。

## 额度与费用

- 本轮仅使用官方公开的免 Key 入口；没有注册账号、输入付款信息、使用本地 API Key 或开通付费套餐。
- Tavily 官方免 Key 文档说明免费且限流，但本次没有确认数值上限。正式 API Key 的免费档目前为每月 1,000 积分；调用次数不等于积分，advanced、提取等操作的计费方式需按当前官方规则核算。
- Firecrawl 本次 403 响应提示免费 Key 有 1,000 credits；本轮没有取得 Key，也没有验证刷新周期、账号实际额度和生产配额。
- 免 Key 适合验证；未验证稳定性和容量，不建议成为产品唯一上线依赖。

## 执行与复现

探针使用 Python 标准库和 Windows 自带 `curl.exe`，不安装依赖、不写入密钥。使用 Windows 系统证书存储，未关闭 TLS 验证。最大并发 2，单请求超时 45 秒。

实际执行：

```powershell
python docs/research-evidence/product-data-probe/probe.py initial
python docs/research-evidence/product-data-probe/probe.py extract
python docs/research-evidence/product-data-probe/probe.py targeted
python docs/research-evidence/product-data-probe/probe.py scenarios
python docs/research-evidence/product-data-probe/probe.py optimized
python docs/research-evidence/product-data-probe/probe.py discovered
python docs/research-evidence/product-data-probe/probe.py jd
python docs/research-evidence/product-data-probe/probe.py jd-detail
```

首次 Python OpenSSL 证书链失败，换用 curl 的系统证书后取得响应。首次打印受本机 GBK 编码影响退出，但响应文件已保存；随后固定 UTF-8 输出，并未为解决打印问题重复初始 API 请求。初始 HTTP 响应证据保留，TLS 失败记录另存。

这些命令会访问真实服务，复跑受当时额度和网络影响，并会覆盖同名结果文件。Firecrawl 已返回访问条件限制，本轮停止请求，没有改出口、伪造身份或绕过访问要求。

本轮读取需求、开发流程和工作区状态；定位 Issue 已在同一聊天前次读取，本轮 REST 复核遭 GitHub 限流，未把无法刷新当作定位已变更。未运行业务单元测试；没有改动业务代码、提交或部署。新增本目录脚本、响应和报告，更新既有调研文档的实测结论。

## 对一天上线的建议

若首版接受“公开来源参考价”，优先继续 Tavily：将用户关系／约束留在匹配阶段，检索使用简短商品词、型号与可读取来源范围；按商品 identity、币种和价格证据硬筛，允许不足和失败状态。不能把本轮结果写成三方案推荐验收成功。

若必须保证预算内三件商品都有可核验当前报价，需要额外的商品数据来源或可稳定读取的渠道，本次两项试验未解决这个要求。Firecrawl 需要账号 Key 才能进一步验证；需要用户本人在官方平台开通后通过可信服务端配置，不应在聊天粘贴密钥。

## 官方资料

- [Tavily 免 Key 模式及限制](https://docs.tavily.com/documentation/keyless)
- [Tavily 定价](https://www.tavily.com/pricing)
- [Firecrawl 官方无 Key 请求说明](https://docs.firecrawl.dev/introduction)
- [KINTO 已知样例商品页](https://www.kintocn.cn/product/detail_231.html)

官方资料仅说明接口和试用方式；可行性判断以上述本机实际响应为依据。
