# Protocol comparison

This is a deterministic fixture evaluation, not a human-learning benchmark.

| Task | Mode | Engineering | Learning | AI share | Scripted rounds |
|---|---|---:|---:|---:|---:|
| tiny-parser | NO_SKILL | PASS | UNMEASURED | n/a | n/a |
| tiny-parser | GUIDED | PASS | MASTERED | 0.25 | 8 |
| tiny-parser | HUMAN_LED | PASS | MASTERED | 0.45 | 6 |
| tiny-parser | AI_LED | PASS | MASTERED | 0.75 | 4 |
| tiny-parser | DELEGATED | PASS | MASTERED | 1 | 3 |
| protected-repository | NO_SKILL | PASS | UNMEASURED | n/a | n/a |
| protected-repository | GUIDED | PASS | MASTERED | 0.25 | 8 |
| protected-repository | HUMAN_LED | PASS | MASTERED | 0.45 | 6 |
| protected-repository | AI_LED | PASS | MASTERED | 0.75 | 4 |
| protected-repository | DELEGATED | PASS | MASTERED | 1 | 3 |
| kv-cache | NO_SKILL | PASS | UNMEASURED | n/a | n/a |
| kv-cache | GUIDED | PASS | MASTERED | 0.25 | 8 |
| kv-cache | HUMAN_LED | PASS | MASTERED | 0.45 | 6 |
| kv-cache | AI_LED | PASS | MASTERED | 0.75 | 4 |
| kv-cache | DELEGATED | PASS | MASTERED | 1 | 3 |

## Limits

- PASS answers are scripted fixtures and do not measure a human learner.
- round and implementation-share values are scenario inputs, not observed productivity results.
- use Agent Eval Lab to consume this versioned artifact without importing plugin internals.
