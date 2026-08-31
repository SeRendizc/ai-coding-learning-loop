# AI Coding Learning Loop

[中文](README.zh-CN.md) | **EN**

A DeepSeek Harness plugin for learning while coding with AI. Choose how much of the implementation to delegate, review the plan, and work through an explanation of the finished code. The plugin tracks the code's verification result and your learning progress separately.

The workflow has four implementation modes, from writing the core yourself to delegating all of it. Each mode includes a learning check: explain a design, predict its behavior, or apply it to a changed problem.

> Alpha preview. The tested Harness baseline is `0.1.0-rc.7`; see [compatibility](docs/compatibility.md) for the full version and test matrix.

## Installation

Requires Node.js `^22.19.0 || >=24.0.0`, pnpm, and the tested DeepSeek Harness version.

```bash
dsh plugin --profile web add "github:SeRendizc/ai-coding-learning-loop#agent/h0-harness-compatibility"
dsh web
```

Use the same `dsh` executable for both commands. Open `http://127.0.0.1:3080`, configure a model provider, and start a new session. The install target is a mutable preview branch; [installation details](docs/install.md) include pinned commands, isolated profiles, and removal.

## Usage

```text
/ownership start
```

The plugin asks for a learning target, an implementation mode, and your current experience. After you confirm the learning contract, the agent reads the conversation and workspace and proposes a plan. If you already requested a coding task, that task carries into the plan.

Review the task, implementation steps, tests, and learning anchors before approving it. The agent can then implement according to the selected mode. Once the code is verified, it explains the design and asks you to demonstrate your understanding. If an answer needs more work, the workflow returns to teaching before another attempt.

```text
Learning contract -> Plan review -> Build -> Verify -> Teach -> Learning check
```

Use `/ownership status` to see where the task stands, or `/ownership report` to generate a report. A passing code test and a completed learning check appear as separate results.

## Implementation modes

| Mode | AI work | Your work | Learning check |
|---|---|---|---|
| `GUIDED` | Planning, explanations, and review | Core implementation | Explain |
| `HUMAN_LED` | Scaffolding and selected code | Core methods and data flow | Explain + Predict |
| `AI_LED` | Most implementation and verification | Review and modify a learning anchor | Explain + Predict + Apply |
| `DELEGATED` | All implementation and verification | Understand and transfer the design | Explain + Predict + Apply |

Experience level changes the detail of explanations and scaffolding. It does not remove the learning check for the selected mode.

## How it works

The learning contract establishes the goal and division of work. The implementation plan is approved separately. After a contract is created, the Harness `tools/pre-execute` hook blocks execution-capable tools until the workflow reaches an implementation phase; read-only exploration remains available. Harness permissions and sandbox rules still apply.

A learning check refers to a specific explanation and implementation revision. If the implementation changes, it must be verified and explained again before opening a new check.

Learning events are stored in a sidecar ledger. Reports and snapshots are derived from those events, and recovery replays the ledger when a snapshot is invalid. By default, it stores references and digests rather than source code, full tool payloads, or free-text learner answers. See [architecture](docs/architecture.md), [workflow](docs/workflow.zh-CN.md), and [privacy](docs/privacy.md) for details.

## Development

The portable core and its demo can run without Harness or a model provider:

```bash
git clone https://github.com/SeRendizc/ai-coding-learning-loop.git
cd ai-coding-learning-loop
npm run check
npm run demo -- .local-test/comparison
```

The demo writes a Markdown/JSON comparison of three tasks across the four modes and a no-skill baseline. These are scripted protocol fixtures, with `empirical_human_study: false`, rather than measurements of learning outcomes.

For full local Harness integration checks, run `npm run test:local`; setup and requirements are in [local testing](docs/local-testing.md).

The current release handles one work unit at a time. Semantic grading depends on a verifier, and the evidence store has no cross-process locking. Tool classification uses name patterns, so new third-party tools may need explicit support. Provider-backed Web acceptance and external-user feedback remain on the [release checklist](docs/release-checklist.md). See [limitations](docs/limitations.md) before extending the adapter.

Related experiments: [Agent Runtime Lab](https://github.com/SeRendizc/agent-runtime-lab) studies persistent tool execution, and [Agent Eval Lab](https://github.com/SeRendizc/agent-eval-lab) investigates model-interface behavior.
