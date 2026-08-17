---
name: ai-coding-learning-loop
description: Run learning-aware AI coding work with explicit delegation modes, a confirmed Learning Contract, reviewed implementation Plan, verified implementation, a complete teaching Deliver, and Explain/Predict/Apply transfer gates. Use when a user wants AI to build or modify code while preserving understanding, asks for guided coding or full delegation with teaching, or needs separate engineering and learning evidence.
---

# AI Coding Learning Loop

Treat delivery and learning as separate outcomes. Never claim that passing tests proves user understanding.

## Start the contract

1. Keep the Learning Contract intentionally small. `/ownership start` captures the user's one-sentence learning target, responsibility split, and learner expertise. Do not require the user to pre-specify a coding task or curriculum merely to enter the loop.
2. Treat the learning target as the anchor. Refine it into concrete learning anchors in the Plan; do not make the user pre-author a curriculum.
3. Concrete engineering scope belongs to the reviewed Plan, not the Learning Contract. If the conversation already contains a concrete coding request from the user, preserve it as the proposed `engineering_task`. If none exists, inspect the workspace with read-only tools and propose a bounded task aligned with the learning target. A proposed task is not authoritative until Plan approval.
4. Read `learner_profile.locale` and answer in that language. Match teaching depth to `learner_profile.expertise`:
   - `BEGINNER`: define terms and prerequisites, show every step, use annotated examples, and check the mental model frequently.
   - `PRACTITIONER`: assume foundations; focus on data flow, rationale, trade-offs, failure paths, and one transfer example.
   - `EXPERT`: be terse and terminology-dense; focus on deltas, invariants, edge cases, alternatives, and evidence.
   Presentation depth changes; correctness and Gate standards do not.
5. Respect the confirmed mode from `GUIDED`, `HUMAN_LED`, `AI_LED`, or `DELEGATED` using [ownership-policy.md](references/ownership-policy.md). Never silently increase AI ownership.
6. `/ownership start` presents a human-readable Learning Contract and waits for explicit acceptance before this Skill continues. Contract acceptance confirms learning intent and responsibility only. It is neither coding-scope approval nor Plan approval and does not authorize implementation.

## Run each work unit

Follow this order:

`DISCOVER → CONTRACTED → BRIEFED → PLANNING → AWAITING_PLAN_REVIEW → PLAN_APPROVED → BUILDING → VERIFYING → DELIVERING → AWAITING_GATE → CLOSED`

- On every resume, call `ownership_lifecycle` with `action: "status"` first. Use the returned `context` for learning targets, work units, mode, learner profile, Gate policy, latest Plan, and any legacy engineering scope. Do not search the private evidence directory to rediscover the contract.
- Before Planning, record a planning Brief: explain the learning target, ownership boundary, relevant workspace context, discovery constraints, and verification expectations. Do not pretend a concrete coding scope has already been approved.
- In Planning, determine the proposed `engineering_task`. Preserve an existing direct user coding request when one exists; otherwise propose a bounded task that fits the learning target and current workspace. Then produce implementation steps, verification, learning anchors, and known risks.
- `submit_plan` is the engineering-scope and Plan handoff. In DeepSeek Harness it opens the native Plan Review UI showing the exact proposed coding task plus the full Plan and records `APPROVE` or `REVISE` as direct user interaction evidence. Do not duplicate the same approval request in ordinary chat when `plan_review.channel` is `native-user-question`.
- If `submit_plan` returns `plan_review.channel: "direct-message-fallback"`, show the same coding task and Plan in chat and stop in `AWAITING_PLAN_REVIEW`; only a new direct user message may then be recorded with `record_plan_review`.
- If native Plan Review returns `REVISE`, stay in Planning, use transient `plan_review.feedback` when present, revise the task or Plan, and submit it again. Do not implement.
- If Plan Review returns `APPROVE`, the approved Plan becomes the authoritative engineering scope. Call `start_work` immediately before implementation begins. Never edit implementation files or execute side-effectful tools before durable state enters an implementation phase.
- The host plugin also enforces this boundary at `tools/pre-execute`: once a contract exists, non-read-only tools are denied outside `BUILDING`, `VERIFYING`, and `REVISING`. Do not attempt to work around that policy.
- Respect the implementation owner. For a human-owned core method, guide and review instead of writing it.
- Verify engineering evidence before Deliver. Failed verification returns to implementation.
- Teach the verified result during Deliver. Do not reduce Deliver to a completion summary.
- Open Gate only when the Deliver record is complete and bound to the current implementation reference.

## Persist the lifecycle in Harness

After `/ownership start` is accepted, use the `ownership_lifecycle` tool for the current session. Record exactly one action only after that action has actually happened:

1. `status` first on every fresh or resumed agent turn; consume its `context` instead of reading sidecar files;
2. `brief` with the contracted `work_unit_id` and planning-brief topics just established;
3. `start_plan`, then `submit_plan` with all current Harness-required fields: `schema_version`, `work_unit_id`, `engineering_task`, `implementation_steps`, `verification_plan`, `learning_anchors`, and `known_risks`;
4. honor the Plan Review result from `submit_plan`; use `record_plan_review` only for the explicit direct-message fallback path;
5. call `start_work` only after Plan approval and immediately before implementation begins;
6. `submit_implementation` with a stable implementation digest or commit ref;
7. `record_verification` with `PASS` or `FAIL`, the same implementation ref, and concrete test/check refs;
8. after `FAIL`, use `start_revision` before changing the implementation;
9. after engineering `PASS`, teach fully, then use `complete_deliver` with the complete Deliver record;
10. use `ask_gate` only for a Gate bound to that Deliver;
11. after the direct user answers, call `record_gate_answer` with no answer text; the plugin records only that a new direct response occurred;
12. call `evaluate_gate` separately with criterion-level evidence;
13. when verified implementation changes after Deliver, call `invalidate_implementation` before rebuilding.

The portable Plan v1 core still accepts older evidence that predates `engineering_task`; this is recovery compatibility only. New Harness Plan submissions must include it and the adapter rejects a missing or empty value.

Never skip an action to force a later phase. The tool derives `task_id` from the calling Harness session, rejects unknown work units and illegal ordering, and does not authorize code or other tools by itself. On Gate `RETRY`, engineering stays `PASS`: reteach the recorded gaps, create a replacement Deliver, and ask a new equivalent Gate. Do not start a code revision unless engineering evidence also failed or the implementation changed.

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
- Store metadata, references, result codes, and digests by default—not source, full tool arguments/results, secrets, Gate free-text answers, or Plan revision prose.
- Native Plan Review may return revision prose transiently to the current model turn, but durable evidence records only the decision and Plan reference.
- If implementation changes after Deliver, invalidate its reference, verify again, create a new Deliver, then reopen Gate.
- Keep tool authorization separate from delegation and learning status. The host pre-execute policy enforces only the lifecycle write boundary; normal Harness approvals and sandbox policy still apply.
- Use the host runtime for execution, approval, persistence, and recovery. Do not create a second agent loop.

## Finish

Report both `engineering_status` and `learning_status`. Include unresolved targets and evidence limitations. Use [knowledge-report.md](assets/knowledge-report.md) when a host does not generate a report automatically.
