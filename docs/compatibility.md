# DeepSeek Harness compatibility

Verified target:

- Harness package: `0.1.0-rc.7`
- Commit: `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`
- Node: `^22.19.0 || >=24.0.0`

Verified from the pinned source contract and adapter tests:

- `dsh.bundle.patch` package shape;
- `tools/pre-execute` waterfall delegation plus an Ownership deny policy for side-effectful tools outside implementation phases;
- synchronous immutable `tools/result` observation;
- Cordis effect-owned listener cleanup;
- Cordis Standard Schema v1 configuration validation and defaults;
- optional `commands` + `userQuestions` composition;
- optional `skills` composition with a packaged runtime Skill and resource base;
- `Agent.followup()` for Contract → Agent-turn continuation;
- stable question IDs and explicit Learning Contract confirmation;
- native `plan-review` intent for the separate implementation Plan;
- tool-internal Plan Review must let Harness bind the current live interaction rather than forwarding a non-live `exec.agent` identity.

Verified by the current PR-head automation for `925e784e71104e3058818ae171db363c32d09388`:

- cross-platform repository regression: PASS;
- pinned Harness live acceptance: PASS (`pinned-harness-live` run `32061432724`);
- Windows full local acceptance: PASS (`windows-local-acceptance` run `32061432779`);
- official profile installation and composed-profile discovery;
- actual Cordis, System Prompt, Tools, Commands, User Questions, and Skills services;
- model-facing `ownership_lifecycle` registration;
- authoritative contract context returned by lifecycle `status`;
- strict Plan tool schema;
- Brief → Planning → Plan Review → Build → Verify → Deliver → Gate lifecycle;
- restart-safe sidecar recovery and effect-owned Fiber cleanup, including Tool removal.

The provider-free live workflow validates the real Harness service and plugin seams without making an LLM Provider call. The fresh Web UX still requires manual Provider-backed visual acceptance of automatic continuation and the Plan Review card before release.

Not yet claimed:

- a fully Provider-backed interactive model journey on the current UX revision;
- native/MCP/Code Mode nested-hook coverage across a live model run;
- native custom Session Event reload or Session Projection integration;
- proof that the current name-based read-like Tool classifier covers every future Harness Tool/plugin naming convention.

The current evidence-backend decision is `sidecar-file-v1`. It avoids depending on an unverified Developer Preview persistence extension and labels the boundary in reports. Plan review channel and revision prose are deliberately not durable evidence; the ledger records only the decision and `plan_ref`.

## Version policy

Compatibility is release-based, not commit-chasing:

- the immutable rc.7 commit above is the blocking last-known-good baseline;
- pull requests, manual runs, and a weekly schedule resolve the latest published `dsh-v*` release and execute the same live lifecycle as a non-blocking canary;
- arbitrary upstream `master` commits are not advertised as supported;
- code changes are required only when a released Harness breaks a public seam used by this adapter. A canary PASS may extend the tested-release matrix without changing the adapter.

This keeps existing users reproducible while providing early warning of a released incompatibility.
