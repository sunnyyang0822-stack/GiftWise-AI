# Product requirements — proposed MVP

Updated: 2026-10-29 (Asia/Shanghai). Status: specification; implementation and user validation pending.

## Background, user, and scenario

GiftWise AI is an individual hackathon project for the owner-reported UCloud × Shanghai University competition, October 30–November 1, 2026. Official technical requirements and submission cutoff still require confirmation.

Target user: someone choosing a birthday gift for a friendly colleague they do not know particularly well. The user lacks inspiration, fears an inappropriate gift, and needs a decision within budget and time limits. These pain points are product hypotheses, not interview findings.

Example fictional request: colleague birthday, CNY 200 maximum total, two days preparation, known interest in coffee, no alcohol. The tool must not infer that a coffee interest proves a particular taste or that an item is available locally.

## Inputs

The authoritative proposed contract is in [workflow-spec](../workflow/workflow-spec.md).

| Field | Requirement | Meaning |
| --- | --- | --- |
| recipient_relation | Required nonempty string | Relationship, without real names |
| occasion | Required nonempty string | Birthday in the first scenario |
| budget_amount | Required decimal string | Maximum total, including declared extras |
| currency | Required; MVP CNY only | No implicit conversion |
| available_days | Required nonnegative integer | Available preparation duration, not a delivery promise |
| facts | Array; may be empty | User facts with stable IDs; interests optional |
| forbidden_tags | Array; may be empty | Explicit confirmed categories, e.g. alcohol |
| forbidden_terms | Array; may be empty | Explicit literal restrictions for transparent text matching |
| notes | Optional string | Additional context; cannot silently override hard constraints |

Unprovided required constraints cause a needs-input result; never invent budget, deadline, or a prohibition. Unknown preferences may remain unknown. Free-text restrictions that cannot be mapped reliably need user confirmation rather than a universal compliance claim.

## Output

A report includes a status (`passed`, `failed`, `needs_input`, or `error`), three candidates if generation succeeded, per-candidate validation, and zero or one repair attempt. Each candidate includes a description, all-in estimated cost and currency, estimated preparation days, restriction tags, recommendation reason, references to user facts, inferences, unknowns, and an optional presentation suggestion. Keep the original and repaired candidates and validation results in the run record.

The final selection may use only candidates with a passing rule result. If none passes, say no compliant recommendation is available. If some fail after repair, expose their failures; do not label the overall run passed. Relationship suitability is a subjective risk note, not an objective check. Business-data verification remains `not_verified`.

## Priorities

P0 acceptance:

1. Accept structured user constraints and preserve original facts.
2. Generate exactly three distinct ideas in the agreed schema.
3. Separate facts, inferences, and unknowns.
4. Execute independent code checks for required fields, budget, currency, explicit restrictions, preparation time, and fact references.
5. Route failing candidates through at most one model repair and run the same validator again; preserve valid candidates.
6. Return an honest report on success, partial availability, invalid input, and persistent failure.
7. Execute and record at least the eight specified reproducible scenarios, including live repair traces for end-to-end claims.

P1, after the closed loop works: optional packaging / color / card copy; API timeouts; structured redacted logs; cost and latency measurement; FastAPI + Docker + UCloud if needed. Organizer-mandated deployment is promoted to P0 once confirmed.

Out of scope: accounts, payments, shopping or inventory integration, real-time delivery claims, long-term memory, multiple agents, databases, Kubernetes unless mandatory, and a bespoke polished frontend.

## MVP definition of done

The actual Dify workflow runs against a configured provider; rule results come from executed code; at most one repair occurs; all eight scenarios have expected and observed results; a revision-stable workflow export has been sanitized and import-tested before any importability claim; setup documentation and a four-minute demonstration reflect reality. Public source and known limitations accompany the result. Cloud deployment is required only if confirmed by rules or chosen as a committed deliverable.

## Unvalidated assumptions and decisions

- Users value traceable constraints more than a generic list of gifts.
- Three ideas and one repair provide sufficient choice within tolerable latency.
- User-entered category tags can represent the important explicit restrictions.
- Estimated costs and preparation times are useful without merchant integration.
- Current Dify sandbox can run the selected standard-library code; verify before integration.
- Organizer rules permit this architecture, model source, and hosting arrangement.

The owner confirms product direction and experiences; Codex implements a bounded task and reports real results; PM checks evidence before marking work complete.
