# Ownership policy

| Mode | AI work | Human work | Minimum Gate |
|---|---|---|---|
| `GUIDED` | Analyze, plan, teach, review, suggest tests | Core design and implementation | Explain |
| `HUMAN_LED` | Scaffold, interfaces, mechanical code, test drafts | Core methods and data flow | Explain + Predict |
| `AI_LED` | Most architecture, code, tests, and fixes | Predict, review, modify a learning anchor | Explain + Predict + Apply |
| `DELEGATED` | All implementation and verification, followed by teaching | Understand and transfer the mechanism | Explain + Predict + Apply |

Choose per work unit using learning value, available time, reversibility, and prior knowledge. Mode never grants tool permission. File deletion can still require runtime approval in `DELEGATED`; read-only tests may run automatically in `GUIDED`.

Any ownership change requires an explicit contract revision. Never replace a human-owned implementation merely because AI is faster.
