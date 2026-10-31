/**
 * 第 3–4 步（包装风格 + 色彩/视觉方向）用的**受控词表**。
 *
 * 为什么要有词表：产品负责人 2026-10-31 追加的硬要求是
 *   「用户说喜欢黑白色调 ⇒ 第 4 步必须出黑白；用户说不喜欢 X ⇒ 输出绝对不含 X」。
 * 要做到**可断言**，就不能靠模型自由发挥：必须先有一份受控的
 * 「概念 → 具体主色/辅色/质感/视觉基调」映射表，再由模型只做措辞润色。
 *
 * 这里的每个概念都有稳定的机器 id（`kind:id`），颜色带 hex。
 * 任何产物（structured 方向、第 5 步生图 prompt）都只从本表取值，
 * 不从模型自由文本取值，因此「不得凭空生成」这条是可以被代码保证的。
 *
 * ⚠️ 词表只覆盖**视觉/包装**相关概念（颜色、风格、材质、质感）。
 * 礼物本体类别（酒类、食品等）不在这里，它们走 checker 既有的
 * forbidden_tags / forbidden_terms 通道，本模块不重复实现。
 */

/** 允许出现在最终输出里的颜色（`kind: 'color'`）。hex 用于结构化交接与生图 prompt。 */
export const COLOR_CONCEPTS = Object.freeze([
  {
    id: 'color:monochrome',
    zh: '黑白（无彩色）',
    hex: '#111111',
    aliases: ['黑白', '单色', '无彩色', '灰阶', '黑白调', 'monochrome', '黑白灰'],
    slots: { primary: { zh: '墨黑', hex: '#111111' }, secondary: [{ zh: '暖白', hex: '#F2F2F0' }, { zh: '中灰', hex: '#8A8A8A' }] },
  },
  {
    id: 'color:black',
    zh: '黑色',
    hex: '#111111',
    aliases: ['黑色', '纯黑', '酷黑'],
    slots: { primary: { zh: '墨黑', hex: '#111111' }, secondary: [{ zh: '中灰', hex: '#8A8A8A' }] },
  },
  {
    id: 'color:white',
    zh: '白色',
    hex: '#FFFFFF',
    aliases: ['白色', '纯白', '雪白'],
    slots: { primary: { zh: '纯白', hex: '#FFFFFF' }, secondary: [{ zh: '浅灰', hex: '#D9D9D6' }] },
  },
  {
    id: 'color:gray',
    zh: '灰色',
    hex: '#8A8A8A',
    aliases: ['灰色', '烟灰', '雾灰'],
    slots: { primary: { zh: '雾灰', hex: '#8A8A8A' }, secondary: [{ zh: '暖白', hex: '#F2F2F0' }] },
  },
  {
    id: 'color:cream',
    zh: '米色',
    hex: '#E8DCC8',
    aliases: ['米色', '米白', '奶油色', '暖米', '燕麦色'],
    slots: { primary: { zh: '暖米色', hex: '#E8DCC8' }, secondary: [{ zh: '浅棕', hex: '#B99C7A' }] },
  },
  {
    id: 'color:brown',
    zh: '棕色',
    hex: '#8B5E3C',
    aliases: ['棕色', '咖色', '咖啡色', '焦糖色'],
    slots: { primary: { zh: '咖啡棕', hex: '#8B5E3C' }, secondary: [{ zh: '奶油色', hex: '#EFE3D0' }] },
  },
  {
    id: 'color:blue',
    zh: '蓝色',
    hex: '#3C5A80',
    aliases: ['蓝色', '雾霾蓝', '藏青', '牛仔蓝'],
    slots: { primary: { zh: '雾霾蓝', hex: '#6B85A8' }, secondary: [{ zh: '浅灰蓝', hex: '#C9D4E0' }] },
  },
  {
    id: 'color:green',
    zh: '绿色',
    hex: '#4F6B4A',
    aliases: ['绿色', '墨绿', '森系绿', '苔藓绿'],
    slots: { primary: { zh: '墨绿', hex: '#4F6B4A' }, secondary: [{ zh: '米白', hex: '#F0EDE4' }] },
  },
  {
    id: 'color:red',
    zh: '红色',
    hex: '#B23A34',
    aliases: ['红色', '正红', '砖红'],
    slots: { primary: { zh: '砖红', hex: '#B23A34' }, secondary: [{ zh: '暖白', hex: '#F5EFE6' }] },
  },
  {
    id: 'color:wine_red',
    zh: '酒红',
    hex: '#6E2136',
    aliases: ['酒红', '勃艮第红'],
    slots: { primary: { zh: '酒红', hex: '#6E2136' }, secondary: [{ zh: '象牙白', hex: '#F3EFE7' }] },
  },
  {
    id: 'color:pink',
    zh: '粉色',
    hex: '#E4A9B4',
    aliases: ['粉色', '藕粉', '樱花粉'],
    slots: { primary: { zh: '藕粉', hex: '#E4A9B4' }, secondary: [{ zh: '米白', hex: '#F6F0EA' }] },
  },
  {
    id: 'color:purple',
    zh: '紫色',
    hex: '#6B5B95',
    aliases: ['紫色', '雾紫'],
    slots: { primary: { zh: '雾紫', hex: '#8A7FA8' }, secondary: [{ zh: '浅灰', hex: '#DAD7DE' }] },
  },
  {
    id: 'color:yellow',
    zh: '黄色',
    hex: '#D9A93C',
    aliases: ['黄色', '芥末黄'],
    slots: { primary: { zh: '芥末黄', hex: '#D9A93C' }, secondary: [{ zh: '米白', hex: '#F4EFE3' }] },
  },
  {
    id: 'color:orange',
    zh: '橙色',
    hex: '#D2763C',
    aliases: ['橙色', '橘色', '珊瑚橙'],
    slots: { primary: { zh: '珊瑚橙', hex: '#D2763C' }, secondary: [{ zh: '奶油色', hex: '#F3E7D8' }] },
  },
  {
    id: 'color:gold',
    zh: '金色',
    hex: '#B99A5B',
    aliases: ['金色', '金箔', '香槟金'],
    slots: { primary: { zh: '香槟金', hex: '#C7A96B' }, secondary: [{ zh: '哑光黑', hex: '#141414' }] },
  },
  {
    id: 'color:silver',
    zh: '银色',
    hex: '#C0C0C0',
    aliases: ['银色', '银灰'],
    slots: { primary: { zh: '银灰', hex: '#C0C0C0' }, secondary: [{ zh: '深灰', hex: '#5A5A5A' }] },
  },
  {
    id: 'color:colorful',
    zh: '彩色',
    hex: '#D97B4A',
    aliases: ['彩色', '多色', '缤纷', '彩虹色'],
    slots: { primary: { zh: '暖橙', hex: '#D97B4A' }, secondary: [{ zh: '湖蓝', hex: '#5B9AA9' }, { zh: '草绿', hex: '#7FA05A' }] },
  },
  {
    id: 'color:fluorescent',
    zh: '高饱和亮色',
    hex: '#E8482F',
    aliases: ['荧光', '高饱和', '亮色', '糖果色'],
    slots: { primary: { zh: '高饱和橘红', hex: '#E8482F' }, secondary: [{ zh: '亮黄', hex: '#F2C744' }] },
  },
]);

/** 风格 / 视觉基调概念（`kind: 'tone'`）。 */
export const TONE_CONCEPTS = Object.freeze([
  {
    id: 'tone:minimal',
    zh: '极简克制',
    aliases: ['极简', '简约', '简洁', '冷淡', '性冷淡', 'less is more'],
    tone: { id: 'minimal', zh: '极简、留白充足、装饰极少，靠材质与比例取胜' },
  },
  {
    id: 'tone:ornate',
    zh: '繁复华丽',
    aliases: ['花哨', '繁复', '华丽', '复杂', '夸张', '堆饰'],
    tone: { id: 'ornate', zh: '层次丰富、装饰密度高、视觉信息量大' },
  },
  {
    id: 'tone:cute',
    zh: '可爱',
    aliases: ['可爱', '萌', '卡哇伊'],
    tone: { id: 'cute', zh: '圆润造型、轻快表情符号、软化边缘' },
  },
  {
    id: 'tone:retro',
    zh: '复古',
    aliases: ['复古', '怀旧', 'vintage'],
    tone: { id: 'retro', zh: '低饱和暖调、复古印刷质感、老式字体气质' },
  },
  {
    id: 'tone:natural',
    zh: '自然',
    aliases: ['自然', '森系', '原木', '植物感', '清新'],
    tone: { id: 'natural', zh: '自然材质、柔和光线、有机形态，不刻意对称' },
  },
  {
    id: 'tone:luxury',
    zh: '奢华高级',
    aliases: ['奢华', '高级感', '贵气', '轻奢'],
    tone: { id: 'luxury', zh: '深色底、金属点缀、厚重材质、低冗余装饰' },
  },
  {
    id: 'tone:industrial',
    zh: '工业感',
    aliases: ['工业风', '金属感', '硬朗'],
    tone: { id: 'industrial', zh: '哑光金属、直线构成、冷调灰度' },
  },
  {
    id: 'tone:handmade',
    zh: '手工感',
    aliases: ['手工', '手作', 'diy', '亲手'],
    tone: { id: 'handmade', zh: '可见手工痕迹、纸绳与胶带质感、略有不对称' },
  },
  {
    id: 'tone:warm',
    zh: '暖调',
    aliases: ['暖色', '暖调', '暖色系', '温暖'],
    tone: { id: 'warm', zh: '暖色温、低对比、柔和过渡' },
  },
  {
    id: 'tone:cool',
    zh: '冷调',
    aliases: ['冷色', '冷调', '冷色系', '冷感'],
    tone: { id: 'cool', zh: '冷色温、干净利落、光影分明' },
  },
]);

/** 材质 / 质感概念（`kind: 'material'`）。 */
export const MATERIAL_CONCEPTS = Object.freeze([
  { id: 'material:matte', zh: '哑光', aliases: ['哑光', '磨砂', '无光泽', '雾面'], material: '哑光质感表面（不反光）' },
  { id: 'material:glossy', zh: '亮面', aliases: ['亮面', '光面', '光泽', '镜面'], material: '亮面质感表面（有反光）' },
  { id: 'material:paper', zh: '纸质', aliases: ['纸质', '卡纸', '纸盒'], material: '厚卡纸（可回收，素面）' },
  { id: 'material:kraft', zh: '牛皮纸', aliases: ['牛皮纸', '牛卡'], material: '牛皮纸（原色，未漂白）' },
  { id: 'material:linen', zh: '亚麻棉麻', aliases: ['亚麻', '麻布', '棉麻', '棉布'], material: '亚麻/棉麻织物（织物纹理）' },
  { id: 'material:wood', zh: '木质', aliases: ['木质', '木头', '原木', '木盒'], material: '原木（浅色木纹）' },
  { id: 'material:metal', zh: '金属', aliases: ['金属', '黄铜', '铝'], material: '哑光金属件（小面积点缀）' },
  { id: 'material:leather', zh: '皮革', aliases: ['皮革', '皮质', 'pu'], material: '皮革/仿皮（细纹）' },
  { id: 'material:fabric', zh: '布艺', aliases: ['布艺', '绒布', '绸带', '丝带'], material: '布艺缎带（宽幅、低光泽）' },
]);

/** 全部概念，按 颜色 → 风格 → 材质 顺序排列（同序用于匹配优先级）。 */
export const ALL_CONCEPTS = Object.freeze([...COLOR_CONCEPTS, ...TONE_CONCEPTS, ...MATERIAL_CONCEPTS]);

const CONCEPT_BY_ID = new Map(ALL_CONCEPTS.map((c) => [c.id, c]));

export function conceptById(id) {
  return CONCEPT_BY_ID.get(id) ?? null;
}

export function kindOf(id) {
  return typeof id === 'string' && id.includes(':') ? id.slice(0, id.indexOf(':')) : null;
}

/**
 * 否定语境：出现在概念词**之前**这些词中的一个，即视为「禁止」。
 * 顺序敏感（先判否定），因此词表匹配必须在否定扫描之后。
 */
export const NEGATION_MARKERS = Object.freeze([
  '不喜欢', '不喜', '讨厌', '不要', '不能', '避免', '别用', '别要', '别买', '忌讳', '反感', '拒绝', '排除', '禁',
]);

/**
 * 在自由文本里找出所有概念命中。
 * @returns {Array<{concept: object, alias: string, index: number, negated: boolean}>}
 */
export function matchConcepts(text) {
  const source = typeof text === 'string' ? text.toLowerCase() : '';
  if (!source) return [];
  const hits = [];
  for (const concept of ALL_CONCEPTS) {
    for (const alias of concept.aliases) {
      const needle = alias.toLowerCase();
      let from = 0;
      for (;;) {
        const index = source.indexOf(needle, from);
        if (index === -1) break;
        // 否定判定只看命中位置**之前** 6 个字符（中文语境足够覆盖「不喜欢红色」）。
        const window = source.slice(Math.max(0, index - 6), index);
        const negated = NEGATION_MARKERS.some((marker) => window.includes(marker.toLowerCase()));
        hits.push({ concept, alias, index, negated });
        from = index + needle.length;
      }
    }
  }
  // 去掉被更长别名覆盖的重复命中：同一段文本里若「黑白」命中，就不再单独算「黑」。
  // 词表里没有裸「黑」别名，因此这里只需按位置去重。
  const seen = new Set();
  return hits
    .sort((a, b) => (a.index - b.index) || (b.alias.length - a.alias.length))
    .filter((hit) => {
      const key = `${hit.concept.id}@${hit.index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** 该概念是否属于「颜色」以外的可禁用类别（用于判断禁项是否影响配色）。 */
export const VISUAL_KINDS = Object.freeze(['color', 'tone', 'material']);
