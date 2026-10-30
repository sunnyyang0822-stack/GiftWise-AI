"""intake-v1 共享标签；界面与工作流须使用相同 ID，待 PM 审查。"""

# 产品面冻结关系枚举（9 个稳定 ID）：partner 恋人、pursuit 追求对象、friend 朋友、family 家人、
# boss 职场上司、classmate 同学、mentor 老师/导师、client_partner 客户/合作伙伴、other 其他。
# partner 与 pursuit 并列互斥，不得合并，也不得把追求对象落入 other。
# boss（职场上司）覆盖「上司/领导/老板/上级/主管」这一类；只加一个 ID，不加同义词，
# 避免代码分支需要二次消歧。它不代表任何额外流程分支（见 D-6／D-7）。
# colleague（同事）仅技术回归：产品场景已完全移出，界面/导航/演示/验收不得出现；
# 保留该机器值以免破坏 46 项本地探针与 tests/ 的同事回归夹具。
RELATIONS = {"friend": "朋友", "colleague": "同事", "partner": "恋人", "pursuit": "追求对象", "family": "家人", "boss": "职场上司", "classmate": "同学", "mentor": "老师/导师", "client_partner": "客户/合作伙伴", "other": "其他", "unknown": "关系暂不确定"}
CLOSENESS = {"very_familiar": "非常熟悉", "familiar": "比较熟悉", "limited": "了解不多", "unfamiliar": "几乎不了解", "unknown": "不确定"}
OCCASIONS = {"birthday": "生日", "festival": "节日", "thanks": "感谢", "anniversary": "纪念日", "graduation_promotion": "毕业/升职祝贺", "other": "其他", "unknown": "场合暂不确定"}
INTERESTS = {"design_art": "设计与艺术", "coffee_food": "咖啡与美食", "reading_learning": "阅读与学习", "tech_digital": "科技与数码", "sports_outdoors": "运动与户外", "music_movies": "音乐与电影", "games_anime": "游戏与动漫", "travel_exploration": "旅行与探索", "home_living": "家居与生活", "plants_nature": "植物与自然", "fashion_accessories": "时尚与配饰", "experiences_activities": "体验与活动"}
GIFT_STYLES = {"design": "有设计感", "practical": "实用型", "personalized": "个性化定制", "surprising": "有趣且能带来惊喜", "memorable": "有纪念意义", "experiential": "体验型", "understated": "精致但不张扬"}
EXCLUSIONS = {"alcohol": "酒类", "food": "食品", "fragrance": "香氛", "jewelry": "珠宝首饰", "plant": "植物", "other": "其他类别"}
