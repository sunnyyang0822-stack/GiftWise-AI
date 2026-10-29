# GiftWise AI

An AI gift decision agent designed to offer evidence-based recommendations, independent constraint validation, and one bounded repair attempt.

**Status: In Development.** This repository currently contains project specifications only. The gift workflow, validator, tests, and deployment are not implemented or verified.

中文简介：帮助用户在预算、偏好、明确禁忌和准备时间约束下选择礼物；第一版聚焦为一位关系不错、但不太熟悉的同事挑选生日礼物。

## Problem and target users

People buying a gift for a colleague often have incomplete preference information, a limited budget, and a deadline. A plausible recommendation alone does not demonstrate that constraints were checked. GiftWise aims to make the reasoning and remaining uncertainty visible.

This is a hackathon MVP for an individual participant with limited programming experience. Product value and user demand remain hypotheses; no market validation or real-user results are claimed.

## Planned workflow

User requirements → structured analysis and three candidates → independent code validation → one repair of failing candidates → revalidation → final decision report.

Planned differentiators:

- Separate user-provided facts, model inferences, and unknown information.
- Validate declared budget, currency, explicit restrictions, required fields, and estimated preparation time with code.
- Preserve validation failures and allow at most one automatic repair.
- Add optional packaging, color, and greeting-card suggestions after the core flow works.

Without a live product data source, prices and preparation times are estimates. Stock, current prices, and actual delivery dates are **not verified**. Passing a rule check only means the supplied data satisfies the implemented rules.

## Technology and verified state

| Component | Purpose | State |
| --- | --- | --- |
| GitHub | Public source control and documentation | This repository |
| Dify | Workflow orchestration and model calls | Local export inspected: Start → LLM → End; live execution unverified |
| Python | Deterministic constraint validation | Planned; start with a Code-node-compatible module |
| FastAPI | Optional independent validator API | Conditional; not implemented |
| Docker | Package an optional API service | Conditional; not implemented |
| UCloud | Deployment if resources and competition rules require it | Account reported by owner; resources unverified |

The inspected export contains a connection-test prompt, not a gift agent. Its DSL schema version is not proof of the running Dify product version. No Kubernetes, database, or separate frontend is planned for the initial MVP.

## Repository layout

```text
.
├── README.md
├── .gitignore
├── .env.example
├── docs/
│   ├── product-requirements.md
│   ├── architecture.md
│   ├── test-plan.md
│   └── demo-script.md
└── workflow/
    └── workflow-spec.md
```

Product scope is in [requirements](docs/product-requirements.md); implementation boundaries are in [architecture](docs/architecture.md); the canonical proposed data contract is in [workflow specification](workflow/workflow-spec.md). [Test plan](docs/test-plan.md) defines reproducible acceptance checks. [Demo script](docs/demo-script.md) is a draft, with unimplemented steps marked.

## Run or try locally

There is no executable application, installation command, hosted demo, or verified importable DSL yet. Copying `.env.example` does not start anything. The original local `.ifpkg` export is preserved outside version control for review.

To verify the existing connection yourself in Dify: open Studio → the Giftwise workflow → Test Run, enter a fictional colleague relation, then inspect the LLM and End outputs. The current test prompt requests `GiftWise 模型连接成功。`. Save the run status and duration; seeing this text in the prompt alone does not prove success. If the run fails, inspect the node error and provider configuration privately; do not share credentials.

## Delivery plan

All dates are in Asia/Shanghai; the stated competition window is supplied by the project owner, not independently confirmed official rules.

| ID | Target | Owner | Estimate | Dependency | Deliverable / acceptance | State / risk |
| --- | --- | --- | --- | --- | --- | --- |
| INIT-001 | Oct 29: repository baseline | PM | 1 hour | GitHub access | Eight reviewed files committed and pushed | In progress until remote SHA verified |
| VAL-001 | Oct 30: offline validator | Codex; PM reviews | 2–3 hours | Specifications | Deterministic module and actual fixture results | Not started; input contract errors |
| WF-001 | Oct 30: Dify connection and core flow | Owner operates Dify; Codex supplies code | 3–4 hours | VAL-001; provider access | Three candidates, rule check, bounded repair trace | Not started; model access / sandbox compatibility |
| QA-001 | Oct 31: acceptance and measurements | Codex; owner reviews outputs | 2–3 hours | WF-001 | Eight scenarios, raw results, latency / usage logs | Not started; live failures |
| CLOUD-001 | Oct 31: conditional API and deployment | Codex; owner provisions account resources | 3–5 hours | Rules confirmed; resources available | Optional API, container, cloud smoke test | Not started; required status and costs unknown |
| DEMO-001 | Nov 1: freeze and rehearse | Owner; PM reviews evidence | 2 hours | QA-001; applicable cloud work | Four-minute demo, backup recording, honest limitations | Not started; submission cutoff unknown |

Confirm containerization / Kubernetes requirements, use of hosted Dify and external models, provided UCloud resources, budget, and submission cutoff with organizers before treating cloud work as optional. If mandated, promote that work into the critical path. Cut decorative UI before cutting core validation or required deployment.

## Development and safety

Implement one bounded task at a time. Preserve owner files. Keep credentials, private endpoints, real recipient data, and unreviewed workflow exports out of public commits. Use fictional test cases; review staged files and logs before every push. `.gitignore` is a safeguard, not a secret scanner. If a secret enters history, revoke or rotate it before arranging history cleanup.

Record commands and observed results. Distinguish offline fixtures, actual Dify execution, and cloud deployment evidence. Never label planned functionality as complete. No business tests have been run for this documentation-only baseline.
