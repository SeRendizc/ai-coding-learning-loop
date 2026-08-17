# Evidence contract

Events use `ai-coding-learning-loop.event.v1`. Every event contains a task-local sequence, timestamp, actor, work-unit reference, sorted references, redacted payload, payload SHA-256, previous-event hash, and event hash.

The file backend publishes one immutable JSON file per event using write–sync–rename. Readers verify sequence continuity, task identity, filename binding, payload digest, event digest, and the previous-event chain before reducing state.

Snapshots use `ai-coding-learning-loop.snapshot.v1` and bind `as_of_seq`, the corresponding event hash, and a state digest. Invalid snapshots fall back to full replay.

Default redaction replaces keys associated with answers, credentials, prompts, secrets, tokens, content, and authorization with `{redacted, digest}`. A syntactically valid SHA-256 value under a `*_sha256` key remains queryable; the corresponding raw value is never reconstructed or stored. Domain code should still avoid passing unnecessary sensitive data to the ledger.

The backend currently fails closed on cross-process append contention instead of silently merging or renumbering competing facts.
