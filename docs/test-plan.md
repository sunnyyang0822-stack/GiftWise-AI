# Reproducible test plan — no results yet

Status: proposed tests only. No validator, Dify gift-workflow run, test success rate, latency, or cost has been measured. Documentation checks are not business-function tests.

## Fixtures and execution protocol

Use the request in [workflow-spec](../workflow/workflow-spec.md) as base: CNY 200, two days, fact f1 (coffee), forbidden alcohol / literal term 酒. Build three distinct valid candidates c1/c2/c3 with estimated totals 150/120/80, preparation 1/2/1 days, permitted tags, correct fact references, and separate inference / unknown arrays. Values are synthetic, not real product information.

The first coding task must store this full base fixture and each mutation in `tests/test_cases.json`; case IDs below are stable. Each test starts from a fresh deep copy. Fixed offline outputs make checks reproducible; they do not prove a model actually repaired anything. For integrated tests, retain the actual model outputs and code traces from the same request.

Run future offline tests with `python -m unittest discover -s tests -v` once implemented. Record Python version, Git SHA, command, timestamp with timezone, exit status, and per-case observed / expected result. No packages or test command are currently supplied as a working application.

| ID | Layer / reproducible change | Expected result |
| --- | --- | --- |
| T01 normal | Base fixture | All three pass, repair count 0 in live flow |
| T02 budget | Set c1 total to 200.01 | c1 fails OVER_BUDGET; 200.00 boundary passes |
| T03 restriction | Set c1 tags to alcohol; separately place 酒 in description | FORBIDDEN_TAG / FORBIDDEN_TERM respectively; passing a tag check alone is insufficient |
| T04 preparation | Set c1 preparation to 3 days | PREPARATION_TOO_LONG; 2 days passes |
| T05 insufficient information | Remove budget; separately empty facts only | Missing budget → needs_input; empty facts with no references → valid with unknown preferences, no fabricated facts |
| T06 invalid JSON | Feed truncated candidates JSON | INVALID_JSON; no unchecked success; repeated malformed output after one live repair stops |
| T07 repair succeeds | First snapshot c1=250; fixed repaired snapshot c1=180; others unchanged | First validation fails, second passes; offline pair only tests the validator; live test requires one actual N5 invocation and N6 trace |
| T08 repair fails | First snapshot c1=250; repaired snapshot c1=230 | Both fail; live flow ends after one repair, reports unresolved issue and never retries |
| T09 currencies | c1 currency USD; separately request currency USD | CURRENCY_MISMATCH / UNSUPPORTED_CURRENCY; no implicit conversion |
| T10 fields / evidence | Remove reason; separately use nonexistent fact f99 | MISSING_FIELD / UNKNOWN_FACT_REF; no false pass |
| T11 numeric / type edges | Negative amount, NaN/Infinity, boolean days, numeric amount rather than string | Controlled rejection; no crash or truthy-number coercion |
| T12 batch integrity | Two candidates, duplicate candidate IDs, duplicate fact IDs | Explicit batch / identifier failure |
| T13 parser / limits | Duplicate JSON keys, null root, wrong arrays, oversized payload, unknown tags | Controlled error at correct field; no silent acceptance |
| T14 workflow preservation | Repair changes previously passing c2, or tries to change budget | Workflow rejects unauthorized state changes; immutable original request still governs validation |
| T15 infrastructure | Actual provider / Code error; optional API timeout if API exists | Honest error status, no unchecked success, no infinite retries |

Run at least T01–T08 both at their applicable offline layer and in the configured workflow before claiming the complete MVP works. T14–T15 require workflow integration; do not count them as covered by pure validator tests. Do not manipulate live tests to claim naturally occurring model behavior: use a clearly labeled test-only fixture injection branch to demonstrate deterministic violations if needed; keep it separate from normal generation.

## Metrics and denominators

| Metric | Definition and method |
| --- | --- |
| Hard-constraint satisfaction | Final candidates independently satisfying all applicable hard rules / all final candidates emitted in valid-request, completed test runs. Evaluate failed candidates too; separately count errors and no-output runs. Never exclude failures to inflate the rate. |
| Forbidden-item interception | Deliberately prohibited candidates correctly blocked / all deliberately prohibited candidates. Use labeled tag and literal-term fixtures; count benign candidates wrongly blocked separately. This measures implemented rules, not all semantic prohibitions. |
| Repair success | Runs needing repair that pass all rules after exactly one actual repair / all valid-request runs entering repair, including timeout or persistent failures. Fixed offline snapshot pairs are reported separately. |
| End-to-end latency | Monotonic elapsed time from submission to final output or error; show count, raw timings, median, and range, split repair / no-repair. Use p95 only with an adequate sample count and state method. |
| Model calls | Actual generation / repair invocations per run, including failed calls and retries; expected MVP maximum two. Do not infer calls solely from repair count. |
| Model cost | Sum measured token categories × actual contemporaneous provider rate for each call; record model, rate date, currency, cached-token treatment, and billing source. Missing usage or rates → unknown, not zero. Cloud cost is separate. |

Acceptance: all documented offline expected results match actual results, no unchecked candidate is marked passed, actual workflow traces show at most one repair and revalidation, and honest error reports exist. No latency or monetary target is claimed until measured and agreed with the owner.

## Result record template

For each run store: case ID, layer (offline / live Dify / deployed API), synthetic fixture revision, Git SHA, actual model identifier and settings when applicable, Dify version / hosting type, timestamp, expected result, observed result, pass/fail, error codes, repair count, model call count, elapsed milliseconds, token counts / cost basis, sanitized trace location, and known limitations. Current value for every business test: **not run**.

Use fictional data and redact secrets, private addresses, and recipient information. Recheck the deployed API separately if introduced; local tests do not demonstrate cloud reachability or container health.
