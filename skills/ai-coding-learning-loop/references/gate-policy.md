# Gate policy

## Question types

- `EXPLAIN`: restate the mechanism and why the design exists.
- `PREDICT`: predict a state, output, or failure for a changed input.
- `APPLY`: modify a small variant, select a design, or diagnose a real failure.

## Required binding

Each question must name a stable ID, learning target, taught Deliver topic, exact Deliver/implementation reference, prompt, and observable rubric. Do not ask about untaught details.

## Evaluation

- `PASS`: every required criterion has evidence.
- `RETRY`: a remediable misconception remains; record precise gap codes and reteach.
- `BLOCK`: attempts are exhausted or the user elects to stop; preserve truthful partial status.

Do not accept keywords without causal explanation. After `RETRY`, change the surface example while testing the same target. Never erase engineering PASS because learning evidence is incomplete.
