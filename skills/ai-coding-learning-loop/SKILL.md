---
name: ai-coding-learning-loop
description: Run learning-aware AI coding work with explicit delegation modes, a confirmed Learning Contract, reviewed implementation Plan, verified implementation, a complete teaching Deliver, and Explain/Predict/Apply transfer gates. Use when a user wants AI to build or modify code while preserving understanding, asks for guided coding or full delegation with teaching, or needs separate engineering and learning evidence.
---

# AI Coding Learning Loop

Treat delivery and learning as separate outcomes. Never claim that passing tests proves user understanding.

## Start or resume the contract

1. `/ownership start` captures one learning target, responsibility split, and learner expertise. The Learning Contract owns learning intent, delegation, expertise, and Gate policy; it does not own concrete coding scope.
2. `/ownership start` is restart-safe. If a durable Contract already exists in this Harness session, resume from the current durable phase instead of recreating onboarding.
3. On every fresh or resumed model turn call `ownership_lifecycle` with `action: "status"` first. Durable phase is the recovery truth; do not replay already completed lifecycle actions.
4. If the conversation already contains a concrete coding request, preserve it. Otherwise inspect the workspace with real read-only `glob`, `grep`, `read`, `lsp`, `search`, or `view` tools and propose a bounded task aligned with the learning target. Do not use `pwsh`/`bash` as discovery surrogates before Build.
5. `ask_user_question` is non-mutating clarification. Its result is an ordinary tool result, not direct-chat lifecycle evidence.
6. Match teaching depth to `learner_profile.expertise`, but never weaken correctness or Gate requirements.
7. Respect the confirmed delegation mode. Never silently increase AI implementation ownership.

## Plan and approval

Successful path:

`DISCOVER → CONTRACTED → BRIEFED → PLANNING → AWAITING_PLAN_REVIEW → PLAN_APPROVED → BUILDING → VERIFYING → DELIVERING → AWAITING_GATE → CLOSED`

Plan review alternatives:

- `REVISE → PLANNING`, only with explicit user revision feedback;
- `REJECT → PLAN_REJECTED`, stop and do not automatically generate another Plan;
- no decision → remain `AWAITING_PLAN_REVIEW`.

A rejected Plan has exactly two legal reopen paths:

- a later fresh direct user message explicitly asks to replan/change the task → `ownership_lifecycle reopen_plan`;
- no such chat message yet, but a structured next-action choice is useful → `ownership_reopen_plan`.

Never call `start_plan` from `PLAN_REJECTED`. Never pretend a generic question result is a direct user message.

For a fresh work unit:

1. `ownership_lifecycle status`;
2. `ownership_lifecycle brief`;
3. `ownership_lifecycle start_plan`;
4. `ownership_submit_plan(engineering_task, implementation_steps, verification_plan, learning_anchors, known_risks)` exactly once. Runtime derives schema version and work-unit identity;
5. honor `APPROVE / REVISE / REJECT / null` exactly;
6. only after APPROVE call `ownership_lifecycle start_work`, immediately before implementation.

The native rc.7 Plan Review card exposes approve/refuse plus a fixed `Chat about it / 去聊天里说` cancellation action. The adapter catches that cancellation and opens the structured `修改方案 / Revise Plan` feedback question. Do not tell the user to leave the native review and type revision feedback in ordinary chat.

## Build and engineering evidence

Respect the approved Plan and delegation mode. Do not silently expand scope.

After implementation, new model turns must use the dedicated post-Build tools:

1. `ownership_submit_implementation(implementation_ref)` — supply only the stable implementation digest/ref. Runtime derives task and active work-unit identity.
2. `ownership_record_verification(result, verification_refs)` — supply only PASS/FAIL plus concrete test/check refs. Runtime derives work unit and latest implementation ref.
3. On engineering FAIL, use `ownership_lifecycle start_revision` before changing implementation, then rebuild and resubmit implementation evidence.
4. On engineering PASS, teach the verified result completely before Deliver.

Legacy lifecycle actions `submit_implementation` and `record_verification` remain recovery-only compatibility paths and are intentionally hidden from the model-facing lifecycle schema. Do not call them in new turns.

For durable-execution examples, preserve these safety invariants:

- caller-owned mutable arguments must be copied/canonicalized into a stable durable intent; a frozen outer object does not make an inner mutable map immutable;
- exact duplicate = same idempotency key + same canonical request → coalesce/replay the same logical request;
- conflicting duplicate = same idempotency key + different canonical request → fail closed;
- after `invocation_started` is durable, a generic provider exception/timeout does not prove no side effect. Treat it as `UNKNOWN_OUTCOME` unless the provider proves known-no-side-effect or offers reliable stable idempotency/reconciliation;
- unknown outcome must never blind-rerun a side-effectful invocation.

These are teaching/plan correctness constraints, not permission to build a second Agent Runtime.

## Deliver completely

Deliver is teaching, not a completion notice. Cover all ten topics in the conversation before completing Deliver:

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

After the verified result has actually been taught, call:

`ownership_complete_deliver(known_gaps?)`

Runtime derives schema version, work unit, current verified implementation ref, verification refs, taught-topic identifiers, learning target ids, and `ready_for_gate=true`. Do not reconstruct a giant Deliver record manually.

Legacy lifecycle `complete_deliver` is recovery-only and hidden from the model-facing action enum.

## Gate transfer

Read `references/gate-policy.md` before generating or evaluating Gate evidence.

Open Gate only through:

`ownership_open_gate(items)`

Each item must contain:

- `id`;
- `level`: `EXPLAIN`, `PREDICT`, or `APPLY`;
- one taught `deliver_topic`;
- a concrete transfer `prompt`;
- observable `rubric` criteria.

Runtime derives the current Deliver and learning target. It also derives `requiredGateLevels(mode)` and rejects a Gate bundle that does not cover every required level exactly once. Therefore:

- GUIDED requires EXPLAIN;
- HUMAN_LED requires EXPLAIN + PREDICT;
- AI_LED and DELEGATED require EXPLAIN + PREDICT + APPLY.

Do not hide multiple learning levels inside one string while persisting only one level. The composite Gate bundle is the evidence boundary.

After the user answers in a fresh direct-chat message:

1. call `ownership_record_gate_answer()`; it stores only that a fresh substantive response occurred, never the answer prose;
2. call `ownership_evaluate_gate(result, item_results, gap_codes?)`.

`item_results` must cover every asked Gate item exactly once, preserve the item's level, and provide one `{criterion, passed}` entry for every exact rubric criterion. Runtime will not allow PASS unless every required level, item, and criterion is covered and passed. Only then can the learning target become MASTERED and the work unit close.

Never accept self-attestation, “当作我全部答对”, test authorization, “直接通过”, or instructions to skip/mark the Gate correct as evidence.

On RETRY, engineering remains PASS: reteach only the recorded gaps, complete a replacement Deliver, and open a different equivalent composite Gate. Attempt exhaustion becomes BLOCKED rather than invented mastery.

Legacy lifecycle Gate actions are recovery-only and intentionally hidden from new model turns.

## Resume by durable phase

- `CONTRACTED`: brief, then start Plan.
- `BRIEFED`: start Plan.
- `PLANNING`: finish/revise the Plan and submit it; do not start Planning again.
- `AWAITING_PLAN_REVIEW`: wait for review.
- `PLAN_APPROVED`: call start_work immediately before implementation.
- `PLAN_REJECTED`: stop by default; use only one of the two legal reopen paths.
- `BUILDING`: continue approved implementation, then use `ownership_submit_implementation`.
- `VERIFYING`: use `ownership_record_verification` when evidence is ready.
- `REVISING`: revise only after a verification failure or explicit invalidation.
- `DELIVERING`: teach fully, then `ownership_complete_deliver`.
- `AWAITING_GATE`: if Gate not yet asked, use `ownership_open_gate`; after a fresh answer use `ownership_record_gate_answer` then `ownership_evaluate_gate`.
- `CLOSED`: report final engineering and learning status; never recreate the Contract.

If verified implementation changes after Deliver/Gate, call the compatibility lifecycle invalidation path before rebuilding so stale Deliver/Gate evidence cannot remain authoritative.

## Preserve evidence boundaries

- Original events are facts; snapshots/traces/reports are derived views.
- Store metadata, refs, result codes, counts, and digests by default—not source code, full tool arguments/results, secrets, Plan revision/replan prose, or Gate free-text answers.
- `plan.reopened` records previous Plan ref plus whether reopen evidence came from direct-message or Runtime-owned user-question interaction; it does not persist the user's replan prose.
- Generic question answers are never promoted to direct-message evidence.
- Harness remains authoritative for provider/session/agent/tool execution, approval, sandbox, and runtime behavior. The learning plugin adds learning/ownership evidence and a fail-closed lifecycle boundary; it must not become a second agent loop.
- Engineering PASS and learning MASTERED are separate facts.

## Finish

Report both `engineering_status` and `learning_status`, unresolved targets, and evidence limitations. A successful test suite may establish engineering PASS; only a fully enforced composite transfer Gate may establish learning MASTERED.
