// 本地界面预览固定配置，无运行时服务端依赖。
export default {
  "contract_version": "giftwise-20261031-v2",
  "mode": "mock",
  "pursuit_contract_ready": true,
  "labels": {
    "relations": [
      {
        "id": "partner",
        "zh": "恋人",
        "scene": "恋人之间，可以表达亲密与纪念，但不能承诺对方反应。"
      },
      {
        "id": "pursuit",
        "zh": "追求对象",
        "scene": "追求关系，不代表对方已接受或存在双向好感；默认低压力表达，不暗示关系已确定。"
      },
      {
        "id": "friend",
        "zh": "朋友",
        "scene": "朋友之间，按熟悉程度和使用场合选择，避免过度亲密。"
      },
      {
        "id": "family",
        "zh": "家人",
        "scene": "家人之间，重实用与陪伴感。"
      },
      {
        "id": "classmate",
        "zh": "同学",
        "scene": "同学之间，重共同经历与实用。"
      },
      {
        "id": "mentor",
        "zh": "老师/导师",
        "scene": "师生或指导关系，分寸优先，避免私人化过强。"
      },
      {
        "id": "client_partner",
        "zh": "客户/合作伙伴",
        "scene": "商务往来，得体、通用、不私人化。"
      },
      {
        "id": "other",
        "zh": "其他",
        "scene": "其他关系；如不确定可如实选择，不做关系推断。"
      }
    ],
    "closeness": [
      {
        "id": "very_familiar",
        "zh": "非常熟悉"
      },
      {
        "id": "familiar",
        "zh": "比较熟悉"
      },
      {
        "id": "limited",
        "zh": "了解不多"
      },
      {
        "id": "unfamiliar",
        "zh": "几乎不了解"
      },
      {
        "id": "unknown",
        "zh": "不确定"
      }
    ],
    "occasions": [
      {
        "id": "birthday",
        "zh": "生日"
      },
      {
        "id": "festival",
        "zh": "节日"
      },
      {
        "id": "thanks",
        "zh": "感谢"
      },
      {
        "id": "anniversary",
        "zh": "纪念日"
      },
      {
        "id": "graduation_promotion",
        "zh": "毕业/升职祝贺"
      },
      {
        "id": "other",
        "zh": "其他"
      }
    ],
    "interests": [
      {
        "id": "design_art",
        "zh": "设计与艺术"
      },
      {
        "id": "coffee_food",
        "zh": "咖啡与美食"
      },
      {
        "id": "reading_learning",
        "zh": "阅读与学习"
      },
      {
        "id": "tech_digital",
        "zh": "科技与数码"
      },
      {
        "id": "sports_outdoors",
        "zh": "运动与户外"
      },
      {
        "id": "music_movies",
        "zh": "音乐与电影"
      },
      {
        "id": "games_anime",
        "zh": "游戏与动漫"
      },
      {
        "id": "travel_exploration",
        "zh": "旅行与探索"
      },
      {
        "id": "home_living",
        "zh": "家居与生活"
      },
      {
        "id": "plants_nature",
        "zh": "植物与自然"
      },
      {
        "id": "fashion_accessories",
        "zh": "时尚与配饰"
      },
      {
        "id": "experiences_activities",
        "zh": "体验与活动"
      }
    ],
    "gift_styles": [
      {
        "id": "design",
        "zh": "有设计感"
      },
      {
        "id": "practical",
        "zh": "实用型"
      },
      {
        "id": "personalized",
        "zh": "个性化定制"
      },
      {
        "id": "surprising",
        "zh": "有趣且能带来惊喜"
      },
      {
        "id": "memorable",
        "zh": "有纪念意义"
      },
      {
        "id": "experiential",
        "zh": "体验型"
      },
      {
        "id": "understated",
        "zh": "精致但不张扬"
      }
    ],
    "exclusions": [
      {
        "id": "alcohol",
        "zh": "酒类"
      },
      {
        "id": "food",
        "zh": "食品"
      },
      {
        "id": "fragrance",
        "zh": "香氛"
      },
      {
        "id": "jewelry",
        "zh": "珠宝首饰"
      },
      {
        "id": "plant",
        "zh": "植物"
      },
      {
        "id": "other",
        "zh": "其他类别"
      }
    ]
  },
  "ranges": {
    "deadline": [
      {
        "days": 1,
        "label": "一天"
      },
      {
        "days": 5,
        "label": "3–5天"
      },
      {
        "days": 7,
        "label": "一周"
      },
      {
        "days": 30,
        "label": "一月"
      },
      {
        "days": 90,
        "label": "一季度"
      },
      {
        "days": 365,
        "label": "一年"
      }
    ]
  },
  "limits": {
    "currency": "CNY",
    "global_repair_limit": 1
  },
  "client_timeout_ms": 20000
};
