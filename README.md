# AI Coding Learning Loop

AI Coding Learning Loop is a learning-aware delegation and teach-back system
for AI-assisted software development. It lets a
user choose how much implementation to keep, requires the agent to teach the
verified result during Deliver, and records engineering and learning outcomes
separately.

The first host adapter targets DeepSeek Harness. The portable contracts do not
depend on a particular agent runtime.

Current status: product contracts are frozen and the DeepSeek Harness
compatibility spike has started. This local scaffold is not yet published.

## Delegation modes

- `GUIDED`: the learner implements the core code.
- `HUMAN_LED`: AI supplies scaffolding; the learner owns core methods.
- `AI_LED`: AI implements most code; the learner owns selected learning anchors.
- `DELEGATED`: AI implements everything; the learner must still pass transfer-oriented teaching gates.

## Lifecycle

`DISCOVER → CONTRACTED → BRIEFED → BUILDING → VERIFYING → DELIVERING → AWAITING_GATE → CLOSED`

Engineering verification failure returns to implementation. Learning-gate
failure returns to Deliver for targeted reteaching and does not erase an
already-passing engineering result.

## Development

```bash
npm test
npm run verify:harness
```

The Harness verification command checks the exact upstream commit and package
contract recorded in `compatibility/upstream-lock.json`.
