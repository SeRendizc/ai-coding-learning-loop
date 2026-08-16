---
name: ai-coding-learning-loop
description: Run learning-aware AI coding work with explicit delegation modes, a confirmed Learning Contract, verified implementation, a complete teaching Deliver, and Explain/Predict/Apply transfer gates. Use when a user wants AI to build or modify code while preserving understanding, asks for guided coding or full delegation with teaching, or needs separate engineering and learning evidence.
---

# AI Coding Learning Loop

Treat delivery and learning as separate outcomes. Never claim that passing tests proves user understanding.

## Start the contract

1. Inspect the task and code before choosing ownership.
2. Ask only for decisions that change the plan: goal, time/round budget, required learning targets, deadline, and delegation preference.
3. Recommend one mode from `GUIDED`, `HUMAN_LED`, `AI_LED`, or `DELEGATED` using [ownership-policy.md](references/ownership-policy.md).
4. Present a readable Learning Contract with work-unit ownership and Gate requirements.
5. Wait for explicit acceptance before implementation. Never silently increase AI ownership.

## Run each work unit

Follow this order:

`DISCOVER → CONTRACTED → BRIEFED → BUILDING → VERIFYING → DELIVERING → AWAITING_GATE → CLOSED`

- Brief before implementation: explain scope, interfaces, constraints, ownership, and verification.
- Respect the implementation owner. For a human-owned core method, guide and review instead of writing it.
- Verify engineering evidence before Deliver. Failed verification returns to implementation.
- Teach the verified result during Deliver. Do not reduce Deliver to a completion summary.
- Open Gate only when the Deliver record is complete and bound to the current implementation reference.

## Deliver completely

Cover all ten topics:

1. scope and exclusions;
2. reading order;
3. inputs, state changes, call order, and outputs;
4. design rationale and alternatives;
5. invariants;
6. failure and recovery paths;
7. what each verification proves and does not prove;
8. links to prior knowledge;
9. a transfer example;
10. known gaps and remaining knowledge debt.

Use concrete state changes or a small example when the first explanation is unclear. Record the exact implementation and verification references.

## Gate transfer

Read [gate-policy.md](references/gate-policy.md) before generating or evaluating a Gate.

- Bind every question to one learning target, one taught Deliver topic, and the current implementation reference.
- Use `EXPLAIN`, `PREDICT`, and `APPLY` according to the selected mode.
- Require at least one `APPLY` item for `AI_LED` and `DELEGATED`.
- Judge observable rubric criteria, not keywords.
- On `RETRY`, preserve engineering PASS, record gap codes, reteach only the gaps, and generate a different equivalent question.
- On attempt exhaustion, record `BLOCKED/PARTIAL`; never invent mastery.

## Preserve evidence boundaries

Read [evidence-policy.md](references/evidence-policy.md) before writing reports or resuming work.

- Treat original events as facts; treat snapshots, traces, and reports as derived views.
- Store metadata, references, result codes, and digests by default—not source, full tool arguments/results, secrets, or free-text answers.
- If implementation changes after Deliver, invalidate its reference, verify again, create a new Deliver, then reopen Gate.
- Keep tool authorization separate from delegation and learning status.
- Use the host runtime for execution, approval, persistence, and recovery. Do not create a second agent loop.

## Finish

Report both `engineering_status` and `learning_status`. Include unresolved targets and evidence limitations. Use [knowledge-report.md](assets/knowledge-report.md) when a host does not generate a report automatically.
