# Limitations

- The first release targets one work unit at a time and does not schedule parallel units.
- Gate semantic grading is supplied by a verifier; the core validates the result and evidence structure but cannot prove the verifier is correct.
- Knowledge Debt counts missing agreed evidence. It is not a cognitive score.
- SHA-256 proves binding and change detection, not correctness, authorship, or understanding.
- The sidecar is not DeepSeek Harness native Session state and currently has no cross-process locking protocol.
- Tool observations are diagnostic and in-memory; learning facts are the durable domain events.
- The Plan execution boundary is host-enforced after a contract exists, but the current read-like Tool classification is based on stable Tool-name patterns. New third-party Tool naming conventions may require explicit classification before they are allowed during Contract/Planning phases.
- Headless environments cannot show the native interactive Contract or Plan Review UI; Plan review falls back to a verified direct-message path when no interaction provider exists.
- Plan revision prose and Gate free-text answers are intentionally not persisted, so later reports can prove that a user response/review occurred but cannot reconstruct its wording.
- The comparison fixtures demonstrate deterministic protocol behavior, not measured human learning outcomes.
- The lifecycle Tool and current Plan Review interaction seam are verified through the real pinned Harness registry without an LLM Provider call. A fresh Provider-backed Web journey remains a release activity.
- npm publication and external-user validation remain release activities.
