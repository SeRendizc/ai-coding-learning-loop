# Local testing

Use three layers. Layers 1 and 2 require no model API key. Layer 3 is an
optional interactive check and uses whatever Provider the local Harness
profile is already configured to use.

## Prerequisites

- Git;
- Node.js `24.x` (or `22.19+`);
- Corepack with pnpm `11.7.0` for the pinned Harness workspace.

Keep the plugin and Harness as sibling directories:

```text
workspace/
├── ai-coding-learning-loop/
└── deepseek-harness/
```

## Layer 1: repository regression

From `ai-coding-learning-loop`:

```bash
npm run check:local
npm run verify:harness -- ../deepseek-harness
npm pack --dry-run
```

Expected results:

- all Node tests pass;
- the evaluation artifacts reproduce byte-for-byte;
- the pinned Harness version, commit, package shape, and adapter seams match;
- the package dry-run contains no local evidence, profile, credential, or
  dependency directories.

`verify:harness` is a source-contract check. It does not boot Harness, so run
Layer 2 before claiming live compatibility.

## Layer 2: isolated pinned-Harness smoke

First prepare the exact supported upstream checkout:

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git checkout 47f943859bef60e4160492346772ded9b24f765a
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install --frozen-lockfile
```

### Bash / WSL

Run from the `deepseek-harness` directory:

```bash
export PLUGIN_ROOT="$(cd ../ai-coding-learning-loop && pwd)"
export DSH_HOME="$PLUGIN_ROOT/.local-test/dsh-home"

pnpm dsh plugin --profile learning add "$PLUGIN_ROOT"
pnpm dsh --profile learning --dump-config \
  > "$PLUGIN_ROOT/.local-test/composed-config.yml"

node --import tsx/esm \
  "$PLUGIN_ROOT/scripts/live-harness-smoke.mjs" \
  "$PWD" \
  "$PLUGIN_ROOT/.local-test/evidence" \
  "$PLUGIN_ROOT/.local-test/harness-live-report.json"
```

### PowerShell

Run from the `deepseek-harness` directory:

```powershell
$PluginRoot = (Resolve-Path ..\ai-coding-learning-loop).Path
$env:DSH_HOME = Join-Path $PluginRoot ".local-test\dsh-home"

pnpm dsh plugin --profile learning add $PluginRoot
New-Item -ItemType Directory -Force (Join-Path $PluginRoot ".local-test") | Out-Null
pnpm dsh --profile learning --dump-config |
  Set-Content -Encoding utf8 (Join-Path $PluginRoot ".local-test\composed-config.yml")

node --import tsx/esm `
  (Join-Path $PluginRoot "scripts\live-harness-smoke.mjs") `
  $PWD.Path `
  (Join-Path $PluginRoot ".local-test\evidence") `
  (Join-Path $PluginRoot ".local-test\harness-live-report.json")
```

The report must say `result: PASS` and `provider_call_performed: false`. This
smoke verifies the real Cordis, System Prompt, Tools, Commands, User Questions,
and Skills services; observes one real Tool execution; restores the accepted
contract through a fresh ledger; and verifies Fiber-owned cleanup.

## Layer 3: optional interactive user journey

This layer is the user-facing test. It is separate because it may call the
Provider configured in the isolated `learning` profile.

```bash
pnpm dsh --profile learning
```

Inside Harness:

1. run `/ownership start`;
2. choose a delegation mode and a concrete learning target;
3. inspect and accept the Learning Contract;
4. run `/ownership status` and confirm engineering and learning states are
   shown separately;
5. after a Deliver/Gate cycle, run `/ownership report`;
6. restart Harness with the same `DSH_HOME` and confirm the accepted contract
   and learning evidence are still readable.

Do not commit Provider keys or `.local-test/`. A Layer 2 PASS proves host
compatibility, not real learning effectiveness; that still requires an actual
user study.

## Cleanup

`.local-test/` is disposable because this guide puts only isolated test data
there. Do not delete `.ai-coding-learning-loop/` from a real project unless its
audit history is intentionally no longer needed.
