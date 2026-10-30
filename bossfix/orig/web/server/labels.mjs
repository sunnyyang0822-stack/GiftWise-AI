/**
 * intake-v1 标签表（JS 侧镜像）。
 *
 * 单一来源是 workflow/labels.py；本文件只是让 web 接入层能用同一份 ID，
 * 不新增、不改名、不翻译。产品面关系枚举是冻结 8 项，colleague 仅技术回归，
 * 不向产品界面暴露（见 docs/intake-contract.md 与 2026-10-30 契约决定）。
 *
 * 一致性证据：web/tools/parity-*.mjs 会实际读取 workflow/labels.py 并逐项比对。
 */

/** 产品面冻结 8 个稳定 ID（界面只出现这 8 项，绝不出现「同事」）。 */
export const PRODUCT_RELATIONS = [
  { id: "partner", zh: "恋人", scene: "恋人之间，可以表达亲密与纪念，但不能承诺对方反应。" },
  { id: "pursuit", zh: "追求对象", scene: "追求关系，不代表对方已接受或存在双向好感；默认低压力表达，不暗示关系已确定。" },
  { id: "friend", zh: "朋友", scene: "朋友之间，按熟悉程度和使用场合选择，避免过度亲密。" },
  { id: "family", zh: "家人", scene: "家人之间，重实用与陪伴感。" },
  { id: "classmate", zh: "同学", scene: "同学之间，重共同经历与实用。" },
  { id: "mentor", zh: "老师/导师", scene: "师生或指导关系，分寸优先，避免私人化过强。" },
  { id: "client_partner", zh: "客户/合作伙伴", scene: "商务往来，得体、通用、不私人化。" },
  { id: "other", zh: "其他", scene: "其他关系；如不确定可如实选择，不做关系推断。" },
];

/** 仅技术回归，不在产品界面、导航、演示、验收中出现。 */
export const REGRESSION_ONLY_RELATIONS = [{ id: "colleague", zh: "同事" }];

/** 服务端 intake 侧完整枚举（含技术回归值与 unknown），`unknown` 提交前必须澄清。 */
export const RELATIONS_FULL = {
  friend: "朋友",
  colleague: "同事",
  partner: "恋人",
  pursuit: "追求对象",
  family: "家人",
  classmate: "同学",
  mentor: "老师/导师",
  client_partner: "客户/合作伙伴",
  other: "其他",
  unknown: "关系暂不确定",
};

export const CLOSENESS = [
  { id: "very_familiar", zh: "非常熟悉" },
  { id: "familiar", zh: "比较熟悉" },
  { id: "limited", zh: "了解不多" },
  { id: "unfamiliar", zh: "几乎不了解" },
  { id: "unknown", zh: "不确定" },
];

export const CLOSENESS_TABLE = Object.fromEntries(CLOSENESS.map((x) => [x.id, x.zh]));

export const OCCASIONS = [
  { id: "birthday", zh: "生日" },
  { id: "festival", zh: "节日" },
  { id: "thanks", zh: "感谢" },
  { id: "anniversary", zh: "纪念日" },
  { id: "graduation_promotion", zh: "毕业/升职祝贺" },
  { id: "other", zh: "其他" },
];

export const OCCASION_TABLE = Object.fromEntries(OCCASIONS.map((x) => [x.id, x.zh]));

export const INTERESTS = [
  { id: "design_art", zh: "设计与艺术" },
  { id: "coffee_food", zh: "咖啡与美食" },
  { id: "reading_learning", zh: "阅读与学习" },
  { id: "tech_digital", zh: "科技与数码" },
  { id: "sports_outdoors", zh: "运动与户外" },
  { id: "music_movies", zh: "音乐与电影" },
  { id: "games_anime", zh: "游戏与动漫" },
  { id: "travel_exploration", zh: "旅行与探索" },
  { id: "home_living", zh: "家居与生活" },
  { id: "plants_nature", zh: "植物与自然" },
  { id: "fashion_accessories", zh: "时尚与配饰" },
  { id: "experiences_activities", zh: "体验与活动" },
];

export const INTEREST_TABLE = Object.fromEntries(INTERESTS.map((x) => [x.id, x.zh]));

export const GIFT_STYLES = [
  { id: "design", zh: "有设计感" },
  { id: "practical", zh: "实用型" },
  { id: "personalized", zh: "个性化定制" },
  { id: "surprising", zh: "有趣且能带来惊喜" },
  { id: "memorable", zh: "有纪念意义" },
  { id: "experiential", zh: "体验型" },
  { id: "understated", zh: "精致但不张扬" },
];

export const GIFT_STYLE_TABLE = Object.fromEntries(GIFT_STYLES.map((x) => [x.id, x.zh]));

export const EXCLUSIONS = [
  { id: "alcohol", zh: "酒类" },
  { id: "food", zh: "食品" },
  { id: "fragrance", zh: "香氛" },
  { id: "jewelry", zh: "珠宝首饰" },
  { id: "plant", zh: "植物" },
  { id: "other", zh: "其他类别" },
];

export const EXCLUSION_TABLE = Object.fromEntries(EXCLUSIONS.map((x) => [x.id, x.zh]));

export const TAGS = new Set(EXCLUSIONS.map((x) => x.id));

/** 界面显示用的「未知/暂时不知道」互斥状态说明（不是机器值）。 */
export const UNKNOWN_INTERESTS_HINT =
  "「暂时不知道」是界面上的互斥状态，不是机器值：选择它时提交 interests: [] 与 interest_confidence: {}，" +
  "不会生成任何用户事实。";
