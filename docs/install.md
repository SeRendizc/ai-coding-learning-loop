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

The current onboarding is intentionally staged:

1. state the **coding task** in one sentence: what should be built or changed;
2. state the **learning target** in one sentence: what you want to understand or apply afterward;
3. after those answers make the locale observable, choose the localized responsibility split and current expertise;
4. review the human-readable Learning Contract summary and explicitly accept it.

Contract acceptance does not authorize implementation. The plugin immediately
queues a normal Harness follow-up turn through `Agent.followup()`. The model
reads the authoritative contract context through `ownership_lifecycle status`,
records Brief and Planning, and submits a separate Plan. You should not need to
type “continue” or repeat the task.

In an interactive Harness session, `submit_plan` opens a native Plan Review UI
containing the Plan's implementation steps, verification plan, learning
anchors, and known risks. Approve it to permit Build, or request a revision and
optionally add feedback. Revision prose is used only in the current interaction;
the durable evidence stores only the Plan decision and `plan_ref`. If the host
has no interactive question provider, the plugin falls back to explicit direct
message approval.

Once a Learning Contract exists, the plugin also enforces the Plan boundary at
`tools/pre-execute`: discovery/read-like tools remain available, but
side-effectful or execution-capable tools are denied outside `BUILDING`,
`VERIFYING`, and `REVISING`. Harness's normal permission, approval, and sandbox
checks remain in force as well.

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

If the isolated install succeeds, the plugin is sound and the original
profile needs inspection rather than another reinstall. Keep the full command
output when reporting a failure; the phase that failed (`pnpm`, package fetch,
profile patch, or Harness boot) determines the fix.

For a first real task:

1. open a new Web session and run `/ownership start`;
2. enter one concise coding task and one concise learning target;
3. choose the responsibility split and expertise level on the localized second screen;
4. inspect and explicitly accept the readable Learning Contract;
5. wait for the automatically queued Agent turn; do not repeat the task manually;
6. inspect the native Plan Review. Request a revision if needed; implementation remains blocked until approval;
7. after approval, let the Skill implement according to the ownership split, verify, teach the Deliver, and open the Gate;
8. answer the Gate yourself rather than asking the model to answer for you; self-attestation cannot produce PASS;
9. use `/ownership status` or `/ownership report` to inspect the separate engineering and learning results.

`ownership_lifecycle` is an internal model tool. Users should not synthesize
its calls or edit evidence files to advance the state. The model-facing
`status` action already returns the accepted coding task, ownership, learner
profile, work units, Gate policy, and current Plan context, so the Skill should
never search the private evidence directory to rediscover the contract.

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
