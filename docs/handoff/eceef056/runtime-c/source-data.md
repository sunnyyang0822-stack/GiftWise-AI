# 公开文字素材交接（Issue122）

冻结代码为`eceef056ce80399b83c61f62860a32d0ead16e3d`。本轮只整理数据与历史证据，没有重新采集、调用模型或执行最终同版E2E。

## 数据与原观察

`evidence/public-material-manifest.json`包含3条实际读取的Bing公开索引摘要，来源为知乎。它不是文章全文或平台直连结果，不包含图片、SKU、库存或核实交易价。文件SHA256为`a1298ea0f85c0ae05b3a298941ec023deb9fb1c9ed513b14bd6c51252a3c38d4`，与原公开包一致；发布receipt保留原包hash与计数。

| reference_id | 来源 | 原观察时间（UTC） |
| --- | --- | --- |
| web_af6bcf5bdc7889e6ee994e1d3ed29aa8 | [Cafe与coffee区别](https://www.zhihu.com/question/556769840) | 2026-10-31T20:02:53.286Z |
| web_95032af991e457b7a73f0835956f5d09 | [咖啡类型区别](https://www.zhihu.com/question/599895904) | 2026-10-31T20:02:53.286Z |
| web_1d8455cd71c6276b685f4d8b2d633c3a | [家庭咖啡基本概念](https://zhuanlan.zhihu.com/p/115002664) | 2026-10-31T20:02:53.286Z |

观察时刻不是文章发布日期，也不证明实时价格或库存。数据独立于演示商品库，本轮未读取或导出演示数据库。不能将这三条固定成所有用户的菜单：模型根据完整需求判断相关性，可以不采用无关缓存并自主检索新资料，不做礼物关键词硬匹配。

## 导入目标自己的目录

在当前Windows冻结实现中，将manifest复制到目标独立运行目录内的包目录，保持文件名`manifest.json`，包目录须在`E:/黑客松`内。从目标代码树执行既有模块；以下是操作说明，本轮没有实际导入或写其他运行目录。

```js
import { createMaterialCache } from './web/server/retrieval/material-cache.mjs';
import { importMaterialBundle } from './web/server/retrieval/material-bundle.mjs';
const result = await importMaterialBundle('E:/黑客松/<目标自身目录>/imports/public-material', {
  cache: createMaterialCache(),
});
console.log(result.status, result.cache_status, result.records_imported);
```

先核对原包SHA，再确认导入`ready/saved/3`与目标缓存实际可读。默认写目标代码树`.tmp/material-cache/materials.json`，一次导入后运行不依赖C开发树。保留原观察时刻；缓存最多80条/7天、读取近20条，过期只过滤，不续成刚抓取。包本身也是历史观察，不能因导入成功宣称任意新主题均已有资料。

## 不同目录与Linux的实际阻塞

`web/server/retrieval/material-bundle.mjs:8`硬编码`resolve('E:/黑客松')`。其他Windows盘符/目录的正常包会被拒绝；Linux会把这个字符串当作cwd下含`E:`的相对目录，正常`/srv/...`包不在该根下，不能宣称原样可云跑。不要建立奇异目录或软链接绕过限制。

最小迁移单：C将允许的导入根参数化为目标受控数据根（默认当前REPO_ROOT或明确配置），保留规范化、链接逃逸拒绝、大小/字段/真实来源检查；D补对应平台离线边界验证，PM再部署。本轮不改冻结代码。

`task-paths.mjs`本身没有E盘常量，根来自`localdb/db.mjs`对import.meta.url的推导；但写入必须留在当前代码树，并经realpath检查。树外路径与指向树外的symlink会被拒绝，不能随意把环境路径指向外置数据目录。默认DB还含历史Windows演示路径（见config.mjs:371，此处不复写私人绝对路径），部署必须显式配置目标独立DB。其他挂载与多副本限制见storage-portability.md。

## 历史受测版本与结论边界

28.393秒样本时间为`2026-10-31T20:07:57.680Z`至`20:08:26.065Z`。当时HEAD为`e7580eaff5db4d507c625fc9334760cd9bddec7b`，有未提交实现；它不是db5e74df干净提交，也不是最终eceef056。未在执行时捕获精确dirty diff或逐文件hash，不能事后伪造。`final-code-static-hashes.json`仅记录最终代码当前文件/Git blob hash，不替代历史受测快照。D将另做最终冻结同版离线QA。

模型先收到3条缓存摘要，再自主发3次工具回调、6次实际公开文本HTTP，最终采用初始2条摘要，生成3个全部可选的新创意思路。模型3次recommend ledger合26.975秒；文本发现约150–308ms，先前独立素材入口356ms。这不是零网络纯缓存、冷全流程、用户浏览器显示、均值或P95；视觉方向未请求，未运行style/present/真实AI图。旧补图性能与失败不能作为当前目标的提速基准。

`derived-source-use.json`只是从原始响应/ledger派生的关联。原审计早于最终material_basis持久化补丁，不能回填冒充当时原审计。发布的无推荐网图raw与选后AI异步/幂等raw是受控测试，后者不是供应商实际生图证明。

## 发布与脱敏

原目录不变。发布14份白名单副本，本次实际6处替换均为历史run/session关联值，未检出真实凭据模式；替换为`[REDACTED:字段]`；必要JSON重序列化，因此不能把副本称“未修改原始”。逐文件原SHA、发布SHA、脱敏类别/次数与实测/推算/未测边界见source-index.json。公开虚构咖啡搬家场景及真实公开摘要保留并标注性质。未读取密钥配置、live会话、浏览器认证、演示DB或另一设备目录。模式扫描未见残留命中，仍由PM上传前独立扫描。
