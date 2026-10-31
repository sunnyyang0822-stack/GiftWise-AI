/**
 * GiftWise AI · 场景兜底图池 · 词条清单（单一事实来源）
 *
 * 用途：当「平台商品图抓不到」（真实商品图缺失）时，用**AI 生成的场景示意图**兜底，
 *       让用户至少能看到「这个礼物大概长什么样 / 用在什么场合」。
 *
 * 🔴 硬性约束（与任务书一致）：
 *   1. 本清单里的每一张图都由生图模型生成，**不从网上抓取、不下载任何第三方图片**。
 *   2. 生成的图**不是商品实物图**，对外必须带 `kind: "generated_scene"` 与中文免责说明，
 *      绝不允许被当成「真实商品图 / 实物图」使用或展示（见 scene-pool.mjs 的 SCENE_KIND）。
 *   3. 词条是**冻结常量**：一旦生成入库就不再改名，改名会让库里 50 行对不上。
 *
 * 组成：
 *   A 类 · 礼物类型 category='type'  ：20 条，单画面，无色调（palette = null）
 *   B 类 · 礼物场景 category='scene' ：10 个场景 × 3 种色调 = 30 条
 *   清单合计 50 条。
 *
 * 🔴 交付口径与清单不是一回事（2026-10-31 产品裁定，见下面 DELIVERED_* 常量）：
 *   - **交付 30 张**（A 类 12 + B 类 6 场景×3 色调）；
 *   - 实际**已生成 50 张**，多出来的 20 张**文件与记录都保留**，只是不列入交付。
 *   本文件是「生成清单（50）」与「交付清单（30）」两个口径的共同事实来源。
 *
 * scene_id 命名（Windows 文件名安全，不含 `:` `\` `/` 等）：
 *   A 类：`type-<slug>`           例如 type-scented-candle
 *   B 类：`scene-<slug>-<palette>` 例如 scene-workshop-mono
 */

/** 三种色调：必须三档齐、且视觉差异明显到可被识别。 */
export const PALETTES = Object.freeze(['mono', 'warm', 'cool']);

/** 色调的中文说明（写进报告与返回结构，方便人核对）。 */
export const PALETTE_LABELS_ZH = Object.freeze({
  mono: '黑白极简',
  warm: '暖色调',
  cool: '冷色调',
});

/** 三种色调共用的画面描述片段（保证同场景三档可比、只有色彩差别）。 */
export const PALETTE_PROMPT_ZH = Object.freeze({
  mono: '色彩：**黑白极简**——只允许黑、白、灰与极浅的中间调，无任何彩色，去掉一切暖冷色偏，高反差、留白充足，像黑白胶片或美术馆展陈照片。',
  warm: '色彩：**暖色调**——以米白、奶油、浅木色、琥珀、暖橙为主，光线偏暖偏黄，有柔和的暖色高光与暖阴影，像黄昏窗边的暖光。',
  cool: '色彩：**冷色调**——以青灰、雾蓝、冷白、银灰为主，光线偏冷偏蓝，有清冷的冷色高光与冷阴影，像阴天清晨的散射光。',
});

/**
 * 单条词条的**提示词覆盖**（默认提示词之外的特例，仍属冻结清单的一部分）。
 *
 * 🔴 为什么要有它：库里存的 `prompt` 必须**等于**生成磁盘上那张图时真正用过的提示词，
 *    否则「按 prompt 可复现」就是假的。所以重生成时的强化提示词要落在这里，
 *    而不是只写在一次性脚本里。
 *
 * 当前只有一条：
 *   `scene-workshop-warm` —— 2026-10-31 首次生成时**出现了 4 个清晰人物与面孔**，
 *   违反了原提示词里「不要出现人脸与清晰人物」的约束。经产品确认后重生成一次，
 *   强化为「绝对不能出现任何人物/人脸/人手/人影/剪影，所有椅子必须是空的」，
 *   **并保留暖色调描述**（否则会破坏该条 palette=warm 的记账与像素核验结论）。
 *   重生成原因与前后对比见 docs/architecture/场景兜底图池-2026-10-31.md。
 */
export const PROMPT_OVERRIDES = Object.freeze({
  'scene-workshop-warm':
    '一张礼物赠送场景示意图（体验课/手作工作坊·暖色调）：' +
    '一间明亮的手作工作坊，**空无一人**：长木桌上摆着材料盘、未完成的手作半成品与几件工具，' +
    '几把**空椅子**，窗外是白天的街道或绿植，桌上有轻薄的木屑与线轴，' +
    '气氛专注而轻松，像一节即将开始、学员还没到场的手作体验课。' +
    PALETTE_PROMPT_ZH.warm +
    '要求：真实摄影质感、构图干净；' +
    '**画面中绝对不能出现任何人物、人脸、五官、人手、手指、人的手臂或腿，也不允许出现人物剪影、背影、倒影，' +
    '连远景和虚化背景里的人也不允许；画面里所有椅子都必须是空的**；' +
    '画面里也不要出现任何文字、logo、品牌名、价格标签或水印；不要拼贴、不要多格分割。',
});

/**
 * 所有词条。字段：
 *   scene_id  稳定主键，见上面的命名规则
 *   label     中文展示名
 *   category  type | scene
 *   palette   mono | warm | cool | null（type 类为 null）
 *   aliases   查询时可用的别名（pickSceneImage 用；"体验课/手作工作坊" 这类带斜杠的写法都收）
 *   prompt    交给生图模型的原始提示词（原样入库，便于复现）
 *   prompt_overridden  该条是否用了 PROMPT_OVERRIDES（如实标注，不藏）
 */
export const SCENE_POOL_CATALOG = Object.freeze([
  // ---------------------------------------------------------------- A 类 · 礼物类型（20）
  ...[
    ['scented-candle', '香薰蜡烛', ['香薰蜡烛', '香薰', '蜡烛'], '一支装在磨砂玻璃杯里的香薰蜡烛，烛芯已点燃，一小簇暖色火苗，旁边散着几朵干燥花与一支未点燃的同款蜡烛；木质桌面，浅景深特写，商业静物摄影，45 度俯视。'],
    ['coffee-beans-gift-box', '单品咖啡豆礼盒', ['单品咖啡豆礼盒', '咖啡豆礼盒', '咖啡豆'], '一个打开的牛皮纸礼盒，里面是单产地咖啡豆的密封袋与一张手写风味卡，旁边撒着几颗烘焙咖啡豆与一把木勺；亚麻桌布，侧上方柔光，商业产品摄影。'],
    ['handmade-jewelry', '手工饰品', ['手工饰品', '手作饰品', '饰品'], '一枚手工打造的银质细戒与一条细链手链，放在一块深色绒布上，旁边是极小的锤痕纹理特写；微距摄影，单侧硬光勾出金属高光，背景干净虚化。'],
    ['plush-toy', '毛绒玩偶', ['毛绒玩偶', '毛绒玩具', '玩偶'], '一只圆润柔软的米白色毛绒小熊坐姿玩偶，绒毛质感清晰可见，脖子系一条窄丝带；放在浅色木地板上，柔和漫射光，正面平视，背景是模糊的房间一角。'],
    ['hardcover-book', '精装书', ['精装书', '精装图书', '书'], '一本布面精装书立在浅色桌面上，书脊烫金细线、书页边缘齐整，旁边压着一枚黄铜书签；斜侧光扫过布面纹理，浅景深，安静的阅读氛围。'],
    ['fountain-pen', '钢笔', ['钢笔', '金笔', '签字笔'], '一支深色树脂笔身的钢笔平放在深色皮革笔垫上，笔帽取下搁在旁边，金属笔尖反出一点锐利高光；微距商业摄影，深背景，单点硬光。'],
    ['cashmere-scarf', '羊绒围巾', ['羊绒围巾', '围巾', '羊绒'], '一条叠放整齐的浅灰羊绒围巾，边缘有手工卷边与细微绒毛，搭在一张木椅扶手上；窗外自然侧光，质地细节清晰，色调清淡，生活静物摄影。'],
    ['thermos-bottle', '保温杯', ['保温杯', '保温水瓶', '水杯'], '一支哑光纯色不锈钢保温杯直立放在水泥台面上，杯盖微松，杯壁上有一层极薄的冷凝水雾；侧逆光勾出圆柱轮廓，背景是简洁的浅灰墙面。'],
    ['bluetooth-earbuds', '蓝牙耳机', ['蓝牙耳机', '耳机', '无线耳机'], '一副白色真无线蓝牙耳机与它的充电盒一起放在浅色石纹台面上，盒盖打开、耳机归位，指示灯亮着一点微光；顶部柔光，商业数码产品摄影，干净背景。'],
    ['succulent-plant', '多肉绿植', ['多肉绿植', '多肉', '绿植', '盆栽'], '一株饱满的多肉绿植种在粗陶小盆里，叶片上有细微粉霜质感，盆边散落几颗小白石；放在木窗台上，逆光透亮，浅景深特写。'],
    ['perfume', '香水', ['香水', '淡香水', '香氛'], '一只厚玻璃方瓶香水立在浅色石材台面上，玻璃内有淡金色液体，金属瓶盖扣在瓶身一侧，瓶身边缘有一条锐利的高光带；深色渐变背景，产品摄影打光。'],
    ['handmade-chocolate', '手工巧克力', ['手工巧克力', '巧克力', '手工巧克力礼盒'], '一颗颗手工巧克力排在小木托盘上，表面有可可粉与手刷的纹理，其中一颗被掰开露出内馅；暖色小灯侧照，微距美食摄影，浅景深。'],
    ['tea-set', '茶具', ['茶具', '茶器', '陶瓷茶具'], '一套素色陶瓷茶具：一只小壶与两只茶杯摆成斜向一组，壶嘴还余一点热气，桌面有极淡的水痕；柔和顶光，宋代极简气质，安静的静物构图。'],
    ['wooden-puzzle', '木质拼图', ['木质拼图', '拼图', '木制拼图'], '一副木质拼图摆到一半，几十块原木色拼块在其中一块正要落下的位置，木纹与切割边缘清晰；暖色桌面俯拍，侧光让拼块产生薄薄的立体阴影。'],
    ['instant-camera', '拍立得相机', ['拍立得相机', '拍立得', '即时相机'], '一台米白色复古造型的拍立得相机放在桌面上，镜头朝前，出片口吐出一张尚未显影的白色相纸；旁边散着两张已显影的日常小照片，暖调生活摄影。'],
    ['art-supply-set', '画材套装', ['画材套装', '画材', '颜料套装'], '一个打开的木质画材盒：一排颜料管、几支用旧的画笔与一小块调色板，颜料痕迹真实、不刻意整齐；斜上方自然光，桌面有轻微颜料污渍，俯视构图。'],
    ['tie', '领带', ['领带', '领带礼盒'], '一条深色斜纹领带卷成一卷放进敞开的礼盒里，领带结形完整，旁边是一枚简洁的金属领带夹；深色木质桌面，侧光突出丝质光泽，商务礼品静物摄影。'],
    ['wallet', '钱包', ['钱包', '真皮钱包', '皮夹'], '一只深棕色植鞣革短款钱包半开着放在木桌上，皮面有自然的折痕与细微毛孔纹理，压印没有任何文字；侧光扫过皮革，暖调，微距商业摄影。'],
    ['skincare-set', '护肤套装', ['护肤套装', '护肤品', '护肤礼盒'], '一套三件的护肤产品：一瓶精华、一支乳液与一小罐面霜并排摆在浅色石纹台面上，瓶身都是无标签的磨砂玻璃与哑光塑料；通透柔光，洁净的化妆台氛围。'],
    ['desktop-speaker', '桌面音箱', ['桌面音箱', '音箱', '蓝牙音箱'], '一只木质箱体的桌面音箱放在书桌上，圆形喇叭单元网罩纹理清晰，旁边有一条盘起的编织电源线；侧逆光带出木纹与圆角的体积感，极简桌面环境虚化。'],
  ].map(([slug, label, aliases, prompt]) => ({
    scene_id: `type-${slug}`,
    label,
    category: 'type',
    palette: null,
    aliases,
    prompt: `一张礼物类型示意图：${label}。${prompt}要求：单一主体、构图干净、真实摄影质感；画面里**不要出现任何文字、logo、品牌名、价格标签或水印**；不要出现人手与人脸；不要拼贴、不要多格分割。`,
  })),

  // ---------------------------------------------------------------- B 类 · 礼物场景（10 × 3 = 30）
  ...(() => {
    const scenes = [
      ['workshop', '体验课/手作工作坊', ['体验课/手作工作坊', '体验课', '手作工作坊', '手工课', 'workshop'],
        '一间明亮的手作工作坊：长木桌上摆着材料盘、未完成的手作半成品与几件工具，几张椅子围坐，窗外是白天的街道或绿植，桌上有轻薄的木屑与线轴，气氛专注而轻松，像一节刚开始的手作体验课。'],
      ['birthday-dinner', '生日聚餐', ['生日聚餐', '生日', '生日饭', 'birthday'],
        '一张铺好餐布的餐桌，中央是一只插着细蜡烛的奶油蛋糕，围着几副餐具与半满的杯子，椅背上搭着外套，背景是晚间室内灯光与暖色的墙面装饰，气氛热闹但画面干净，没有人物。'],
      ['graduation', '毕业', ['毕业', '毕业季', 'graduation'],
        '毕业季的场景：一顶学士帽与一卷系着缎带的证书放在石阶或草地上，旁边有一束简单的花与一只帆布包，背景是校园建筑与树影，初夏的光线，画面里没有人物。'],
      ['new-job-promotion', '入职升职', ['入职升职', '入职', '升职', '新工作', 'promotion'],
        '新办公位：一张整洁的办公桌，桌上有崭新的笔记本、一支笔、一只水杯与一小盆绿植，显示器旁立着一只未拆的搬家纸箱，椅背上挂着新工牌（无文字无 logo），窗边日光，正式而充满起步感。'],
      ['anniversary', '纪念日', ['纪念日', '周年', '相恋纪念', 'anniversary'],
        '纪念日的安静室内：一张小圆桌上摆着两只高脚杯、一小束花与一个扁平的礼物盒，蜡烛点着，桌边有两把相对的椅子，背景是傍晚窗光与虚化的暖色灯串，浪漫克制，无人物。'],
      ['parents-day', '母亲节/父亲节', ['母亲节/父亲节', '母亲节', '父亲节', 'parents day'],
        '一个家的客厅一角：茶几上放着一束康乃馨与一个包装朴素的礼物盒，旁边是一只冒着热气的茶杯与一副老花镜或一把折好的报纸，沙发靠垫摆得整齐，午后阳光斜进窗，温暖家常，无人物。'],
      ['teachers-day', '教师节', ['教师节', '谢师', 'teachers day'],
        '一张教师办公桌：桌面上摆着一小束花、一张对折的手作贺卡（空白无字）、一本翻开的书与一支笔，粉笔盒与黑板在背景里虚化，白天教室的侧光，安静郑重，无人物。'],
      ['mid-autumn', '中秋', ['中秋', '中秋节', '月饼', 'mid autumn'],
        '中秋夜色：一张圆桌或阳台小桌上摆着切开与完整的月饼、几只茶杯与一壶热茶，旁边有一盏小灯笼，背景是夜空与几点灯光，桌面被暖色灯光照亮，团圆安静的气氛，无人物。'],
      ['new-year', '新年', ['新年', '春节', '过年', '新年礼物', 'new year'],
        '新年的桌面：几只红包（空白无字）、一小盆水仙或冬青枝、一副春联卷起放在一边，还有一盒茶或糕点，窗外隐约有夜色与红灯笼的散景，热闹喜庆但画面克制，无人物无文字。'],
      ['hospital-visit-elder', '探病/拜访长辈', ['探病/拜访长辈', '探病', '看望长辈', '拜访长辈', '探视'],
        '探病或拜访长辈的安静画面：床头柜或边几上放着一只保温桶、一小篮水果与一束清淡的花，旁边是一本合上的书与一杯温水，窗帘半开透进柔和日光，洁净素净，无人物、无医疗器材特写。'],
    ];
    return scenes.flatMap(([slug, label, aliases, base]) =>
      PALETTES.map((palette) => {
        const scene_id = `scene-${slug}-${palette}`;
        const override = PROMPT_OVERRIDES[scene_id];
        return {
          scene_id,
          label,
          category: 'scene',
          palette,
          aliases,
          // 有覆盖就用覆盖（库里存的必须是**真正用过**的提示词），并如实标注。
          prompt:
            override ??
            `一张礼物赠送场景示意图（${label}·${PALETTE_LABELS_ZH[palette]}）：${base}${PALETTE_PROMPT_ZH[palette]}要求：真实摄影质感、构图干净；画面里**不要出现任何文字、logo、品牌名、价格标签或水印**；不要出现人脸与清晰人物；不要拼贴、不要多格分割。`,
          prompt_overridden: Boolean(override),
        };
      }),
    );
  })(),
]);

/**
 * 实际生成口径：本清单共 50 条，2026-10-31 已**全部**生成入库（文件与记录都保留，不删）。
 * 这是历史事实，不随后续交付口径变化而变化。
 */
export const SCENE_POOL_GENERATED_EXPECTED_COUNT = 50;

// ---------------------------------------------------------------- 交付口径（30）
/**
 * 🔴 产品裁定（2026-10-31）：**场景兜底图交付 30 张，不是 50 张。**
 *
 * 原话：「场景兜底的图可以缩减到 30 张了。」
 *
 * 裁定后的构成：
 *   A 类·礼物类型 12 个（单画面，palette = null）
 *   B 类·礼物场景  6 个场景 × 3 种色调 = 18 张
 *   ⇒ 合计 30 张
 *
 * ⚠️ 与「实际生成」的关系（**不许藏**）：
 *   - 实际生成了 **50** 张，其中这 30 张是**交付范围**，另外 20 张是**额外产物**。
 *   - 额外的 20 张**文件与库记录全部保留**（不删、不降质），只是不列入交付清单。
 *   - 交付清单是**冻结的**：由下面的 slug 列表确定，改动必须同步改测试与报告。
 *
 * 为什么砍掉的是这些（如实说明，不是「事后挑好看的」）：按产品给的清单执行——
 *   砍掉的 A 类 8 个：毛绒玩偶 / 蓝牙耳机 / 香水 / 木质拼图 / 画材套装 / 领带 / 钱包 / 护肤套装
 *   砍掉的 B 类 4 个场景：毕业 / 母亲节·父亲节 / 中秋 / 新年
 *   保留的 6 个场景里，**体验课/手作工作坊**是产品负责人点名的。
 */
export const DELIVERED_TYPE_SLUGS = Object.freeze([
  'scented-candle',
  'coffee-beans-gift-box',
  'handmade-jewelry',
  'hardcover-book',
  'fountain-pen',
  'cashmere-scarf',
  'thermos-bottle',
  'succulent-plant',
  'handmade-chocolate',
  'tea-set',
  'instant-camera',
  'desktop-speaker',
]);

export const DELIVERED_SCENE_SLUGS = Object.freeze([
  'workshop', // 体验课/手作工作坊（产品负责人点名，必留）
  'birthday-dinner', // 生日聚餐
  'anniversary', // 纪念日
  'new-job-promotion', // 入职升职
  'teachers-day', // 教师节
  'hospital-visit-elder', // 探病/拜访长辈
]);

/** 交付的 30 个 scene_id（冻结，顺序即交付清单顺序：先 A 类 12，再 B 类 6×3）。 */
export const SCENE_POOL_DELIVERED_IDS = Object.freeze([
  ...DELIVERED_TYPE_SLUGS.map((s) => `type-${s}`),
  ...DELIVERED_SCENE_SLUGS.flatMap((s) => PALETTES.map((p) => `scene-${s}-${p}`)),
]);

/** 交付期望条数（测试与自检的硬指标）。 */
export const SCENE_POOL_DELIVERED_EXPECTED_COUNT = 30;

const DELIVERED_SET = new Set(SCENE_POOL_DELIVERED_IDS);

/** 这条词条是否在交付范围内。 */
export function isDelivered(sceneId) {
  return DELIVERED_SET.has(sceneId);
}

/** 交付范围内的词条（冻结副本，顺序同 SCENE_POOL_DELIVERED_IDS）。 */
export function deliveredCatalog() {
  return SCENE_POOL_DELIVERED_IDS.map((id) => SCENE_POOL_CATALOG.find((e) => e.scene_id === id)).filter(Boolean);
}

/** 交付范围之外的额外产物（已生成但不在交付清单里，保留不删）。 */
export function extraCatalog() {
  return SCENE_POOL_CATALOG.filter((e) => !DELIVERED_SET.has(e.scene_id));
}

/** 交付清单自洽性检查：ID 必须都能在冻结清单里找到，且数量对得上。 */
export function assertDeliveryScopeConsistent() {
  const known = new Set(SCENE_POOL_CATALOG.map((e) => e.scene_id));
  const unknown = SCENE_POOL_DELIVERED_IDS.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`交付清单里有清单外的 scene_id：${unknown.join(', ')}`);
  if (SCENE_POOL_DELIVERED_IDS.length !== SCENE_POOL_DELIVERED_EXPECTED_COUNT) {
    throw new Error(`交付清单应为 ${SCENE_POOL_DELIVERED_EXPECTED_COUNT} 条，实际 ${SCENE_POOL_DELIVERED_IDS.length} 条`);
  }
  // 提示词覆盖的 key 必须都是清单里真实存在的 scene_id，否则是写错的死代码。
  const badOverride = Object.keys(PROMPT_OVERRIDES).filter((id) => !known.has(id));
  if (badOverride.length) throw new Error(`PROMPT_OVERRIDES 里有清单外的 scene_id：${badOverride.join(', ')}`);
  // 覆盖必须真的生效（防止覆盖写了但 map 里没接上）。
  for (const id of Object.keys(PROMPT_OVERRIDES)) {
    const entry = SCENE_POOL_CATALOG.find((e) => e.scene_id === id);
    if (entry.prompt !== PROMPT_OVERRIDES[id]) throw new Error(`PROMPT_OVERRIDES 未生效：${id}`);
    if (entry.prompt_overridden !== true) throw new Error(`prompt_overridden 未标注：${id}`);
  }
  return true;
}

/** 用过提示词覆盖的词条（如实暴露「哪些图不是按默认提示词生成的」）。 */
export function overriddenPromptIds() {
  return SCENE_POOL_CATALOG.filter((e) => e.prompt_overridden).map((e) => e.scene_id);
}

/** 把 scene_id 拆成 {category, slug, palette}；解析不了返回 null。 */
export function parseSceneId(sceneId) {
  const m = String(sceneId || '').match(/^(type|scene)-([a-z0-9-]+?)(?:-(mono|warm|cool))?$/);
  if (!m) return null;
  const [, category, slug, palette] = m;
  if (category === 'type' && palette) return null;
  if (category === 'scene' && !palette) return null;
  return { category, slug, palette: palette ?? null };
}

/** 按 scene_id 取词条（冻结副本）。 */
export function catalogEntry(sceneId) {
  return SCENE_POOL_CATALOG.find((e) => e.scene_id === sceneId) ?? null;
}

/** 场景（B 类）去重后的清单：10 个场景。 */
export function sceneGroups() {
  const out = new Map();
  for (const e of SCENE_POOL_CATALOG) {
    if (e.category !== 'scene') continue;
    if (!out.has(e.label)) out.set(e.label, { label: e.label, aliases: e.aliases, palettes: [] });
    out.get(e.label).palettes.push(e.palette);
  }
  return [...out.values()];
}
