/**
 * 沙箱证明（JS 侧）——只读生产文件，不修改 web/** 与任何生产文件。
 *
 * 证明内容：
 *  W1 原版 web/server/labels.mjs 的 PRODUCT_RELATIONS 实际内容（8 项）
 *  W2 变体 bossfix/variant/labels.mjs 的 PRODUCT_RELATIONS 实际内容（9 项）
 *  W3 逐字重放 web/tests/access-layer.test.mjs:32 与 34-36 的断言，对原版／变体各求值一次
 *  W4 关系分流的下游分支：把 recipient_relation_id="boss" 与 "other" 分别喂给
 *     生产 web/server/mock-model.mjs 的 buildMockPresentation()，比较呈现结果。
 *     用来回答「加一个枚举值会不会让『职场分寸』分支生效」。
 *
 * 用法： node bossfix/prove_web.mjs        （输出一行 JSON 到 stdout）
 */

import { PRODUCT_RELATIONS as ORIG_PRODUCT, RELATIONS_FULL as ORIG_FULL } from "../web/server/labels.mjs";
import { PRODUCT_RELATIONS as VAR_PRODUCT, RELATIONS_FULL as VAR_FULL } from "./variant/labels.mjs";
import { buildMockPresentation } from "../web/server/mock-model.mjs";

/** 逐字重放 web/tests/access-layer.test.mjs:32–36 的断言，返回每条的真实结果。 */
function replayAccessLayerAssertions(product, full) {
  const results = [];
  const expectedIds = ["partner", "pursuit", "friend", "family", "classmate", "mentor", "client_partner", "other"];

  // access-layer.test.mjs:32  assert.equal(PRODUCT_RELATIONS.length, 8);
  results.push({
    file: "web/tests/access-layer.test.mjs",
    line: 32,
    source: "assert.equal(PRODUCT_RELATIONS.length, 8);",
    expected: 8,
    actual: product.length,
    pass: product.length === 8,
  });

  // access-layer.test.mjs:34-36  assert.deepEqual(PRODUCT_RELATIONS.map(x=>x.id), [...8 个...]);
  const actualIds = product.map((x) => x.id);
  results.push({
    file: "web/tests/access-layer.test.mjs",
    line: 34,
    source: 'assert.deepEqual(PRODUCT_RELATIONS.map((x) => x.id), ["partner","pursuit","friend","family","classmate","mentor","client_partner","other"]);',
    expected: expectedIds,
    actual: actualIds,
    pass: JSON.stringify(actualIds) === JSON.stringify(expectedIds),
  });

  // access-layer.test.mjs:37  assert.ok(!PRODUCT_RELATIONS.some((x) => x.id === "colleague" || x.zh === "同事"));
  const hasColleague = product.some((x) => x.id === "colleague" || x.zh === "同事");
  results.push({
    file: "web/tests/access-layer.test.mjs",
    line: 37,
    source: 'assert.ok(!PRODUCT_RELATIONS.some((x) => x.id === "colleague" || x.zh === "同事"));',
    expected: false,
    actual: hasColleague,
    pass: hasColleague === false,
  });

  return { results, ids: actualIds, productCount: product.length, fullCount: Object.keys(full).length };
}

/** 用生产 mock 模型分别渲染 boss / other / pursuit 的呈现，看关系分流是否真的换挡。 */
function presentationFor(relationId) {
  const request = {
    recipient_relation_id: relationId,
    closeness: "familiar",
    budget_amount: "200.00",
    currency: "CNY",
  };
  const candidate = {
    id: "c1",
    estimated_total: "150.00",
    currency: "CNY",
    estimated_preparation_days: 1,
  };
  const built = buildMockPresentation(request, candidate, {});
  return built.presentation_json;
}

const orig = replayAccessLayerAssertions(ORIG_PRODUCT, ORIG_FULL);
const variant = replayAccessLayerAssertions(VAR_PRODUCT, VAR_FULL);

const bossPres = presentationFor("boss");
const otherPres = presentationFor("other");
const pursuitPres = presentationFor("pursuit");

const bossParsed = JSON.parse(bossPres);

const payload = {
  w1_original_product_relations: {
    count: orig.productCount,
    ids: orig.ids,
    relations_full_count: orig.fullCount,
  },
  w2_variant_product_relations: {
    count: variant.productCount,
    ids: variant.ids,
    relations_full_count: variant.fullCount,
    boss_zh: (VAR_PRODUCT.find((x) => x.id === "boss") || {}).zh || null,
  },
  w3_access_layer_assertions: {
    note: "对原版 labels.mjs 与变体 labels.mjs 各重放一次；pass=false 即该断言会被新值打破",
    original: orig.results,
    variant: variant.results,
  },
  w4_relation_branching: {
    note: "mock-model.mjs 的 relationFlavor() 有 pursuit/partner/friend/family/classmate/mentor/client_partner/other 共 8 个键，没有 boss 键",
    boss_equals_other_presentation: bossPres === otherPres,
    boss_differs_from_pursuit: bossPres !== pursuitPres,
    boss_card_text: bossParsed.card_text,
    boss_relationship_cautions: bossParsed.giving_advice.relationship_cautions,
    conclusion: bossPres === otherPres
      ? "boss 落入 other 的中性话术：除 intake 白名单外，没有任何『职场分寸』专属分支生效"
      : "boss 有独立话术",
  },
};

process.stdout.write(JSON.stringify(payload) + "\n");
