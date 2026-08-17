# User journeys

Every journey starts by separating the **coding task** from the **learning target**. `/ownership start` asks what should be built or changed and what the learner wants to understand or apply afterward. After those answers make the locale observable, Harness presents localized responsibility and expertise choices, then a readable Learning Contract. Accepting the Contract automatically queues the next Agent turn; it does not approve implementation.

The Skill calls `ownership_lifecycle status` to recover the authoritative contract context, records Brief and Planning, and submits a separate Plan. Interactive Harness sessions receive a native Plan Review card. `APPROVE` permits Build; `REVISE` returns to Planning. The host pre-execute policy denies side-effectful or execution-capable tools outside implementation phases, so Plan approval is not merely a prompt convention.

## Deep learning

Choose `GUIDED`. The AI discovers and plans, briefs the core mechanism, and reviews; the learner implements the core code. Gate emphasizes explaining the implementation actually written.

## Human-led balance

Choose `HUMAN_LED`. The AI writes scaffolding and test drafts while the learner owns core methods. Gate adds prediction of a changed input or failure.

## AI-led acceleration

Choose `AI_LED`. The AI writes most code, but the learner predicts behavior, reviews learning anchors, and applies one small variant. Plan Review makes the intended implementation and learning anchors visible before the AI is allowed to build.

## Full delegation with learning

Choose `DELEGATED`. The AI implements and verifies everything after Plan approval, then performs a complete teaching Deliver. The learner must still explain, predict, and apply. Reports warn that implementation-detail familiarity may remain weaker.

After Build, every journey follows Verify → Deliver → Gate. The user answers Gate questions directly; self-attestation is not learning evidence. `/ownership status` displays derived state and `/ownership report` displays separate engineering and learning outcomes. Plan revision prose and Gate free-text answers are not copied into durable evidence.
