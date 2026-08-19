# Architecture

AI Coding Learning Loop has four replaceable layers:

1. **Contracts** define delegation, Deliver, Gate, events, and reports without a host dependency.
2. **Core** validates contracts and deterministically reduces accepted events into dual status.
3. **Evidence** stores privacy-safe original learning events in a hash-chained sidecar and treats snapshots as disposable caches.
4. **Host adapters** map commands, questions, one-action lifecycle writes, tool observations, and projections to a specific harness.

The DeepSeek Harness adapter is deliberately thin. Harness still owns the Agent loop, tool registry, approval, sandbox, sessions, and UI. The plugin never turns a learning mode into tool authorization.

## Control flow

```mermaid
flowchart TD
  A["Human command"] --> B["Confirmed contract"]
  B --> C["Host execution"]
  C --> D["Engineering verification"]
  D --> E["Teaching Deliver"]
  E --> F["Bound transfer Gate"]
  F --> G["Dual-status report"]
```

Original events are authoritative for the learning domain. Reports and snapshots are derived. The sidecar identifies itself in every report and is not presented as native Harness session state.

The DeepSeek adapter registers one model-facing `ownership_lifecycle` tool.
It derives the task ID from the current Harness session, is exclusive by
default, validates the existing event projection before appending, and cannot
grant permission to execute any other tool. Gate answer recording requires a
current direct user message from that same session, but persists neither the
message nor a content digest. Gate evaluation remains a separate action so the
response occurrence and rubric verdict have distinct evidence events.
