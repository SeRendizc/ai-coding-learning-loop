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
- stable question IDs and explicit contract confirmation.

Not yet claimed:

- a complete upstream workspace boot in this environment;
- native/MCP/Code Mode nested-hook coverage across a live model run;
- native custom Session Event reload or Session Projection integration;
- Web/headless parity.

The current evidence-backend decision is therefore `sidecar-file-v1`. It avoids depending on an unverified Developer Preview persistence extension and labels the boundary in reports. Run `npm run verify:harness` whenever the pinned checkout changes.
