> 发布副本：历史 PR#117，受审代码 `cacfe958aa8dbf6fcdda51c6bc8754d503291067`。独立 Agent 复核，非另一位人类账户批准；不是最终 eceef056 的新增执行证据。历史服务/合并状态和已被后续改动替代的说明不代表当前状态。原文SHA256与发布SHA256见 publication-manifest.json。

# PR117 final independent review and PR115 sections pairing

Issue114 / https://github.com/sunnyyang0822-stack/GiftWise-AI/pull/117
Final `cacfe958aa8dbf6fcdda51c6bc8754d503291067`, base `008415e09d1c5203d7bf7bbed54c2382c4cac1f1`.
Paired ready frontend PR115 `dd51324a67832991c11cb76d3d039d35656a3128`.

Conclusion: no blocking finding identified. Independent Agent review, not another human account approval. No business edits, merge/deploy/issue closure or frozen-service operation.

## Code and validation boundary

Full10-file diff reviewed; final source snapshots match the developer files after CRLF normalization. No public/frontend, retrieval/collection/server endpoint or media provider/store/Seedream changes. Recommendation code before presentation mapping is unchanged.

The v2 presentation still requires its exact root structure, nonempty style/card_text, packaging object with nonempty color_palette, giving_advice structure, unknowns, currency and preparation-days fields. Optional materials/steps/description may be absent or empty arrays only where their type permits. Provided blank description, blank/nontext items, wrong types and unrecognized packaging/root fields remain rejected before mapping. A nonempty single-sided material/step list without description still fails. A valid explanatory description may serve the already-existing alternative to paired materials+steps; this is not unrestricted acceptance of malformed partial data. Frozen candidate/request validation, CNY, known budget and forbidden-term recursive checks remain intact. Time advisory behavior is unchanged.

The only relaxed condition permits no optional packaging content. The shared packagingSections helper returns no packaging section if there is no actual description/material/step text. Actual instructions produce ②包装材料与步骤; description-only produces ②包装说明. It preserves text, does not infer gift type, and is used by both pipeline and local rendering. No fixed empty/default packaging or substitute 呈现说明 chapter is produced. Current v2 local fallback uses color only, removing invented generic packaging description and unsolicited default decoration text. Legacy non-v2 local behavior is unchanged; the reviewed product contract is v2.

Prompt changes delegate physical delivery/packaging need to the model using selected candidate, original request and context. Pure experience omits optional packaging and puts useful invitation/arrangement into existing giving_advice. Physical and mixed invitations can retain real material/instruction or description-only content. There is no new gift_type/root field or algorithmic keyword routing. Same gift name can have differing controlled outputs based on context.

Image plan v7 replaces the required gift-object/packaging-subject wording with actual delivery form/context/atmosphere, and explicitly avoids inventing boxes/tickets/cards without physical delivery. It preserves the same selected candidate, actual presentation/advice and user/exclusion context. Form remains undetermined without evidence. AI type, text-free default, watermark choice, reference authorization, task owner identity and supplier/image-generation protocol are not changed. Existing pending/ready/failed/missing old-plan task reuse is covered by reused tests; changing the plan version does not itself re-generate or overwrite old assets. No real image/model adherence is claimed.

## PR115 final sections pairing — static and saved-output check only

No changed-file overlap relative to the shared008 base. Inspected six actual controlled output JSON records saved in the final log, not just hand-written frontend fixtures:

- Pure experience and unknown-city/date case: style/card/giving only; no packaging or renamed replacement. PR115 extracts the nonempty greeting card, renders two real guide steps in server order and lists only these actual titles in the summary.
- Physical, mixed invitation and concert-themed physical card: style/packaging/card/giving; actual material and numbered step strings preserved. PR115 renders three guide steps plus greeting, without fixed step count.
- Physical description-only: same keys, packaging title ②包装说明 and original description retained. PR115's existing prefix cleanup renders 包装说明 and keeps the text; it does not delete packaging by key or gift name.

Backend titles include circled numeric prefixes already supported by PR115 cleanTitle; card title includes 贺卡 and uses the unchanged greeting extraction. All items are actual strings accepted by the filtered sections renderer. Media task polling replaces only its slot and no API shape changes are introduced. This is a pairing of final source plus recorded controlled outputs, not a newly executed combined frontend/backend browser test.

## Reused verification and original failures

Evidence root `E:\黑客松\.worktrees\experience-presentation-a\.tmp`:

- experience-first.log: original new10/10. These10 are included in final35, not additional45.
- experience-affected-final.log:35/35,0fail/skip/cancel; explicit test-process EXIT_CODE=0. Command from validation-commands.txt: node --require ./.tmp/no-listen.cjs --test --test-skip-pattern=HTTP plus experience, packaging-content, image-finesse, backend-async files. Includes6 controlled section output records and negatives, same-name/different-context, local v2 omission, semantic prompt context and old image task cases. All model/supplier behavior is injected, not true paid providers.
- no-listen.cjs rejects net.Server.listen; filter-probe.log first proves explicit HTTP exclusion using a canary that would throw if executed. No server was started by the final run. Reviewer did not rerun these tests, HTTP or browser.
- experience-affected-first.log remains29/27pass/2fail: one stale exact prompt wording assertion, one incorrectly included HTTP case attempting127.0.0.1:8787 and failing EADDRINUSE. The enclosing shell block ended with Get-Content and returned0; original test subprocess exit was not independently captured. That block is not a passing test run. Its raw error is preserved, the occupied process was not stopped, and this was already disclosed to PM. The final corrected35 is kept separate, not a rewritten first run.
- Test changes retain concrete failure assertions and strengthen optional-content cases rather than disabling shape/budget/currency/exclusion checks. The image plan version assertion updates to v7 while old-task reuse checks remain.
- Reviewer incremental git diff --check passed. Source/evidence hashes and extracted controlled outputs are in source-evidence-audit.json. No replay, additional scenario test or real network/model/image/collection was needed beyond supplied evidence.

## Limits and product scope

True model compliance with pure-experience semantics and actual v7 image aesthetics remain unverified. No fresh combined full recommend→presentation flow or browser viewport/decoding was executed; PR115's10-case evidence is reused only for the final sections compatibility check. Static conditions intentionally do not classify experience/physical content or remove a valid nonempty description because of a word in the name.

Latest PM product update requires actual online gift/material information to inform C112's future recommendation generation and makes images optional. This PR is selected-guide scope and neither adds a three-image/SKU gate nor validates the still-developing C112 grounding/performance route. No C112 intermediate review or old three-image evidence rerun occurred.

No services, auth/login/profile or prohibited ports/PIDs touched;8912@008/PID42224 remains frozen, PR111/main untouched. Current reviewer tracked worktree clean. Original363/349 pass/12 fail/2 skip evidence remains frozen; controlled35/35 does not prove full-suite green or deployment/user acceptance. Merging, new preview and subsequent user walk-through/main merge remain PM actions.
