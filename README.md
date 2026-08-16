# AI Coding Learning Loop

AI Coding Learning Loop is a learning-aware delegation and teach-back system
for AI-assisted software development. It lets a
user choose how much implementation to keep, requires the agent to teach the
verified result during Deliver, and records engineering and learning outcomes
separately.

The first host adapter targets DeepSeek Harness. The portable contracts do not
depend on a particular agent runtime.

Current status: product contracts are frozen. The H0 host-compatibility unit
ships an observation-only DeepSeek Harness bundle; it does not yet persist
learning evidence or enforce learning gates.

## Try the Harness bundle

The package follows DeepSeek Harness's out-of-tree bundle convention: its
manifest declares `dsh.bundle.patch`, and that patch inserts the plugin row.
From a checkout next to an installed Harness CLI:

```bash
dsh plugin --profile demo add ./ai-coding-learning-loop
dsh --profile demo --dump-config
dsh --profile demo
```

H0 listens at two official tool lifecycle seams:

- `tools/pre-execute`: records a minimal summary, then always calls `next()`
  and returns the exact downstream decision.
- `tools/result`: records a minimal summary of Harness's immutable final
  outcome.

The probe is bounded in memory, excludes tool arguments and result content,
and is cleared when the plugin unloads. It proves host compatibility only;
it must not be treated as the durable evidence ledger planned for later work.

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
