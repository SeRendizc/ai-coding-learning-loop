# Evidence policy

Use versioned, append-only events for accepted contracts, work-unit transitions, verification, Deliver, Gate questions/answers/evaluations, gaps, mastery, and closure.

Each event needs stable task/event identity, sequence, timestamp, actor, work unit, references, previous-event hash, payload digest, and a privacy-safe payload. Persist answer digests and rubric results, not free-text answers.

Snapshots must bind an exact verified event prefix. On invalid snapshot schema, sequence, anchor, state digest, or event chain, discard the snapshot and replay original events. Never infer original facts from a formatted trace or report.

Digests prove that bound bytes did not change. They do not prove correctness, authorship, source trust, or understanding.

Reports must state the evidence backend. A sidecar ledger is a plugin fact store, not the Harness Runtime's native state.
