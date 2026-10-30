# 调研证据索引（Issue #26 / RESEARCH-001）

本目录保存 **2026-10-30 ~ 2026-10-31** 期间为回答 Issue #26 所采集的**原始证据**。所有一手记录均为**只读**获取：不登录、不使用 Cookie、不执行 JavaScript、不绕过风控、不注册账号、不购买服务。

- 主报告：[`../price-sources-2026-10-31.md`](../price-sources-2026-10-31.md)
- 任务书：[GitHub Issue #26](https://github.com/sunyang0822-stack/GiftWise-AI/issues/26)

---

## 0. 怎么读这些文件

### 0.1 三类证据文件

| 前缀 | 渠道 | 里面是什么 |
|---|---|---|
| `web-native-*` | 自写只读抓取脚本（Python `urllib`，走系统代理） | 每条记录含 `requested_url / fetched_at / user_agent / status / final_url / content_type / bytes / sha256 / charset / title / raw_text`；`raw_text` 为响应体的可见文本抽取 |
| `github-*` / `v2ex-*` / `web-*` / `bilibili-*` / `agent-reach-*` | `agent-reach` skill（只读） | **CLI 的原始 stdout 逐字存档**（含 `ok:false` 的失败） |
| `github-api-*` | GitHub REST API（匿名） | issue 列表的**原始 JSON 响应体逐字存档** |

### 0.2 两条保真度声明（很重要）

1. **`raw_text` 是抽取后的可见文本，不是原始 HTML。** 需要字节级核对时请用记录里的 `sha256` 与 `bytes` 对照原始响应。
2. **JS 单页会返回"空正文"。** 例如 `open.taobao.com/doc.htm`、`union.jd.com/*`、`op.jinritemai.com/*`、`open.dewu.com/*`、`rulechannel.taobao.com` 都是 HTTP 200 但 `raw_text` 近乎为空。这**只能说明"这次没取到正文"，不能说明"页面上没有该内容"**——主报告 §10 已逐条标注。

### 0.3 规模与两条命名说明（避免误读）

**规模**（本目录共 **61 个文件**）：`web-native-*` **21 个文件、138 条记录**（123 条取得内容、**15 条失败也照存**）；`agent-reach`/`v2ex`/`web-*`/`bilibili-*` 渠道原始输出 **25 个文件**；GitHub 相关 **18 个文件**（含 5 个 issue 原始 JSON）。

**命名说明一（时间戳）**：`web-native-*` 文件名里的时间戳是**真实 UTC**；而 `agent-reach`/`v2ex`/`web-*`/`bilibili-*` 这批文件名里的时间戳是**采集时的北京本地时间（带 `Z` 仅为排序用）**。**以文件内的字段为准**：`web-native-*` 每条记录都有 `fetched_at`（真实 UTC）；`agent-reach` 那批是 CLI 原始 stdout，**本身不含时间戳**，其采集时刻只能由文件名近似。

**命名说明二（"失败"文件不是坏文件）**：`*-js-shell.json`、`*-probe.json`、`*-install-failed.json` 等命名的文件，记录的就是**失败本身**。它们是本报告"缺口清单"（主报告 §10）的证据来源，**不要当成损坏文件删除**。

### 0.4 三种文件格式，别用 `json.load` 一概而论

本目录的 `.json` 后缀是**归档约定**，不代表内容一定是 JSON：

| 格式 | 哪些文件 | 里面是什么 |
|---|---|---|
| **结构化 JSON**（`{"records":[...]}`） | `web-native-*` | 每条含 `requested_url/fetched_at/user_agent/status/final_url/content_type/bytes/sha256/charset/title/raw_text` 等字段 |
| **agent-reach CLI 的 JSON 输出** | `v2ex-*`、`bilibili-*`、`web-*`、`github-*` | 工具的原始 JSON（`ok` / `error.code` / `items[]`），成功与失败都原样保留 |
| **agent-reach CLI 的纯文本输出** | `agent-reach-*-doctor-*.json`、`bilibili-*-add-*-failed.json` | `agent-reach doctor --text` 与人肉可读的报错文本，**不是 JSON**，用文本方式打开 |

最后一行那 3 个文件用 `json.load()` 会解析失败——**这是预期行为，不是文件损坏**（它们在 §2 失败表与主报告 §11 里被引用）。



---

## 1. 结论 → 证据映射（核心表）

> 每条结论对应到具体文件；同一结论有多个来源时按证据强度排序。

### Q1 官方开放平台

| 结论 | 证据文件 | 记录定位 |
|---|---|---|
| 五家官方开放平台文档是 JS 单页，正文取不到 | `web-native-20261030T165040Z-q1-official-open-platforms.json` | 记录 5–10（`school.jinritemai.com` / `open.dewu.com` / `op.jinritemai.com` / `open.taobao.com` / `union.jd.com` / `open.pinduoduo.com`，`raw_text` 长度 0–3272） |
| 淘宝各类目准入要求**企业实名 + 营业执照**，审核 5–10 个工作日 | `web-native-20261030T165643Z-q1-taobao-open-platform-access-rules.json` | 18 条记录，重点 `tagId=1 / 84 / 85 / 86 / 88` |
| 淘宝协议层面"开发者"含个人，且存在"基础API 无需申请即可自由使用" | `web-native-20261030T165643Z-q1-official-developer-agreements.json` | 记录 0（`terms.alicdn.com/.../suit_bu1_other201704191118_23239.html`，442476 B） |
| 拼多多开发者协议明写"企业名称或**个人开发者姓名**""单位或者个人" | 同上 | 记录 6（`mai.pinduoduo.com/autopage/75_static_3/index.html`，109093 B） |
| 抖音开放平台要求"合法的主体资质/经营资质"，平台有裁量拒绝权 | 同上 | 记录 2（`developer.open-douyin.com/.../mobile-web-app-protocal/`，1023213 B） |
| 值得买**暂不提供注册**，需邮件对接入驻 | `web-native-20261030T165040Z-q1-official-open-platforms.json` | 记录 0（`openapi.zhidemai.com/pages/rookie/1.新手指南.html`，sha256 `6d0d4d40383fe333…`） |
| 值得买好价接口**确实返回** `page_price`/`digital_price`/`clean_link`/售罄/券/检测时效 | 同上 | 记录 1（`.../haojia/1.好价信息详情接口.html`，sha256 `6aa641b66409c4ed…`） |
| 值得买另有**分地域库存**（`HasStock`/`Qty`/`S`/`A`）与上下架（`ShelfOff`）接口 | 同上 | 记录 2、4（`.../base/2.库存查询API.html`、`.../base/5.上下架状态查询API.html`） |
| 京东联盟存在**个人账号**（提现需身份证），但对应 CPS 推广而非价格查询 | `web-native-20261030T165828Z-q1-third-party-threshold-comparison.json` | 记录 2、3（`jingfenapp.jd.com/static/html/help/201603/3116.shtml`、`3115.shtml`，**2016 年页面**） |
| 京东联盟接入摩擦大、文档混乱、SDK 被删、权限被拒（**2017 年经验**） | `v2ex-20261031T010700Z-read-332731-retry-long-timeout.json` | `items[0].text`（`https://www.v2ex.com/t/332731`） |
| 京东联盟（原京挑客）服务协议页是 JS 壳，正文未取得 | `web-native-20261030T165643Z-q1-jd-union-agreement-js-shell.json` | 记录 0（标题正确但正文为"网站加载中…"） |
| 第三方"五平台门槛对照"文章给出的对照口径（**未采信**） | `web-native-20261030T165828Z-q1-third-party-threshold-comparison.json` | 记录 0（`developer.aliyun.com/article/1751134`，2026-07-27） |
| "没有企业资质能否对接抖店 API"的社区问答（含灰产建议，**未采纳**） | `web-native-20261030T165643Z-q1-official-developer-agreements.json` | 记录 3（`developer.aliyun.com/ask/708918`） |
| **【决定性】抖音开放平台：个人身份可入驻但仅限"小程序/小游戏/小玩法"；企业认证免费** | `web-native-20261030T170621Z-q1-douyin-developer-onboarding.json` | 记录 1（`partner.open-douyin.com/.../join/issues`，Q1/Q3/Q5）、记录 0（`.../join-into-developer-platform`） |
| 淘宝开放平台"解决方案"页与 FAQ/公告页的性质（前者服务端渲染但内容为 2016 年；后者为 JS 壳） | `web-native-20261030T170318Z-q1-taobao-solutions-faq-shell.json` | 记录 0、1、2 |
| 静态页路径探测：`open.taobao.com/business.htm` 命中；`open.dewu.com` 五个路径返回同一 JS 壳 | `web-native-20261030T170318Z-q1-static-page-path-probe.json` | 全部 12 条 |
| **淘宝客（`taobao.tbk.*`）线索及其核实失败**：阿里妈妈系全部为 JS 壳或证书失败 | `web-native-20261030T170621Z-q1-alimama-taobaoke-probe.json` | 全部 8 条（`pub.alimama.com` / `www.alimama.com` / `open.taobao.com/api.htm` / `tbk.bbs.taobao.com`） |
| **【Q5 正文级补证】关系 × 价格带**：天猫健康《健康礼赠行业趋势白皮书》"**平均预算 822 元**""76% 北方女婿首次见家长预算 500 元以上"；搜狐号"交换礼物 **200 元**、**好友 500 元**、伴侣/暧昧对象不设上限"；网易号七夕清单实际到手价 **139–520 元** | `web-native-20261030T171820Z-q5-relationship-price-bands-firsthand.json` | 记录 0（`sohu.com/a/806479561`，sha `8277afa20d53b73e…`）、记录 1（`sohu.com/a/844436448`，sha `98641b08ac1c122…`）、记录 2（`163.com/dy/article/L4M8O8BB0538NLHQ`） |
| Q5 补证的另一半是**失败**：腾讯新闻正文由 JS 注入（200 但 0 字符）、知乎专栏 **HTTP 403** | `web-native-20261030T171820Z-q5b-content-platform-attempts.json` | 记录 0–1（inews.qq.com）、记录 2–3（zhuanlan.zhihu.com 403） |
| **【最重要发现】淘宝客路径：有官方文档支撑，但准入要求"做成导购站"** | `web-native-20261030T172039Z-q1-taobaoke-official-onboarding-doc.json` | 记录 0（`api.alidayu.com/...articleId=118970`，**官方「新手指南」2023/02/01**，sha `2c7c1f04f037a1ff…`）："**面向所有淘宝客开发者**""**默认开通的可自助申请，高级权限为邀约制**"；记录 2（`developer.aliyun.com/article/1687435`，第三方：审核 **1-3 天**、QPS ≤1、日 ≤10 万次）；记录 1（`union.jd.com/searchResultDetail?articleId=160866` 仍为 JS 壳，tl=0） |
| **【决定性】阿里妈妈官方规范正文（4 份）**：基础 API 准入 5 条（含"**网站或无线APP正确部署淘点金组件**"）；链接/三方 API **邀请制**且门槛 ≥5 万点击/≥10 万 alipay；清退规则第 4 条；"工具服务商"档**要求企业支付宝**且**原始数据明细不得向第三方披露**；比价订单定义与"**导购型推广行为不受影响**" | `web-native-20261030T172240Z-q1-taobaoke-official-regulations.json` | 记录 0（`articleId=118972`《淘宝客API推广管理规范》2020/06/12，sha `b49ba0dc6a880856…`）、记录 1（`articleId=118973`《淘宝客软件工具权限管理规范》，sha `e647521875e22a1e…`）、记录 3（`mo.m.taobao.com/union/path_1664213952256`《工具服务商业务简介》，sha `232800b83c51bd76…`）、记录 2（`mo.m.taobao.com/common/page_20200623_110626_583`《规范淘宝客引导过度比价行为的管理规范》，sha `fb7f978b0bb4d04f…`） |
| 淘宝客路径的**早期第三方线索**（三源收敛的起点，后来被官方原文证实并修正） | `web-native-20261030T171204Z-q1-taobaoke-route-evidence.json` | 记录 1（官方 FAQ，**2020/07/09**）、记录 0（SegmentFault **2026-10-21**）、记录 3（aliyun **2026-07-27**）、记录 2（快递鸟 **2026-06-24**）、记录 4（店托易） |
| 淘宝客历史规则（2018 年"高佣账号"门槛，**时效性不足**） | `v2ex-20261031T010800Z-read-428052-taobaoke-retry-long-timeout.json` | `items[0].text`（`https://www.v2ex.com/t/428052`，2018-02-02） |

### Q2 第三方聚合 API

| 结论 | 证据文件 | 记录定位 |
|---|---|---|
| **聚合数据的"商品比价"不只是"维护中"，而是已下架**：站内搜"比价"返回 `API数据 0` + "没有找到合适的API"；"电子商务"分类页无任何价格接口 | `web-native-20261030T170621Z-q2-aggregators-firsthand-recheck.json` | 记录 2（`juhe.cn/search/比价`）、记录 0（`juhe.cn/docs/c7`） |
| 聚合数据平台级审核时长 | 同上 | 记录 1（`juhe.cn/qa/4`）："工作日20分钟左右审核" |
| 聚合数据**商品比价 / 比价数据SDK 两个接口都"维护中"** | `web-native-20261030T165040Z-q2-third-party-aggregators.json` | 记录 0（`juhe.cn/docs/api/id/137/aid/738`）、记录 1（`juhe.cn/docs/api/id/3`） |
| 聚合数据要求实名认证 + 应用场景审核，并声明"官方直连获取数据" | 同上 | 同上两条记录的 `raw_text` |
| **极速数据没有商品价格品类**（`sitemap.xml` 实测 155 个 `/api/` slug；"娱乐购物"8 条全列） | `web-native-20261030T170621Z-q2-aggregators-firsthand-recheck.json` | 记录 3（`jisuapi.com/sitemap.xml`）、记录 4（`jisuapi.com/api/6/`） |
| 极速数据平台级实名政策（个人/企业实名认证）与会员免费额度 | `web-native-20261030T165040Z-q2-third-party-aggregators.json` | 记录 2、3 |
| **数脉无独立比价接口**；`条形码查询` 含参考价但**限企业实名**、需应用场景审核 | `web-native-20261030T170621Z-q2-aggregators-firsthand-recheck.json` | 记录 5（`shumaiapi.com/productDetail/275`） |
| 数脉无电商品类（分类页） | `web-native-20261030T165040Z-q2-third-party-aggregators.json` | 记录 4（`shumaiapi.com/product`） |
| **APISpace 无可核实的商品价格接口**（`sitemap.xml` 实测 78 个 API slug） | `web-native-20261030T170621Z-q2-aggregators-firsthand-recheck.json` | 记录 6（`apispace.com/sitemap.xml`） |
| APISpace 首页正文有限（早期记录） | `web-native-20261030T165040Z-q2-third-party-aggregators.json` | 记录 5 |
| **慢慢买确有全网比价/价格监测 API，但属 B 端商务对接** | `web-native-20261030T170621Z-q2-aggregators-firsthand-recheck.json` | 记录 7（`manmanbuy.com/a_148336.aspx`，《搜索比价API》） |

### Q3 开源方案

| 结论 | 证据文件 | 记录定位 |
|---|---|---|
| PriceDive 92★/MIT，但 issue #1「抓取的价格与实际不符」 | `github-20261030T171000Z-read-PriceDive.json` + `github-api-20261030T165117Z-issues-DAILtech_PriceDive.json` | `items[0].raw` 与 issue 原始 JSON |
| Kumagt/price-monitor 28★/MIT，依赖第三方"买手 API"邀请码 | `github-20261030T171100Z-read-Kumagt-price-monitor.json` + `github-api-…-issues-Kumagt_price-monitor.json` | 同上 |
| Paul-633/price-compare-tool 24★/MIT，0 issue、无用户验证 | `github-20261030T171200Z-read-Paul-633-price-compare-tool.json` + 对应 issues 文件 | 同上 |
| davide97l/ecommerce_price_scraper 33★/Apache-2.0，2024 年后停更 | `github-20261030T171300Z-read-davide97l-ecommerce_price_scraper.json` + 对应 issues 文件 | 同上 |
| JDGuardian 19★、2022-09 停更、无许可，issue「还能用吗大佬…」 | `github-20261030T171400Z-read-JDGuardian.json` + `github-api-…-issues-qedsd_JDGuardian.json` | 同上 |
| 候选池（含 0★ 营销仓库与陈旧项目） | `github-20261030T170500Z-search-jd-price-api.json`、`…170530Z-search-jd-price-monitor.json`、`…170700Z-search-taobao-price-scraper.json`、`…170730Z-search-bijia-opensource.json`、`…170800Z-search-smzdm-api.json`、`…170830Z-search-ecommerce-price-crawler.json` | `items[].raw` 的 `stargazers_count` / `pushed_at` |
| `awesome-OpenPrice` 1066★ 但实为 **AI 订阅卡网比价**，与实物礼品无关（已排除） | `web-native-20261030T165643Z-q3-github-raw-readme.json` | 记录 0（`raw.githubusercontent.com/bytedoger/awesome-OpenPrice/main/README.md`） |

### Q4 合规边界

| 结论 | 证据文件 | 记录定位 |
|---|---|---|
| 《反不正当竞争法》2025-10-15 施行，第 13 条第 3 款为**新增数据专条**（"避开或者破坏技术管理措施"），罚则上限 500 万 | `web-native-20261030T165040Z-q4-legal-official.json` | 记录 5（`paper.people.com.cn/rmrb/pad/content/202510/10/content_30108522.html`） |
| 《网络反不正当竞争暂行规定》第 19 条 + 第 26 条 8 项裁量因素 | 同上 | 记录 3（`gov.cn/zhengce/202406/content_6959668.htm`） |
| 刑法第 285 条第 2 款原文（非法获取计算机信息系统数据罪） | `web-native-20261030T165253Z-q4-legal-cross-verified.json` | 记录 0（`jy.dysjcy.gov.cn/news/show-7.html`，299558 B） |
| 数据安全法第 32 条 | 同上 | 记录 1（`gzca.miit.gov.cn/.../art_092ca2718a224802afef999b1c42cdee.html`） |
| 个人信息保护法第 13/27 条 | 同上 | 记录 2（`login.12309.gov.cn:8443/spp/fl/202108/t20210820_527244.shtml`） |
| 北京知产法院「拥堵延时指数」案：破坏 Robots 等技术保护措施爬取公开数据构成不正当竞争，判赔 1200 万 + 50 万 | `web-native-20261030T165040Z-q4-legal-official.json` | 记录 0（`bjzcfy.bjcourt.gov.cn/article/detail/2026/04/id/9289097.shtml`） |
| 上海长宁案：破解验证码爬取 11 万条商品数据，判处有期徒刑 9 个月–1 年 2 个月 | 同上 | 记录 1（`pazjw.gov.cn/shuoan/202606/t20260619_31736178.shtml`） |
| 江苏高院（2024）苏民终212号"搬家软件盗图抄店"：绕开验证机制与反爬措施，判赔 500 万 | `web-native-20261030T165253Z-q4-legal-cross-verified.json` | 记录 4（`xhby.net/content/s68bea673e4b0096798380c6b.html`） |
| 最高法指导性案例 262 号（抓取搬运平台数据） | 同上 | 记录 5（`tldl.lncourt.gov.cn/article/detail/2025/09/id/8964091.shtml`） |
| 宁波中院（2024）浙02民初562号（**仅有新闻稿+专家点评**） | 同上 | 记录 3（`rmfyb.com/content/202604/23/article_1021760_…`） |
| 淘宝《平台服务协议》明文禁止"爬虫"、"机器人、蜘蛛"擅自获取内容 | 同上 | 记录 6（`terms.alicdn.com/.../suit_bu1_taobao201908081411_65986.html`，123456 B） |
| 《京东用户服务协议》明文禁止"抓取"，《京东VOP开放平台服务协议》禁止"抓取工具"检索索引 | 同上 | 记录 7（`in.m.jd.com/help/app/register_info.html`）、记录 8（`vop.jd.com/reg/agreement`） |
| 9 个站点 robots.txt 一手内容与异常（jd.com 重定向首页 / jinritemai 空文件 / pinduoduo 无 `*` 段 / manmanbuy 全站 Disallow） | `web-native-20261030T165040Z-q4-robots-txt.json` | 记录 0–7 |
| 开发者真实遭遇（含"体量太小达不到准入门槛""从 app 截取的 api 算破坏计算机""写了免责也没用"） | `v2ex-20261030T171500Z-read-1181428-price-crawler-legality.json`、`v2ex-20261030T172200Z-read-620898-crawler-risk.json`、`v2ex-20261030T172300Z-read-1117916-miniprogram-individual.json` | 各自 `items[0].text` |
| Q4 独立子代理交叉核验的范围与自报缺口 | `subagent-cross-check-20261031-q4-legal.json` | 全文（**补充证据，非一手；决定性引文已由主代理重抓**） |

### Q5 礼物价格带

| 结论 | 证据文件 | 记录定位 |
|---|---|---|
| 恋人向：50–2000 元全价位、7 大品类 | `bilibili-public-web-20261030T165040Z-q5-bilibili-public-pages.json` | `bv = BV1F4e3zPELa` |
| 恋人向低预算：≤200 元 | 同上 | `bv = BV1ZT411j7e3` |
| 关系分档：同事 200 元档、500 元争议、朋友/低预算/中等预算策略 | 同上 | `bv = BV1AgtR6AEgD`（《观察者手记 Vol.35》） |
| 职场上司/老师：30–300 元 | 同上 | `bv = BV1s7tB6pE68` |
| 长辈/亲戚/领导："几百预算" | 同上 | `bv = BV1PBw1eaEqW`、`bv = BV1aPrKBuEsm` |
| 内容会失效：曾出现在搜索结果中的 BV1C3bJzmEge 已下架 | 同上 | `bv = BV1C3bJzmEge`（`video_available: false`） |
| 公开页确实含真实价格（smzdm 首页 83 行含价格文本） | `web-native-20261030T165040Z-q5-content-platform-prices.json` | 记录 0（`smzdm.com`，1257878 B） |

### Q6 结论与降级阶梯

Q6 是对 Q1–Q5 的汇总，不新增证据；其判定的证据全部落在上表中。特别地：

- "④ 用户手动粘贴可行" → 依据 §Q1 的"所有官方/聚合路径都被资质或维护状态挡住"，属于**排除法推论**，非独立证据。
- "⑤ 种子价目表" → 价格带依据 §Q5 的 B 站文本证据。
- "不采用 ③ 抓取" → 依据 §Q4 的法条、5 个判例与 9 份 robots/协议。

---

## 2. 失败与限制的证据（同样存档）

本任务要求"失败也要归档"。以下文件记录的就是**失败本身**：

| 文件 | 失败内容 |
|---|---|
| `agent-reach-20261030T165117Z-channel-probes.json` | 四个渠道探测的原始 stdout（web `RATE_LIMITED` / bilibili `NEED_SETUP`） |
| `web-20261030T170200Z-read-union-jd-helpplatform.json` | `web read` 被限流：`RATE_LIMITED`，`"Wait 2470 seconds…"` |
| `bilibili-20261030T173000Z-read-BV1C3bJzmEge-backend-bilibili-api.json` | `UPSTREAM_BROKEN`，`"Bilibili API code 62012"` |
| `bilibili-20261031T010600Z-add-bilibili-dependency-install-failed.json` | `add bilibili` 失败：`PermissionError: [WinError 5]`（沙箱拒绝派生孙进程） |
| `github-20261030T165000Z-read-Crawler_Illegal_Cases_In_China.json` | `RATE_LIMITED`（`gh` 后端同时报 `PermissionError`） |
| `github-20261030T170300Z-search-gift-price-predict.json` | `RATE_LIMITED` — `"Wait 3360 seconds…"` |
| `v2ex-20261030T171600Z-read-620898-crawler-risk.json`<br>`v2ex-20261030T171700Z-read-1117916-miniprogram-individual.json`<br>`v2ex-20261030T171800Z-read-1210741-taobaoke-taokouling.json`<br>`v2ex-20261030T172400Z-read-1210741-taobaoke-taokouling.json` | `TIMEOUT` — `"upstream did not answer in time"` / `"v2ex-api is temporarily paused after TIMEOUT"` |
| `v2ex-20261030T170000Z-read-332731-jd-union-integration-problems.json`<br>`v2ex-20261030T170100Z-read-428052-taobaoke-not-fun.json` | `TIMEOUT`（默认 10s 超时）；后用 `--timeout 60` 重试成功，见 §1 |
| `web-native-20261030T165040Z-q4-legal-official.json` | 记录 2、3 为失败：`gov.cn/xinwen/...` HTTP 404、`hrss.yn.gov.cn/...` SSL `CERTIFICATE_VERIFY_FAILED` |
| `web-native-20261030T165643Z-q1-jd-union-agreement-js-shell.json` | JS 壳导致的"取到标题取不到正文" |
| `web-native-20261030T170318Z-q1-static-page-path-probe.json` | 记录 0、2、3、4、5 为 HTTP 404（`businessList.htm` / `docList.htm` / `apiList.htm` / `rule.htm` / `accessRule.htm`）；记录 7–11 为 `open.dewu.com` 五个路径返回**同一个** 3168 B JS 壳 |
| `web-native-20261030T170318Z-q1-taobao-solutions-faq-shell.json` | 记录 1、2 为 JS 壳：`faq.htm` 与 `announcement.htm` 正文仅"页面加载中,请稍候 ..." |
| `web-native-20261030T170621Z-q1-alimama-taobaoke-probe.json` | **Q1 最大缺口的证据**：`pub.alimama.com`(2254 B/0 字符)、`www.alimama.com`(3612 B/0 字符)、`open.taobao.com/api.htm`(8303 B/0 字符) 均为 JS 壳；两个 `robots.txt` 返回 HTML 而非规则；`tbk.bbs.taobao.com` 报 `SSL: CERTIFICATE_VERIFY_FAILED`（自签名证书） |
| `web-native-20261030T170621Z-q1-douyin-developer-onboarding.json` | 记录 3、4 为**噪音**：`m.php.cn` 返回 129 B、正文 0 字符（反爬/空响应） |

---

## 3. 关于子代理交叉核验

Q4 由一个独立子代理并行取证，其报告以 `subagent-cross-check-20261031-q4-legal.json` 归档。**该文件是补充证据，不是一手记录**：子代理未落盘原始 HTTP 响应体。它找到的**决定性来源已由主代理用同一只读脚本重新抓取**，落在 `web-native-20261030T165253Z-q4-legal-cross-verified.json` 中，引文已逐条比对命中。**以一手文件为准。**

Q2 的并行取证同样进行了。**该子代理同样未落盘原始响应体**，因此其全部关键 URL 已由主代理用同一只读脚本**重抓复核**，落在 `web-native-20261030T170621Z-q2-aggregators-firsthand-recheck.json`（8 条，全部 HTTP 200）。复核结果与子代理结论一致，并**新增了两条子代理未强调的硬证据**：

- 聚合数据站内搜"比价"返回 `API数据 0`，且"电子商务"分类页不收录 —— 说明该品类**已下架**，强于"维护中"；
- APISpace 的 78 个 API slug 与极速数据的 155 个 slug 均已由主代理独立枚举复算。

**以本目录的一手文件为准；子代理结论仅作交叉验证，不作为证据本身。**

---

## 4. 采集方式（可复现）

| 项目 | 说明 |
|---|---|
| 采集器 | 自写只读脚本：HTTP GET → 记录状态/头/字节/sha256 → 文本抽取；`Content-Encoding: gzip/deflate` 会先解压 |
| 网络 | Python `urllib` 自动读取 Windows 注册表中的系统代理设置 |
| User-Agent | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) … Chrome/131.0.0.0 Safari/537.36` |
| 节流 | 每请求间隔约 2 秒；同一平台并发不超过 2 |
| 不做的 | 不登录、不带 Cookie、不执行 JS、不绕验证码/风控、不注册、不购买、不写爬虫产出 |
| agent-reach 版本 | 1.6.0（渠道状态见 `agent-reach-20261031T010510Z-doctor-channel-status.json`） |

---

## 5. 已知限制（一句话版）

本目录能证明的是**"我们确实读到过这些文本"**，不能证明**"平台上不存在相反的规定"**——尤其是那些本次因 JS 渲染或限流而未取得正文的页面（主报告 §10 已逐条列出）。**任何"未核实"都不得在后续文档中被当作"不存在"使用。**
