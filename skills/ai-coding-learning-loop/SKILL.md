---
name: ai-coding-learning-loop
description: Run learning-aware AI coding work with explicit delegation modes, a confirmed Learning Contract, reviewed implementation Plan, verified implementation, a complete teaching Deliver, and Explain/Predict/Apply transfer gates. Use when a user wants AI to build or modify code while preserving understanding, asks for guided coding or full delegation with teaching, or needs separate engineering and learning evidence.
---

# AI Coding Learning Loop

Treat delivery and learning as separate outcomes. Never claim that passing tests proves user understanding.

## Start or resume the contract

1. Keep the Learning Contract intentionally small. `/ownership start` captures the user's one-sentence learning target, responsibility split, and learner expertise. Do not require the user to pre-specify a coding task or curriculum merely to enter the loop.
2. `/ownership start` is restart-safe. If this Harness session already has a durable accepted Learning Contract, running `/ownership start` again must resume that existing session instead of asking the onboarding questions or creating another Contract. This is the recovery path after provider, network, credential, model, or automatic-continuation failure.
3. On every fresh or resumed model turn, call `ownership_lifecycle` with `action: "status"` first. The returned durable phase is the recovery truth. Do not blindly replay actions that already happened.
4. Treat the learning target as the anchor. Refine it into concrete learning anchors in the Plan; do not make the user pre-author a curriculum.
5. Concrete engineering scope belongs to the reviewed Plan, not the Learning Contract. If the conversation already contains a concrete coding request from the user, preserve it as the proposed `engineering_task`. If none exists, inspect the workspace with actual read-only tools and propose a bounded task aligned with the learning target. A proposed task is not authoritative until Plan approval.
6. During pre-Build discovery, call the real Harness `glob`, `grep`, `read`, `lsp`, `search`, or `view` capabilities directly. Never use `pwsh` or `bash` as a surrogate for listing, searching, or reading just because the shell command itself looks read-only. The host deliberately keeps arbitrary shell execution blocked before an approved Plan.
7. Read `learner_profile.locale` and answer in that language. Match teaching depth to `learner_profile.expertise`:
   - `BEGINNER`: define terms and prerequisites, show every step, use annotated examples, and check the mental model frequently.
   - `PRACTITIONER`: assume foundations; focus on data flow, rationale, trade-offs, failure paths, and one transfer example.
   - `EXPERT`: be terse and terminology-dense; focus on deltas, invariants, edge cases, alternatives, and evidence.
   Presentation depth changes; correctness and Gate standards do not.
8. Respect the confirmed mode from `GUIDED`, `HUMAN_LED`, `AI_LED`, or `DELEGATED` using [ownership-policy.md](references/ownership-policy.md). Never silently increase AI ownership.
9. First-time `/ownership start` presents a compact Learning Contract and waits for explicit acceptance. Contract acceptance confirms learning intent and responsibility only. It is neither coding-scope approval nor Plan approval and does not authorize implementation.

## Run each work unit

The successful path is:

`DISCOVER → CONTRACTED → BRIEFED → PLANNING → AWAITING_PLAN_REVIEW → PLAN_APPROVED → BUILDING → VERIFYING → DELIVERING → AWAITING_GATE → CLOSED`

Plan review has three non-Build outcomes:

- `AWAITING_PLAN_REVIEW --REVISE--> PLANNING`
- `AWAITING_PLAN_REVIEW --REJECT--> PLAN_REJECTED`
- `AWAITING_PLAN_REVIEW --no decision--> AWAITING_PLAN_REVIEW`

A rejected Plan is not an authorization to generate another one. However, rejection does not permanently kill the Learning Contract. A later **new direct user message** may explicitly ask to replan, change the task, or replace the rejected Plan. Only then use `ownership_lifecycle reopen_plan`, which validates that fresh user evidence and transitions `PLAN_REJECTED → PLANNING`. Never call `start_plan` directly from `PLAN_REJECTED`, and never invoke `reopen_plan` on the agent's own initiative.

- Before first Planning, record a planning Brief: explain the learning target, ownership boundary, relevant workspace context, discovery constraints, and verification expectations. Do not pretend a concrete coding scope has already been approved.
- In Planning, determine the proposed `engineering_task`. Preserve an existing direct user coding request when one exists; otherwise propose a bounded task that fits the learning target and current workspace. Then produce implementation steps, verification, learning anchors, and known risks.
- After `ownership_lifecycle start_plan`, use **`ownership_submit_plan`** for the engineering-scope and Plan handoff. Supply exactly the five semantic fields it requests: `engineering_task`, `implementation_steps`, `verification_plan`, `learning_anchors`, and `known_risks`. Do not invent or repeat `schema_version` or `work_unit_id`; the runtime derives them from durable Planning state.
- After `reopen_plan`, the rejected Plan remains historical evidence only. Do not reuse its task or parameters unless the new direct user request explicitly retains them. Produce a fresh Plan from the new user instruction plus current trusted context.
- `ownership_submit_plan` opens the Harness Plan Review UI using the exact live calling agent and shows the proposed coding task plus full Plan. Do not use the legacy `ownership_lifecycle submit_plan` action in a new model turn.
- Harness rc.7 exposes its native Plan card as a binary approve/refuse decision plus a fixed `Chat about it / 去聊天里说` cancellation button. The Ownership adapter treats that cancellation as a request to open a second structured **Plan revision feedback** question. Do not tell the user to leave the review and type feedback in ordinary chat when this native adapter is active.
- Treat the returned review result as authoritative and exhaustive:
  - `decision: "APPROVE"`: the Plan is approved. Call `start_work` immediately before implementation begins.
  - `decision: "REVISE"`: valid only when `feedback` is non-empty and came from the user. Revise only from that feedback, stay in Planning, and submit the updated Plan again. Do not implement.
  - `decision: "REJECT"`: the user rejected this Plan. Stop immediately in `PLAN_REJECTED`. Do not generate another Plan or continue implementation. Only a later explicit direct-user replan request may authorize `reopen_plan`.
  - `decision: null`: no review decision was completed. Stay in `AWAITING_PLAN_REVIEW`, stop, and wait. Do not infer approval or revision intent.
- When `plan_review.channel` is `native-user-question`, do not duplicate the same approval request in ordinary chat.
- Use `ownership_lifecycle record_plan_review` **only** when `ownership_submit_plan` explicitly returns `plan_review.channel: "direct-message-fallback"`, which means no interaction provider exists. Show the same coding task and Plan in chat and stop; only a new direct user message may then be recorded. Never use this fallback to recover from a native Web cancellation.
- The host plugin enforces the Plan-before-Build boundary at `tools/pre-execute`: once a contract exists, non-read-only tools are denied outside `BUILDING`, `VERIFYING`, and `REVISING`. If a `pwsh`/`bash` discovery attempt is denied, switch to the real read-only filesystem/search tools instead of retrying the shell.
- Respect the implementation owner. For a human-owned core method, guide and review instead of writing it.
- Verify engineering evidence before Deliver. Failed verification returns to implementation.
- Teach the verified result during Deliver. Do not reduce Deliver to a completion summary.
- Open Gate only when the Deliver record is complete and bound to the current implementation reference.

## Resume by durable phase

After a provider/network/model failure or any later `/ownership start` resume, read status and continue from the exact phase:

- `CONTRACTED`: establish the Brief, then `start_plan`.
- `BRIEFED`: `start_plan`.
- `PLANNING`: finish or revise the fresh Plan and submit it; do not start Planning again.
- `AWAITING_PLAN_REVIEW`: wait for review; do not submit another Plan unless the current review produces REVISE.
- `PLAN_APPROVED`: `start_work` immediately before implementation.
- `PLAN_REJECTED`: stop unless the latest new direct user message explicitly asks to replan/change the task; then call `reopen_plan` exactly once and continue from `PLANNING`.
- `BUILDING / VERIFYING / REVISING / DELIVERING / AWAITING_GATE`: continue only with that phase's legal next action and existing evidence.
- `CLOSED`: report the final dual status; do not recreate the Contract.

## Persist the lifecycle in Harness

For the first successful work unit:

1. `ownership_lifecycle status` first on every fresh or resumed agent turn; consume its `context` instead of reading sidecar files;
2. `ownership_lifecycle brief` with the contracted `work_unit_id` and planning-brief topics just established;
3. `ownership_lifecycle start_plan` with that work unit;
4. call `ownership_submit_plan` once with the complete semantic Plan fields; Runtime materializes `schema_version` and current `work_unit_id`;
5. honor exactly one of `APPROVE / REVISE / REJECT / null`; use `record_plan_review` only for explicit direct-message fallback;
6. after `REJECT`, stop; only a later explicit new direct-user replan request may call `reopen_plan` and create a fresh Plan;
7. call `start_work` only after `APPROVE` and immediately before implementation begins;
8. `submit_implementation` with a stable implementation digest or commit ref;
9. `record_verification` with `PASS` or `FAIL`, the same implementation ref, and concrete test/check refs;
10. after `FAIL`, use `start_revision` before changing the implementation;
11. after engineering `PASS`, teach fully, then use `complete_deliver` with the complete Deliver record;
12. use `ask_gate` only for a Gate bound to that Deliver;
13. after the direct user answers, call `record_gate_answer` with no answer text; the plugin records only that a new direct response occurred;
14. call `evaluate_gate` separately with criterion-level evidence;
15. when verified implementation changes after Deliver, call `invalidate_implementation` before rebuilding.

The portable Plan v1 core still accepts older evidence that predates `engineering_task`; this is recovery compatibility only. The hidden legacy lifecycle Plan action also remains for existing deterministic evidence and provider-free compatibility tests. New model turns must use `ownership_submit_plan`.

Never skip an action to force a later phase. The tools derive `task_id` from the calling Harness session, reject unknown work units and illegal ordering, and do not authorize code or other tools by themselves. On Gate `RETRY`, engineering stays `PASS`: reteach the recorded gaps, create a replacement Deliver, and ask a new equivalent Gate. Do not start a code revision unless engineering evidence also failed or the implementation changed.

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
- Store metadata, references, result codes, counts, and digests by default—not source, full tool arguments/results, secrets, Gate free-text answers, or Plan revision/replan prose.
- Native Plan revision feedback is transient to the current model turn; durable evidence records only the review decision, Plan reference, and user-message boundary metadata needed for recovery.
- `plan.reopened` proves that a fresh explicit user replan request was observed but does not persist that request's prose; the rejected Plan remains historical evidence.
- If implementation changes after Deliver, invalidate its reference, verify again, create a new Deliver, then reopen Gate.
- Keep tool authorization separate from delegation and learning status. The host pre-execute policy enforces only the lifecycle write boundary; normal Harness approvals and sandbox policy still apply.
- Use the host runtime for execution, approval, persistence, and recovery. Do not create a second agent loop.

## Finish

Report both `engineering_status` and `learning_status`. Include unresolved targets and evidence limitations. Use [knowledge-report.md](assets/knowledge-report.md) when a host does not generate a report automatically.
