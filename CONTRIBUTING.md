# Contributing

Contributions should preserve the project's central distinction: engineering
success and learning transfer are different claims.

Before opening a pull request, run `npm run check`. Add reducer and recovery
tests for every lifecycle change. New persisted fields require a schema-version
decision and privacy review. Never include real prompts, source code, tool
outputs, credentials, or learner answers in fixtures.

Provider- or host-specific behavior belongs in an adapter. Portable contracts,
events, and reports must not import a host runtime. Claims about learning gains
require external study evidence; deterministic fixtures may only claim protocol
behavior.
