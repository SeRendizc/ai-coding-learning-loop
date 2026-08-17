# Local testing (maintainers only)

Ordinary users should follow [Install and remove](install.md). They do not need
a DeepSeek Harness source checkout or any of the commands on this page.

## Full local acceptance: one command

Prerequisites are Git, Node.js `24.x` (or `22.19+`), npm, and network
access on the first run. From this repository run:

```bash
npm run test:local
```

That command performs the complete local acceptance:

1. runs the repository tests and reproduces the evaluation artifacts;
2. checks both Harness smoke scripts for syntax;
3. clones the exact supported Harness commit into `.local-test/` when absent;
4. runs the locked `pnpm@11.7.0` through npm and installs the workspace;
5. installs this checkout through the official `web` profile command;
6. dumps and checks the composed profile;
7. exercises real Cordis, System Prompt, Tools, Commands, User Questions, and
   Skills services, including one real Tool execution and ledger recovery;
8. verifies `result: PASS` and `provider_call_performed: false`;
9. performs `npm pack --dry-run` to check the release contents.

The supported Harness revision is
`47f943859bef60e4160492346772ded9b24f765a`; the orchestrator rejects a different
revision instead of silently testing moving upstream code.

The first run is intentionally slower because it fetches and installs the
pinned Harness workspace. Later runs reuse `.local-test/deepseek-harness` and
the package-manager cache. Windows, PowerShell, cmd, Bash, and WSL use the same
npm command; the Node orchestrator handles paths and child processes.

Generated evidence is written under `.local-test/`:

- `composed-config.yml` — the effective `web` profile;
- `harness-live-report.json` — the provider-free acceptance report;
- `evidence/` — disposable smoke evidence;
- `dsh-home/` — the isolated local Harness profile.

## Faster checks while editing

For a quick provider-free repository regression without cloning or booting the
Harness source tree:

```bash
npm run check:local
```

To verify a particular existing Harness checkout explicitly:

```bash
npm run verify:harness -- /path/to/deepseek-harness
```

The path after `--` is honored on every platform. This source-contract check
does not replace the full `npm run test:local` acceptance.

## Optional interactive journey

After full acceptance passes, use the ordinary user path:

```bash
npx @deepseek-ai/dsh web
```

Run `/ownership start`, accept a Learning Contract, inspect the separate
engineering and learning states with `/ownership status`, complete a
Deliver/Gate cycle, and inspect `/ownership report`. This may call the Provider
configured in Harness; the automated acceptance above never does.

Do not commit Provider keys or `.local-test/`. A local PASS proves host
compatibility, not real learning effectiveness; that requires an actual user
study.

## Cleanup

`.local-test/` is disposable because the orchestrator puts only isolated test
data there. Do not delete `.ai-coding-learning-loop/` from a real project unless
its audit history is intentionally no longer needed.
