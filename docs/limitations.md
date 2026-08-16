# Limitations

- The first release targets one work unit at a time and does not schedule parallel units.
- Gate semantic grading is supplied by a verifier; the core validates the result and evidence structure but cannot prove the verifier is correct.
- Knowledge Debt counts missing agreed evidence. It is not a cognitive score.
- SHA-256 proves binding and change detection, not correctness, authorship, or understanding.
- The sidecar is not DeepSeek Harness native Session state and currently has no cross-process locking protocol.
- Tool observations are diagnostic and in-memory; learning facts are the durable domain events.
- Headless environments cannot collect interactive Learning Contracts or Gates without another verified human-input provider.
- The comparison fixtures demonstrate deterministic protocol behavior, not measured human learning outcomes.
- npm publication, external-user validation, and a live Harness end-to-end compatibility run remain release activities.
