# Issue122 跨设备交接：运行存储与状态清单（冻结源码静态核查）

冻结版本：`eceef056ce80399b83c61f62860a32d0ead16e3d`。本轮读取专属clean detached工作树。下文代码路径均相对该冻结仓库并带静态行号；`R`指运行副本通过代码位置推导的REPO_ROOT，绝非用户桌面目录。

本任务仅rg/Get-Content读取源文件；没有读取数据库内容、认证值、个人浏览器配置、旧演示目录，未执行代码导入、测试、HTTP/模型/图片请求或服务操作。没有修改冻结代码。本文不是云部署/跨系统运行验证；仅列静态实现及迁移前置。

## 结论

1. 当前可信推荐与owner会话主要在单进程内存。磁盘有选后AI图任务和资产，不代表重启后能恢复用户会话；媒体API还要求内存run存在且当前owner匹配。
2. 不是“换机器复制目录即完成”。至少要明确运行时Node、可写存储、合法资料导入目录、SQLite显式路径，以及是否接受单进程/重启丢run。冻结代码尚含Windows路径前提。
3. 推荐阶段网络配图已取消；旧参考图缓存和模块是历史合法证据保留，不应为迁移而重新抓图或开启补图。选后AI效果图任务及资产另行保留，不得误删或自动重投。

## A. 存储/内存总表

| 类别 | 默认位置及配置 | 写行为/容量/TTL | 重启与单进程/多副本限制 | 静态依据 |
|---|---|---|---|---|
| 可信run、选择、推荐幂等 | 无文件；模块级`runs`/`recommendationKeys` Map，每run含`selections` Map；无持久化env开关 | 最多200个run；逻辑TTL10分钟，get/prune时检查；无后台持久化或定时清理。含候选、校验、修订计数、owner绑定与选择状态 | 重启全部丢失；多副本互不认识run/幂等键。同run重试/选择保证仅覆盖命中的单进程 | `web/server/store.mjs:14-19,28-59,68-84` |
| 正在推荐/呈现任务 | `pipeline.mjs`的`pendingRecommendations` Map；run上`presentation_jobs` Map | 推荐pending键含owner及完整输入；上限200；finally移除；呈现任务去重依赖同run对象 | 重启任务/Promise消失；多副本重复请求不能靠此去重。粘性路由只能缓解请求落点，不能提供重启恢复 | `web/server/pipeline.mjs:171-177,714` |
| owner/session签名状态 | `server.mjs`启动时`randomBytes(32)`生成`sessionSecret`；源码没有稳定会话secret的env解析/持久化接口 | Cookie只作为会话ID签名载体；本文不复制任何实际Cookie或secret。无共享session数据库或跨副本keyring | 每次重启签名密钥改变，旧会话签名不再有效；多副本各有密钥，owner无法可靠一致。文件owner_hash不解决会话恢复 | `web/server/server.mjs:76-81,414-426` |
| 避开项解析/确认状态 | `exclusion-store.mjs`的analyses Map；无文件/env | 上限200、TTL10分钟，create/get时prune；保存输入、候选语义限制及确认状态 | 重启丢失；不同副本不能延续同analysis确认；属于可能含用户上下文的内存状态，不能当匿名资料包导出 | `web/server/exclusion-store.mjs:3-26` |
| intake解析缓存与in-flight | parseCache/pendingParses Map；无文件/env | 已完成缓存上限50、TTL10分钟；pending完成后清除；key由text/form/model派生 | 仅当前进程，重启清空；不应把这些用户输入缓存当公开素材复制。TTL在读取时检查，不是磁盘保留策略 | `web/server/llm/intake-parse.mjs:697-708,849-857,943-953` |
| 检索队列/来源availability | `RetrievalWorker`队列/运行计数；availability模块共享processState及每tracker sessions Map | 配置queueLimit4、总timeout90秒；符合条件公开HTTP工作有界并发最多3；风控统计窗口默认15分钟、重复阈值2；暂停状态不自动解封 | 队列、来源会话状态与暂停记录重启丢失，多副本不共享；风险窗口并非自动恢复TTL。当前停用电商属于产品范围策略，不应因重启变为恢复抓取 | `web/server/config.mjs:448`; `web/server/retrieval/worker.mjs:12-36`; `web/server/retrieval/source-availability.mjs:56-69,107-109` |
| 服务器请求速率限制 | 本次静态检索未发现独立服务器级共享rate-limiter；来源状态中的rate_limited只是远端访问结果分类 | 已有输入字节上限、队列和模型预算不等同服务入口限流 | 不能据源码宣称具备云端/跨副本请求限流；如上线需要由部署入口/后端负责人明确配额与限流设计 | `web/server/server.mjs:85,110-117`; `web/server/retrieval/source-availability.mjs:10,24` |
| 商品/历史采集SQLite | 在线统一`localDbPath()`：`GW_LOCAL_DB` > `GIFTWISE_CATALOG_DB` > `[LEGACY_WINDOWS_DEMO_DB]`。独立`localdb/db.mjs`旧默认为`R/.local-db/giftwise.sqlite`（只认GW_LOCAL_DB） | 写openDb会mkdir、建表、迁移；Schema启用WAL/foreign_keys，含products、collection_runs、product_images、price_observations；real版另有page_screenshots。catalog读取只读打开、timeout2000ms；无全库容量/TTL/归档策略 | 必须先明确唯一库路径及可写/只读用途。不能打开未知默认路径碰巧建出空库。WAL不是多主分布式协调；Node DatabaseSync同步调用也不等同可横向扩容。本文未开库、未核查数据/大小 | `web/server/config.mjs:371-392`; `web/server/localdb/db.mjs:18-32`; `web/server/localdb-real/db.mjs:34-50`; `web/server/catalog/db.mjs:50-59`; 两处`schema.mjs:24-28` |
| SQLite附属公开内容/旧场景图 | provider可在显式库创建`inspiration_observations`并INSERT OR REPLACE；scene_images含file_path/sha/生成记录，文件可为repo相对或绝对路径 | 内容表无TTL/总容量回收；scene pool ensure可能建表（不能把所有“检查”都理解为只读）。已有场景资产/账本不应自动重建 | 跨设备绝对file_path不保证存在；相对路径需保持R下对应资产布局。复制DB不等于复制图片；不要把旧生成场景图误认为真实网络参考资料 | `web/server/retrieval/domestic-provider.mjs:79-84`; `web/server/localdb-real/scene-pool.mjs:87-126,138-139`; `web/server/server.mjs:684-693` |
| 匿名真实文本material cache | `R/.tmp/material-cache/materials.json`；createMaterialCache可注入directory/maxRecords/maxAgeMs/now/sensitiveValues，生产pipeline默认构造；无专门env改目录 | 单文件≤512KiB、总≤80条、年龄≤7天，get近20并标截断；原observed_at不续期。仅公开匿名白名单字段，不存图/价/库存/用户query。同步写独占临时文件后rename；损坏/写失败返回unavailable。过期是读/写过滤，不是独立后台清理 | 可保留合法公开材料跨重启复用，仍需模型判断与新主题关联；不恢复run/owner。多个进程read-modify-rename无锁/CAS，可能后写覆盖先写；原子rename只避免半份JSON，不保证多写者事务 | `web/server/retrieval/material-cache.mjs:9-15,35-50,66-80,83-120`; `web/server/pipeline.mjs:262-263,312` |
| 合法文本资料bundle导入 | `importMaterialBundle(bundleDirectory,{cache})`显式接收目录；读`manifest.json`；不是自动扫描/启动导入；无目录env参数 | 总≤256KiB、≤80条、字段白名单；逐祖先拒symlink/junction；只导入摘要/文本字段，无图片处理。可通过可信cache.put写当前运行树缓存；保留观察时间，不能导入时改成今天规避7天过期 | 来源边界硬编码`resolve('E:/黑客松')`，非该路径/非该平台时有阻断，见下节；不能将任意演示DB/用户状态转换为匿名资料包 | `web/server/retrieval/material-bundle.mjs:6-24,48-60,63-77` |
| 选后AI媒体任务与生成资产 | 默认`R/.tmp/media-store/tasks/<task_id>.json`和`assets/<sha256>.png|jpg`；MediaTaskStore构造参数可指定root，但默认provider无MEDIA_STORE_DIR等env解析 | 创建任务wx/fsync，已存在不再创建；状态保存用UUID临时文件rename；资产内容hash命名wx去重，读取验hash。无任务/资产TTL、数量上限或自动GC | 磁盘任务/资产可保留，但API要内存run+owner匹配：重启后仅文件不等于旧会话可访问。pending任务executor_instance与本进程不符时返回execution unknown/failed，不自动重试以免重复付费。共享目录多个正在运行实例也会彼此判foreign pending，故当前不是多worker租约系统 | `web/server/media/task-store.mjs:5-23`; `web/server/media/provider.mjs:47,79-84,98-105,124-131`; `web/server/server.mjs:411-421` |
| 生图in-flight/参考授权消费 | provider.jobs WeakMap、active Map；Seedream consumedGrants Set；plan grantSeq进程变量 | 同run+candidate+plan版本进程内去重；active完成删除；参考grant单次消费只在当前进程Set，无跨进程事务或TTL | 重启/副本不共享消费状态。磁盘任务独占创建可帮助抑制同task重复提交，但不能代替共享会话、执行租约和授权消费持久化。不得为恢复而盲目删pending任务再重投 | `web/server/media/provider.mjs:47,79-84,99-105`; `web/server/media/seedream.mjs:89,99-113`; `web/server/media/plan.mjs:101-110` |
| 旧来源/参考图片cache | 真实读写为`R/.tmp/catalog-images/<image_id>.<ext>`；无目录env；校验后同步写入，读取重新inspectImage | 无总容量/磁盘TTL/GC；HTTP返回private,max-age=86400只是浏览器缓存头，不代表磁盘文件一天后删除。server保留的CATALOG_IMAGE_CACHE常量是旧`web/.tmp`相对位置，实际readImageCache已委托readSourceImage，不能据旧常量误盘点实际存储 | 当前推荐图链路已停用，保留旧合法资产；搬迁需显式决定是否保留，不因此重启抓图。缓存本身不携带用户run的可靠恢复机制 | `web/server/catalog/source-image-cache.mjs:7-19`; `web/server/server.mjs:173,231-232,383-386` |
| 风格板旧/可选资产 | `R/.tmp/style-boards/<sha256>.png|jpg`；无目录env，STYLE_DIRECTION_CHANNEL控制使用通道而非目录 | saveStyleBoard mkdir+wx按hash去重；无TTL/总量回收；接口按受限文件名读取 | 文件可保留但不恢复run状态；选后AI图不应因迁移推荐图片取消而全局关闭 | `web/server/visual/provider.mjs:56,292-301`; `web/server/server.mjs:235-237,399-407` |
| 检索审计 | 生产`R/.tmp/retrieval-audit/<uuid>.json`；测试另子目录；构造directory可注入，无生产目录env | 128KiB/文件；≤200文件、≤7天，保存时清理，不是后台定时器；每次临时文件wx+rename。只保留脱敏有界证据；失败不阻断推荐 | 文件可持久化作证，不用它重建可信run/owner。多进程不同UUID通常不互相覆写，但各自清理同目录可能竞争；没有集中审计事务/归档服务 | `web/server/retrieval/audit-store.mjs:22-25,45-63` |
| LLM调用ledger及预算 | `R/.tmp/llm-calls/ledger.jsonl`；`GW_LLM_LEDGER_FILE`最高优先（惰性resolve）；测试自动test-ledger-PID.jsonl | 每真实调用append JSONL，无文本prompt/key字段；无代码内轮转/TTL/文件大小上限，readLedger全文件读。内存calls/attempts/byKind计数重启归零；真实callBudget通过realCallCount读落盘行数 | 持久化账本可保留历史计数，但多进程预算检查+发送+append非原子，不能当全球付费额度锁。该env未走taskPath，必须由部署者显式限定合法项目/卷内路径；禁止自动reset真实账本 | `web/server/llm/ledger.mjs:32-53,61-90,106-124,131-156`; `web/server/llm/provider.mjs:180-186` |

以上“无TTL/上限”仅指所列静态实现没有相应回收策略，不表示当前磁盘实际已超量；本任务没有遍历数据或检查文件体积。

## B. Windows/路径与Linux差异：具体阻断与非阻断

### 1. task-paths.mjs：没有E盘常量，但仍限制部署布局

- `REPO_ROOT`由`localdb/db.mjs:16-18`通过`fileURLToPath(import.meta.url)`和dirname推导，不是URL.pathname，因此此处不会把中文目录当百分号路径。这一计算原则可适用于Linux。
- `taskPath`（`collect/task-paths.mjs:10-28`）要求路径词法位于当前REPO_ROOT，并要求既有祖先realpath仍位于该根；根本身若通过工作树外符号链接定位，也可能被拒绝。它不是“仅E盘可用”的函数，但**不允许任意外置/data卷的路径**。
- 例如代码在`/srv/giftwise`，直接把cache配置成`/var/lib/giftwise/...`会被taskPath拒绝；`.tmp -> /var/lib/...`符号链接同样不满足当前边界，material-cache还拒任何既有符号链接。可写挂载若仍直接呈现为代码树下`.tmp`、且不是向根外解析的symlink，才可能符合现有边界；是否满足容器挂载realpath必须部署时验证，本次不作运行承诺。
- `taskProcessEnv`（同文件41-52）能设置TEMP/TMP/TMPDIR、XDG、npm/OpenCLI缓存；但还固定建立`home/AppData/Roaming/Local`和Windows目录，设置USERPROFILE/APPDATA/LOCALAPPDATA。它不设置HOME，且只对实际使用该helper的子进程生效，不会自动约束所有Node模块、第三方工具或云容器全局缓存。因此Linux仍须给运行进程配置合法TEMP/XDG等、逐路径核实；不能把此helper当完整跨平台运行时沙箱。

### 2. material-bundle.mjs：明确E盘项目根是迁移阻断

- `retrieval/material-bundle.mjs:8`是`const PROJECT_ROOT=resolve('E:/黑客松')`；它没有env或options覆盖，sourcePath:14-20据此限制来源目录并逐祖先查链接。
- Windows上另一个盘符或项目目录也会被拒；Linux的path.resolve不会把`E:/...`解释为Windows盘符绝对路径，而是将它作为当前cwd下含`E:`目录名的相对路径来解析，例如运行cwd为`/srv/giftwise`时会指向`/srv/giftwise/E:/黑客松`。正常的`/srv/giftwise/import/...`资料目录因此不在允许范围，导入失败。
- 在Linux伪造`E:`目录不是正式迁移方案。需由C/后端路径owner另开变更，将合法项目/资料根通过可信配置显式注入，同时保留realpath/symlink/有界读取/匿名字段验证；该冻结交接任务不改代码、不放宽安全边界。

### 3. SQLite旧默认与其他可移植性

- config.mjs:371的`[LEGACY_WINDOWS_DEMO_DB]`只是历史源码默认，不是本次授权迁移来源。本文不复写其用户目录绝对路径，未读取或打开该路径/DB。跨设备必须显式GW_LOCAL_DB（或既有GIFTWISE_CATALOG_DB）定位经过批准的目标库，不能依赖该默认。Linux若将Windows样式路径送入path.resolve，可能变成cwd下意外的`C:`子目录；写openDb还有mkdir/建表行为，风险不只是“找不到文件”。
- 运行依赖`node:sqlite`/DatabaseSync及FTS5/WAL，须确认目标Node版本与构建能力；源码注释的旧机验证不等于目标Linux实测。目录默认repo-relative并不保证只读镜像可写。
- SQLite一致性迁移应由DB负责人制定备份/checkpoint/快照窗口，不能在活跃WAL写入时只复制主.db就宣称完整；此任务不读、不拷贝、不checkpoint任何库。
- 旧scene_images可能保留绝对file_path（scene-pool.mjs:138-139），跨设备不可默认复用。浏览器/OpenCLI历史模块还有Windows可执行文件搜索和USERPROFILE发现逻辑（collect/chrome.mjs:23-26、domestic-browser.mjs:9-14），即使当前文本HTTP主线不需要Chrome，也不能据此宣称所有旧能力原样Linux可运行。

## C. 最小迁移前置与建议负责人

1. **PM/部署负责人**：先明确目标是单进程短会话演示还是可恢复云服务。当前最小可评估方案是单实例+明确的持久卷/备份与重启丢run说明；这也仍需目标环境运行验证，本文不批准部署。
2. **C/后端路径owner**：解决bundle硬编码根、明确运行写根与可读导入根；列出cache/audit/media/ledger所需写目录。保留路径与匿名资料校验，拒跨边界symlink，不为“能跑”全局放宽taskPath。
3. **部署/DB owner**：显式配置目标库路径；未取得合法数据与资产前保持缺失状态，不拷贝用户演示DB或认证。准备目标Node/权限/持久卷，检查SQLite伴随文件、assets及相对路径一致性；资料包仅匿名文本。
4. **A/后端媒体owner**：保留选后AI task/asset及幂等规则；制定pending任务执行未知、故障恢复及防重复付费策略。若需重启会话恢复或多副本，需同时持久化run/owner授权、稳定签名key轮换和执行租约，不能只共享media-store目录。
5. **后端/基础设施owner**：若横向扩容，统一会话、幂等、队列、限流/额度、风险暂停、缓存并发写与审计归档策略；在此之前不标记多副本ready。公开素材cache可共享匿名内容，但候选绑定/个人上下文不能共享成全局匿名状态。
6. **QA/发布负责人**：目标环境另做最小必要启动、路径拒绝/可写卷、重启后行为、owner隔离及已完成AI图读取检查；需要真实模型/生图另行批准/复用既有资产，不能让本交接文档触发重测或计费。

## D. 明确未核实

未检查任何数据文件是否存在、含多少条、是否含敏感内容、是否已备份；未读取DB、ledger内容、Cookie/secret/环境实际值；未验证Linux、容器、网络、模型供应商或多副本。不把旧性能样本的e758+dirty状态当最终clean版本证据；本稿只依据指定冻结eceef056静态源码。冻结8912/PID35812、exec66164、8903及其他工作树服务均未操作。

本材料由C汇总交PM，没有新增业务代码提交、PR、push或服务/登录变化。

## E. 配置边界补充

- 冻结源码没有统一DATA_ROOT开关。默认repo-relative目录、构造注入与真正env覆盖是三种不同能力：material cache/audit可构造注入，但现生产pipeline没有对应目录env解析；媒体默认store目录亦固定由import.meta.url推导，不能写成“设置DATA_ROOT即可全部搬迁”。
- MediaTaskStore构造函数仅resolve(root)，自身未调用taskPath或检查当前树边界（media/task-store.mjs:6-7）；默认路径来自provider.mjs:131。若未来注入自定义root，部署代码必须另行做可信路径/权限约束，不能误认为它与material-cache一样自动拒绝树外目录。
- GW_LLM_LEDGER_FILE实际env可配，但ledger.mjs:50-51只是resolve，未统一taskPath校验。账本无内置轮转，且写入失败仅在代码内吞掉而不改变业务成功；部署必须配置路径、磁盘监测和审计告警，不能仅据成功响应认定账本写成。
- 7天年龄限制确实来自material-cache（material-cache.mjs:10,14-15,69-71）。material-bundle自身只验证时间格式和不超未来约1秒（material-bundle.mjs:52），没有独立的7天清理器；注入默认cache后旧记录按其7天规则筛选，原observed_at绝不续期。不要将“包成功读入”直接等同“全部记录仍在当前cache内可用”。
- 本稿不再扩大枚举局部临时Map；上述长期/跨请求状态及模式相关计数足以说明单进程边界。无新增运行验证，容量或清理机制未在相应实现看到时均按“无内置/未核实”处理。

- MODE.current是按进程GW_MODE与文本配置存在性计算的getter（config.mjs:158-169），不是可从旧磁盘搬迁的模式状态。另一设备需自己安全配置；本轮未读取实际环境值或凭据。

- LLM预算检查在发送前读账本、完成后再append，并非原子扣额；同进程的并发请求也可能同时通过旧计数，不能把单实例内存计数或文件行数当严格并发总付费锁。此为静态推导，未做付费并发测量。
