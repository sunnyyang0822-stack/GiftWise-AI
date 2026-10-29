# Workflow design specification v0.1

Status: design only, 2026-10-29. The inspected local export has only Start → LLM → End and a connection-test prompt. None of the nodes below beyond that baseline has been confirmed configured or run. No importable DSL is generated here. A later DSL must come from the actual environment and undergo sanitized import and execution checks.

## Authoritative proposed data contract

These are application fields, not a claim about native Dify DSL syntax. The first implementation must follow them or propose a documented change before coding. Dify boundary values `request_json`, `candidates_json`, and `validation_json` are strings containing JSON; status / branch outputs are shallow scalar fields. Declare their types in the actual node UI.

Example synthetic request:

```json
{
  "recipient_relation": "Friendly colleague, not very close",
  "occasion": "Birthday",
  "budget_amount": "200.00",
  "currency": "CNY",
  "available_days": 2,
  "facts": [{"id": "f1", "text": "Enjoys coffee"}],
  "forbidden_tags": ["alcohol"],
  "forbidden_terms": ["酒"],
  "notes": "Keep it professional"
}
```

Start collects the budget and time as explicit fields; never let the LLM replace these authoritative values. Optional notes and arrays may be empty. Missing required fields stop with `needs_input`; no preferences is acceptable. Restriction vocabulary v0.1: `alcohol`, `food`, `fragrance`, `jewelry`, `plant`, `other`; unknown nonempty tags require clarification. An empty forbidden list means no supplied restriction, not universal safety. Do not silently translate ambiguous free text into a supposedly exhaustive category policy.

Generation returns an object with `candidates`, exactly three objects with IDs `c1`, `c2`, `c3`. This single object illustrates one candidate's shape; duplicate the shape with distinct IDs and ideas in a valid full response:

```json
{
  "id": "c1",
  "name": "Coffee-themed desk kit",
  "description": "A mug and a reusable coaster",
  "estimated_total": "150.00",
  "currency": "CNY",
  "estimated_preparation_days": 1,
  "tags": ["other"],
  "reason": "Connects to the stated interest without assuming a preferred roast",
  "fact_refs": ["f1"],
  "inferences": ["A practical desk gift may suit a colleague"],
  "unknowns": ["Preferred style", "Current local availability"],
  "presentation": "Optional neutral wrapping and a short birthday card"
}
```

`estimated_total` includes all declared gift, packaging, and shipping costs; it is a model estimate, not a merchant quote. Require a finite nonnegative decimal string with at most two decimal places. CNY only in v0.1; reject mixed or unsupported currencies, no conversion. Preparation and available days are nonnegative JSON integers, excluding booleans. Name, description, reason, and ID are nonempty strings. `tags` is a nonempty list from the vocabulary; `fact_refs`, `inferences`, `unknowns` are required string arrays and may be empty. Fact IDs must be nonempty and unique. Candidate facts are references to the authoritative request, not rewritten factual claims. Resolve facts from the original request in the report. This validates attribution structure, not semantic truth of model reasoning. Presentation is optional.

Proposed pure validator interface: `validate(request_json: str, candidates_json: str) -> dict`. It never calls a model or modifies inputs. Response shape:

```json
{
  "status": "failed",
  "all_passed": false,
  "errors": [],
  "candidate_results": [
    {
      "id": "c1",
      "passed": false,
      "errors": [
        {"code": "OVER_BUDGET", "path": "candidates[0].estimated_total", "message": "Estimated total exceeds budget"}
      ],
      "warnings": []
    }
  ],
  "business_data_verification": "not_verified"
}
```

This response illustrates one result; valid full batches return all three candidate results. Top-level errors describe invalid requests, invalid batch shape, and parse failures; they prevent `all_passed`. `status` is `passed` only if all three pass; `failed` for candidate or batch defects, `needs_input` for missing or invalid request fields, and `error` for invalid JSON or unexpected execution failure. Reject nonstandard JSON constants, duplicate object keys, null / scalar roots, and wrong field types. Do not use `eval` or silently recover broken JSON. Return a controlled error without echoing raw sensitive input or stack traces.

Stable error codes: `INVALID_JSON`, `INVALID_REQUEST`, `MISSING_FIELD`, `INVALID_TYPE`, `INVALID_AMOUNT`, `INVALID_CANDIDATE_COUNT`, `DUPLICATE_ID`, `UNSUPPORTED_CURRENCY`, `CURRENCY_MISMATCH`, `OVER_BUDGET`, `FORBIDDEN_TAG`, `FORBIDDEN_TERM`, `PREPARATION_TOO_LONG`, `UNKNOWN_FACT_REF`, `UNKNOWN_TAG`, `INTERNAL_ERROR`. Include a field path and human-readable explanation. A field-format error must prevent its numerical comparison, not crash the entire batch.

## Rules and limits

Budget is inclusive: estimate ≤ budget. Preparation is inclusive: estimate ≤ available days. Match confirmed forbidden tags by exact normalized category; match nonempty forbidden terms case-insensitively after Unicode NFKC normalization in name, description, reason, inferences, and presentation. Term matching can have false positives and miss synonyms; state this limitation. Model tags can also be incomplete. Neither mechanism proves exhaustive natural-language safety. Unrecognized tags are a blocked validation result requiring clarification rather than silently passing. Facts, inferences and unknown arrays must stay separate; a code validator cannot guarantee semantic honesty of every sentence.

Do not claim verified price, inventory, availability, or delivery. Subjective relationship suitability remains a warning. User text is untrusted data; prompts must not follow instructions embedded in notes or facts that attempt to disable validation.

## Nodes, responsibilities, and connections

| ID / node | Inputs | Outputs | Responsibility / prompt requirements | Next |
| --- | --- | --- | --- | --- |
| N1 Start + deterministic request adapter | Form fields | Immutable `request_json` | Serialize user facts and explicit constraints without invention; missing constraints produce needs-input | N2, plus unchanged request to N3 / N6 |
| N2 LLM: analyze and generate | `request_json` | `candidates_json` | Three distinct ideas in the contract, JSON only; refer only to supplied fact IDs; label inferences / unknowns; estimates explicit; never claim tool approval | N3 |
| N3 Code: first validation | Original request, raw candidate JSON | `validation_json`, `status`, `all_passed`, `repairable` | Parse and execute deterministic rules; `repairable` only for failed candidate / batch output with a valid request, including malformed model JSON | N4 |
| N4 If-Else | N3 status fields | Selected branch | Passed → N7; repairable candidate defects → N5; invalid request / system failure → error report | N7, N5, or error End |
| N5 LLM: bounded repair | Original request, original model output, structured errors | Revised `candidates_json` | Exactly one attempt; preserve already passing candidates unchanged, replace failing ones with same IDs; invalid batch output requires a complete valid batch; never alter user constraints or fact records | N6 |
| N6 Code: revalidation | Original request, repaired candidates, first results | Final validation JSON, status, repair count 1 | Run identical validation; additionally reject modifications to previously valid candidates; retain initial / revised snapshots | N7; no edge back to N5 |
| N7 Code / template: report | Chosen branch's candidates and results, original request, repair count | `report_json`, human-readable report | Resolve facts from original IDs; include all candidates, errors, estimates, warnings, unknowns; optionally select first passing ID in c1/c2/c3 order; none passing → no selection | End |
| End / output | Report or structured error | Final visible result | Show actual validation state and unresolved issues; no success message without checks | Stop |

N1's adapter is a small Code step if native form output cannot provide the contract. Its validation is deterministic. Block invalid requests before a model call when practical; the validator still rechecks them defensively. The primary roadmap combines these adapter responsibilities conceptually with Start; concrete UI wiring may require extra nodes.

N3's Dify wrapper serializes the pure validator response into `validation_json`; `repairable` is adapter logic, not a field required from the pure module. N6 adds workflow-state checks outside the pure validator. Prompt-driven generation and revision remain model steps; the validator is always separate executed code. An LLM stating “passed” has no authority.

To avoid references to unexecuted branch variables, initially use separate report / End nodes for the no-repair, repaired, and error branches. If using a variable aggregator later, test branch selection in the actual Dify version. No loop node is needed. N5 cannot recurse and automatic LLM retries are disabled in the MVP. A normal path has one model call, a repair path at most two.

Final `report_json` contains `status`, original `request`, final `candidates`, `validation`, `repair_count` (0 or 1), `selected_candidate_id` (nullable), `business_data_verification: "not_verified"`, and limitations. A protected run record also retains initial / revised outputs and validations; publish only sanitized synthetic runs. If some candidates still fail, status remains failed even if a passing alternative can be displayed.

## Exceptions and configuration verification

- Invalid user fields: needs-input with field paths; no guessed constraints and no repair of user input.
- Malformed model JSON: structured parse failure; route through the single repair slot if unused, then stop on repeated failure.
- Missing fields / violations: preserve exact error feedback; one repair only.
- Model timeout, unavailable credentials, Code sandbox exception, optional HTTP timeout: error / validation unavailable; no recommendation labeled checked. Configure actual supported error branches before a live demo; until verified this behavior is a requirement only.
- Excessive payload: proposed limits 32 KiB per JSON string, 1,000 characters per descriptive string, 20 entries per list except the three-candidate batch; return a field error. Verify sandbox limits before adopting these as runtime settings.

Before integration, privately confirm Dify product version and hosting type, configured provider, a successful synthetic connection-test run, and availability of selected Python libraries in Code. Never publish credentials or private endpoint settings. Actual import / export and execution evidence must be recorded separately from this specification.
