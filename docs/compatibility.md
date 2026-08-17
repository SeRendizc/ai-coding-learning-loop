# DeepSeek Harness compatibility

Verified target:

- Harness package: `0.1.0-rc.5`
- Commit: `47f943859bef60e4160492346772ded9b24f765a`
- Node: `^22.19.0 || >=24.0.0`

Verified from the pinned source contract and local adapter tests:

- `dsh.bundle.patch` package shape;
- `tools/pre-execute` waterfall delegation through `next()`;
- synchronous immutable `tools/result` observation;
- Cordis effect-owned listener cleanup;
- Cordis Standard Schema v1 configuration validation and defaults;
- optional `commands` + `userQuestions` composition;
- optional `skills` composition with a packaged runtime Skill and resource base;
- stable question IDs and explicit contract confirmation.

Verified live by [pinned Harness run 32039847931](https://github.com/SeRendizc/ai-coding-learning-loop/actions/runs/32039847931):

- installation through the official `dsh plugin --profile learning add` command;
- composed-profile discovery of the bundle;
- actual Cordis, System Prompt, Tools, Commands, User Questions, and Skills services;
- real `tools/pre-execute` and `tools/result` observation;
- model-facing `ownership_lifecycle` registration and a complete durable
  Brief -> Build -> Verify -> Deliver -> Gate transition to `CLOSED / MASTERED`;
- restart-safe sidecar recovery and effect-owned Fiber cleanup, including Tool removal.

Not yet claimed:

- a Provider-backed interactive model run;
- native/MCP/Code Mode nested-hook coverage across a live model run;
- native custom Session Event reload or Session Projection integration;
- Web/headless parity.

The `pinned-harness-live` workflow installs the bundle through the official
profile command, verifies the composed config, and then mounts the plugin on
the pinned Harness's actual Cordis, Tools, Commands, User Questions, and Skills
services. Its artifact includes the composed config, a versioned live report,
and restart-safe sidecar evidence. It deliberately performs no Provider call.
The reviewed report and immutable Artifact digest are committed at
`evaluation/harness-live-report.json`.

The current evidence-backend decision is therefore `sidecar-file-v1`. It avoids depending on an unverified Developer Preview persistence extension and labels the boundary in reports. Run `npm run verify:harness` whenever the pinned checkout changes.
