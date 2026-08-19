# User journeys

Every journey starts with the same low-friction contract intake: one learning
target, one responsibility choice, and one expertise choice. The concrete
coding task is proposed inside the separately reviewed Plan, not demanded as a
second free-text onboarding answer.

If the user already described a coding request earlier in the conversation,
the Plan preserves it. If not, the AI may propose a bounded task that fits the
learning target and workspace. In either case, the task becomes authoritative
only after Plan approval.

## Deep learning

Choose `GUIDED`. The AI discovers and plans, teaches, reviews, and suggests
verification; the learner implements the core code. Gate emphasizes explaining
the implementation actually written.

## Human-led balance

Choose `HUMAN_LED`. The AI writes scaffolding and test drafts while the learner
owns core methods and data flow. Gate adds prediction of a changed input or
failure.

## AI-led acceleration

Choose `AI_LED`. The AI writes most architecture, code, tests, and fixes, but
the learner predicts behavior, reviews a learning anchor, and applies one small
variant.

## Full delegation with learning

Choose `DELEGATED`. The AI implements and verifies everything, then performs a
complete teaching Deliver. The learner must still explain, predict, and apply.
Reports may warn that implementation-detail familiarity is weaker.

In every journey, `/ownership start` persists a contract only after explicit
confirmation. Contract acceptance automatically queues a normal Harness turn.
The Skill reads the contract, records a planning Brief, proposes a concrete
coding task plus implementation/verification/learning Plan, and submits it to
Plan Review. `REVISE` returns to Planning. `APPROVE` makes that task and Plan the
current engineering scope and allows Build.

Before approval, the plugin's pre-execute policy keeps side-effectful and
execution-capable tools blocked while allowing read-only discovery. The user
answers Gate questions directly; self-attestation is not learning evidence.
`/ownership status` displays derived state, and `/ownership report` displays
separate engineering and learning outcomes.
