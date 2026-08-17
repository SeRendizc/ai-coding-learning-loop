---
name: ai-coding-learning-loop
description: Run learning-aware AI coding work with explicit delegation modes, a confirmed Learning Contract, verified implementation, a complete teaching Deliver, and Explain/Predict/Apply transfer gates. Use when a user wants AI to build or modify code while preserving understanding, asks for guided coding or full delegation with teaching, or needs separate engineering and learning evidence.
---

# AI Coding Learning Loop

Treat delivery and learning as separate outcomes. Never claim that passing tests proves user understanding.

## Start the contract

1. Inspect the task and code before choosing ownership.
2. Treat the user's one-sentence target as the anchor. Refine it into concrete learning anchors in the Plan; do not make the user pre-author a curriculum.
3. Read `learner_profile.locale` and answer in that language. Match teaching depth to `learner_profile.expertise`:
   - `BEGINNER`: define terms and prerequisites, show every step, use annotated examples, and check the mental model frequently.
   - `PRACTITIONER`: assume foundations; focus on data flow, rationale, trade-offs, failure paths, and one transfer example.
   - `EXPERT`: be terse and terminology-dense; focus on deltas, invariants, edge cases, alternatives, and evidence.
   Presentation depth changes; correctness and Gate standards do not.
4. Recommend one mode from `GUIDED`, `HUMAN_LED`, `AI_LED`, or `DELEGATED` using [ownership-policy.md](references/ownership-policy.md).
5. Present a readable Learning Contract with work-unit ownership and Gate requirements.
6. Wait for explicit acceptance before planning. Never silently increase AI ownership.

## Run each work unit

Follow this order:

`DISCOVER → CONTRACTED → BRIEFED → PLANNING → AWAITING_PLAN_REVIEW → PLAN_APPROVED → BUILDING → VERIFYING → DELIVERING → AWAITING_GATE → CLOSED`

- Brief before planning: explain scope, interfaces, constraints, ownership, and verification.
- In Planning, refine the user's target into learning anchors and produce implementation steps, verification, and known risks.
- Submit the Plan, show the same Plan to the user, and stop in `AWAITING_PLAN_REVIEW`.
- Require a new direct user review. `APPROVE` permits Build; `REVISE` returns to Planning. Never treat silence or continued task discussion as approval.
- Do not edit implementation files or execute implementation commands before durable state is `PLAN_APPROVED`.
- Respect the implementation owner. For a human-owned core method, guide and review instead of writing it.
- Verify engineering evidence before Deliver. Failed verification returns to implementation.
- Teach the verified result during Deliver. Do not reduce Deliver to a completion summary.
- Open Gate only when the Deliver record is complete and bound to the current implementation reference.

## Persist the lifecycle in Harness

After `/ownership start` is accepted, use the `ownership_lifecycle` tool for
the current session. Call `status` before resuming and append exactly one action
only after that action has actually happened:

1. `brief` with the contracted `work_unit_id` and the topics just taught;
2. `start_plan`, then `submit_plan` with implementation steps, verification, learning anchors, and risks;
3. show that Plan and pause; only after a new direct user review call `record_plan_review` with `APPROVE` or `REVISE`;
4. call `start_work` only after Plan approval and immediately before implementation begins;
5. `submit_implementation` with a stable implementation digest or commit ref;
6. `record_verification` with `PASS` or `FAIL`, the same implementation ref,
   and concrete test/check refs;
7. after `FAIL`, use `start_revision` before changing the implementation;
8. after engineering `PASS`, teach fully, then use `complete_deliver` with the
   complete Deliver record;
9. use `ask_gate` only for a Gate bound to that Deliver;
10. after the direct user answers, call `record_gate_answer` with no answer text;
    the plugin records only that a new direct response occurred;
11. call `evaluate_gate` separately with criterion-level evidence;
12. when verified implementation changes after Deliver, call
    `invalidate_implementation` before rebuilding.

Never skip an action to force a later phase. The tool derives `task_id` from
the calling Harness session, rejects unknown work units and illegal ordering,
and does not authorize code or other tools. On Gate `RETRY`, engineering stays
`PASS`: reteach the recorded gaps, create a replacement Deliver, and ask a new
equivalent Gate. Do not start a code revision unless engineering evidence also
failed or the implementation changed.

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
- Never accept self-attestation, “treat this as correct,” test authorization, or a request to skip the Gate as evidence.
- Return one structured `{ criterion, passed }` result for every exact rubric criterion. PASS requires all items to be true and must name the mastered target.

## Preserve evidence boundaries

Read [evidence-policy.md](references/evidence-policy.md) before writing reports or resuming work.

- Treat original events as facts; treat snapshots, traces, and reports as derived views.
- Store metadata, references, result codes, and digests by default—not source, full tool arguments/results, secrets, or free-text answers.
- If implementation changes after Deliver, invalidate its reference, verify again, create a new Deliver, then reopen Gate.
- Keep tool authorization separate from delegation and learning status.
- Use the host runtime for execution, approval, persistence, and recovery. Do not create a second agent loop.

## Finish

Report both `engineering_status` and `learning_status`. Include unresolved targets and evidence limitations. Use [knowledge-report.md](assets/knowledge-report.md) when a host does not generate a report automatically.
