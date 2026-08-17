# Install and remove

## For users: install once, then start normally

The supported first target is DeepSeek Harness `0.1.0-rc.7` at commit
`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`.

You do **not** need to clone or build the DeepSeek Harness repository. If you
already installed `dsh`, use that same executable for both installation and
startup:

```bash
dsh --version
dsh plugin --profile web add "github:SeRendizc/ai-coding-learning-loop#agent/h0-harness-compatibility"
dsh web
```

For a reproducible baseline without a global installation, pin both commands
to the same verified Harness version:

```bash
npx -y @deepseek-ai/dsh@0.1.0-rc.7 plugin --profile web add "github:SeRendizc/ai-coding-learning-loop#agent/h0-harness-compatibility"
npx -y @deepseek-ai/dsh@0.1.0-rc.7 web
```

Do not install with one `dsh` version and then start the same profile with a
different version. Pre-release Harness versions may migrate or rewrite the
shared profile. Quoting the GitHub package spec also prevents shells from
misreading the branch fragment.

Open `http://127.0.0.1:3080`, configure the Provider in Harness if needed, and
run `/ownership start`.

The onboarding asks one free-text question—what you want to learn—then presents
responsibility and expertise choices. Review the Learning Contract before
accepting it. The Contract intentionally does not require you to invent a
coding task first.

After acceptance, a normal Harness follow-up turn is queued automatically. The
AI reads the conversation and workspace with read-only tools and proposes the
concrete coding task inside the Plan. An earlier direct coding request is
preserved when one exists; otherwise the AI proposes a bounded task aligned to
the learning target. Review that task together with implementation steps,
verification, learning anchors, and risks in the native Plan Review UI. No
implementation is allowed before approval.

The branch reference above is a mutable alpha preview. The public release will
replace it with an immutable version tag or the versioned npm package
`dsh-ai-coding-learning-loop@0.1.0-alpha.0`. Harness's official plugin command
performs the profile installation; this package has no install-time build
script or separate workspace setup.

The bundle also registers the packaged `ai-coding-learning-loop` Skill through
Harness's `ctx.skills` runtime seam. It remains discoverable by the model and
directly invocable by the user; its reference files resolve from the package's
own Skill directory. A project-local `.dsh/skills/ai-coding-learning-loop`
copy may intentionally override the bundled runtime registration.

Harness forwards plugin management to `pnpm`, so `pnpm` must be available on
`PATH`. If `pnpm --version` fails, install the verified package-manager version:

```bash
npm install --global pnpm@11.7.0
```

If an earlier failed install may have left the shared profile inconsistent,
retry once with a clean isolated home. This does not delete the normal Harness
profile:

```bash
# Bash, WSL, or macOS
DSH_HOME="$PWD/.dsh-learning-test" dsh plugin --profile web add "github:SeRendizc/ai-coding-learning-loop#agent/h0-harness-compatibility"
DSH_HOME="$PWD/.dsh-learning-test" dsh web
```

```powershell
# PowerShell
$env:DSH_HOME = "$PWD\.dsh-learning-test"
dsh plugin --profile web add "github:SeRendizc/ai-coding-learning-loop#agent/h0-harness-compatibility"
dsh web
```

For a first real task:

1. open a new Web session and run `/ownership start`;
2. enter one concise learning target;
3. choose responsibility split and current expertise;
4. inspect and explicitly accept the human-readable Learning Contract;
5. let the automatic follow-up inspect conversation/workspace read-only and propose a concrete coding task inside the Plan;
6. inspect the coding task, implementation steps, verification plan, learning anchors, and risks; approve them or request revision;
7. only after Plan approval, let the Skill implement according to the selected ownership split, verify, teach the Deliver, and open the Gate;
8. answer the Gate yourself rather than asking the model to answer for you; self-attestation cannot produce PASS;
9. use `/ownership status` or `/ownership report` to inspect separate engineering and learning results.

`ownership_lifecycle` is an internal model tool. Users should not synthesize
its calls or edit evidence files to advance the state.

Evidence defaults to `.ai-coding-learning-loop/evidence`. Change
`evidenceRoot` in the inserted bundle configuration when the working directory
is temporary or shared.

Remove the preview bundle with:

```bash
npx @deepseek-ai/dsh plugin --profile web remove dsh-ai-coding-learning-loop
```

Delete the sidecar evidence directory only if its audit history is no longer
required.

## Portable core

Until the first npm release, import the repository checkout through a local
package reference. The public subpath exports are `contracts`, `core`,
`evidence`, `session`, and `report`.

The portable pre-alpha Plan v1 core can recover older Plan events without an
`engineering_task`. That is recovery compatibility only: the current Harness
adapter requires every new Plan submission to contain a concrete coding task.

The CLI can initialize a task from a Learning Contract and inspect evidence
without Harness. Keep disposable examples under `.local-test/`:

```bash
node bin/ownership.mjs init fixtures/learning-contracts/tiny-parser.json ./.local-test/evidence
node bin/ownership.mjs status tiny-parser ./.local-test/evidence
node bin/ownership.mjs report tiny-parser ./.local-test/evidence ./.local-test/knowledge-report.md
```

Repository contributors can run the complete pinned-Harness acceptance with
one command; see [local testing](local-testing.md). It is not a user install
requirement.

There is no evidence-schema migration promise before stable `1.0`. Pin the
package version and retain original events before upgrading.
