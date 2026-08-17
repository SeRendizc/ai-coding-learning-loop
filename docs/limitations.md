# Limitations

- The first release targets one work unit at a time and does not schedule parallel units.
- Gate semantic grading is supplied by a verifier; the core validates the result and evidence structure but cannot prove the verifier is correct.
- Knowledge Debt counts missing agreed evidence. It is not a cognitive score.
- SHA-256 proves binding and change detection, not correctness, authorship, or understanding.
- The sidecar is not DeepSeek Harness native Session state and currently has no cross-process locking protocol.
- Tool observations are diagnostic and in-memory; learning facts are the durable domain events.
- Headless environments cannot collect interactive Learning Contracts or Gates without another verified human-input provider.
- The comparison fixtures demonstrate deterministic protocol behavior, not measured human learning outcomes.
- The lifecycle Tool is verified through the real Harness registry without a Provider call. A Provider-backed interactive user journey remains a release activity.
- npm publication and external-user validation remain release activities.
