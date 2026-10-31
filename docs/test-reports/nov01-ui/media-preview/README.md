# #59 / #60 前端媒体与三方案卡片预览

状态：本地前端预览；真实检索、商品证据、真实图片 provider 与同版本业务接线 **BLOCKED**，没有调用 Dify、OpenCLI、旧业务API、付费图像服务或部署。

## 实现与文件

- `web/public/app.js`：已有推荐页接入媒体组件；三张有柔和阴影的独立卡片，桌面三列，900px以下纵向排列。名称、参考估价、简短理由、模拟检查状态、选择按钮直接展示；事实/推断/未知、校验、图片与价格来源在可键盘展开的“查看依据与校验”中。选择阶段通过校验门禁与busy门禁保留。
- `web/public/styles.css`：卡片、白底完整主体、放大模态、归一化箭头及手机编号说明样式；推荐页底部动作栏回到文档流，不遮住卡片按钮。
- `web/public/js/media-view.js`：按candidate_id/product_id/image_id绑定；拒绝重复或错配绑定、远程直连/危险URL。图片通过img读取本站资源，绝不原样内联远程SVG。支持加载、pending、缺失、失败、重试、放大、200%缩放、Escape关闭及焦点返回。坐标有界校验；中文HTML与SVG箭头分层，原生details提供文字等价。
- `web/public/js/media-preview.js`：与共享sidecar同结构的明确本地夹具，核心候选对象不塞媒体字段。读图模式可用 `?media=pending` 或 `?media=missing`；正常打开无须额外参数。
- `web/public/js/preview-api.js`：推荐前没有选后媒体，只有选择合格候选才构造包装示意；相同运行/选择重复与并发调用复用同一模拟响应。不存在真实图像生成。
- `web/public/img/media-demo/`：6张有许可的本地摄影开发样例和3张零预算方向原创矢量示意；授权/用途说明见该目录README。不使用用户参考截图，不冒充对应SKU实拍或真实AI成果，不保证外观/规格一致。
- `web/tests/ui-media.test.mjs`：sidecar、资源、绑定、URL安全、坐标、选择门禁和幂等；本目录保存实际浏览器脚本、结果与截图；regression目录是本轮对已有闭环的复跑证据，旧报告未覆盖。

## 共享契约依据

开始时自己的分支及后台工作区均无文件，先按Issue #60草案开发；实施中只读核对后台新提交 `27670b6` 的 `docs/design/retrieval-media-contract.md`，补齐price_conditions数组、price_range、shipping_status、stock_status与evidence_ref。本线不修改或复制提交共享契约。

只读文件SHA256：`6FCAC976C9F2240E90775783CE72DD529FA9BCC7569A428DFF400E604DC21F03`。

真实接口仍待集成。预览中retrieval.status=unavailable、evidence_id/observed_at/evidence_ref均为null，价格来源seed（固定虚构估价），库存/配送unknown；页面显示“读取日期：未检索”，不伪造读取时间。制作日期仅表示素材夹具日期。

## 实际验证命令

在本worktree根目录运行，浏览器为项目专用Chromium；GW_BASE默认本地19002，GW_CDP仅测试进程使用本机9342，不出现在产品页面或前端请求中。

```text
node --check web/public/app.js
node --check web/public/js/media-view.js
node --check web/public/js/media-preview.js
node web/tests/ui-revision.test.mjs             PASS：28 assertions passed
node web/tests/ui-media.test.mjs                PASS：3/3
node web/tests/preview-mode.test.mjs            PASS：3/3
node web/tests/legal-pages.test.mjs             PASS：7/7
node docs/test-reports/nov01-ui/media-preview/browser-media.mjs
node docs/test-reports/nov01-ui/media-preview/regression/browser-preview.mjs
git diff --check
```

浏览器媒体检查185/185通过，覆盖1440/390/320正常、390候选图与选后包装图真实网络失败后重试、缺图和pending、1440六边形异形包装及390竖幅纸包；逐项见media-results.json。既有完整闭环复跑133/133通过，逐项见regression/preview-flow-results.json。

媒体检查包含：三图绑定、响应式排列、未选择零包装图请求、图片完整等比例、来源/未检索日期、Enter放大/Tab焦点留在模态/Escape返回、3条中文说明及等价文字、44px触点、原图与200%缩放箭头定位、单礼物合计、无横向溢出、零业务API与外部资源请求。

首轮键盘自动化漏发Enter的原生文本参数；补齐后实际键盘可打开模态。后续一次断言在原生close事件派发前读取焦点，出现107/108；增加等待对话框关闭（仍保留焦点返回断言）后独立复跑。未通过的试跑不作为通过证据。

截图：`media-1440-normal-candidate.png`、`media-390-normal-candidate.png`、`media-320-normal-candidate.png`、`media-390-normal-package.png`、`media-1440-normal-zoom.png`、`media-390-failed-error.png`、`media-390-missing-missing.png`、`media-390-pending-pending.png`、`media-1440-hexagon-package.png`、`media-390-paper-package.png`、`media-390-paper-zoom.png`。

## 待接入 / 限制

1. BLOCKED：后台真实检索和媒体provider未同版本接线；前端开发夹具通过不能证明真实搜索、图片授权、SKU外观或价格可信。商品图为授权通用摄影样例，非对应SKU。选后包装照片不是AI生成，不证明礼物尺寸、外观或容纳性一致。零预算方向保留原创矢量示意。
2. source_photo / ai_illustration / demo三类标签已实现；当前只有demo样例，前两类没有真实provider验收。未来来源图需后台确认使用依据与规格，AI图必须标为非实拍。
3. 真实外部媒体下载安全、后台任务隔离/幂等、后端规则门禁和一次修订由后台与QA验收；本地模拟不替代这些能力。
4. 保留预算无重复确认、三步输入、自定义关系/场合/金额、独立dislikes/previous_gifts与政策入口；共享字段支持、隐私冲突和真实服务接入仍按上轮报告待PM确认。
5. 本次没有新增图片端点；用现有选择响应的media.selected展示。真实接口若变化交后台契约唯一写者协调。

停在现有前端PR待PM审查，不合并、不部署。

手机三卡完整纵向截图：media-390-three-cards-full.png（335×2041图片区域）；包装图失败保留账单截图：media-390-package_failed-package-error.png。通过185项是开发自测，不代替独立QA验收。


## 最新视觉追加及共享v2接收

按Issue #60追加与用户照片标注形式，三候选采用白底/近白底摄影，桌面三张并排、手机纵排；选后以横向完整场景、六边形异形包装及竖幅纸包摄影分别作为开发夹具。图片保留原始宽高比，场景不裁成方形。照片使用Pexels网站使用许可，作者与来源逐文件记录在web/public/img/media-demo/photo-sources.json。场景道具不纳入赠送清单。没有复制参考照片或其原文，没有调用任何图像生成服务。

标注为独立HTML中文短句与SVG二次/三次曲线箭头，3处，优先放留白，没有编号框；仅aria与文字等价有顺序。图片归一化端点映射到实际图片范围，曲线null时仅进行前端显示插值，有后台控制点时按契约使用。局部画面采样选择暖白/深色，带轻微对比描边；没有使用未获许可手写字体，采用清晰中文系统字体。手机显示可点按的小圆标记与图外可读中文；可放大200%，不缩小文字到无法阅读。新版图版本不匹配或缺失时丢弃标注，不重用旧坐标。

后台契约实施中升级到retrieval-media-v2；最终只读文件SHA256：F84AE16C00242D3F4D53A0EA7DA669975BAB36E82B7ABBD867B75FA5CCF5FAFA（后台7204b64时点）。本线支持physical unknown、packaging/scene说明、版本绑定、1/2控制点和空图元数据，不修改共享契约。开发夹具显式kind=demo；真实v2 provider要求ai_illustration，当前demo是开发模式例外，不声称通过服务端真实v2响应验证。真实provider缺失时应返回unavailable，不可用本地照片替代真实生成。

页面保留“AI包装效果示意”，紧邻说明“当前为授权摄影开发夹具，非AI生成结果”，不误标照片为AI成果。与照片相关的价格无读取日期、非报价证据；包装尺寸/重量/材质适配unknown，不作生产或运输承诺。

试跑中一次19002服务停止导致等待失败，重启本线服务后复跑。所有最终统计以本目录结果JSON为准，未通过的中间试跑不计入PASS。旧证据保持原提交文件，新回归证据只写本目录。
