# Install and remove

## For users: install once, then start normally

The supported first target is DeepSeek Harness `0.1.0-rc.5` at commit
`47f943859bef60e4160492346772ded9b24f765a`.

You do **not** need to clone or build the DeepSeek Harness repository. Install
the source-preview bundle into Harness's built-in `web` profile once:

```bash
npx @deepseek-ai/dsh plugin --profile web add github:SeRendizc/ai-coding-learning-loop#25c9e75d18a925938a7f8bd737b1caab46295cc3
```

Then start Harness as usual:

```bash
npx @deepseek-ai/dsh web
```

Open `http://127.0.0.1:3080`, configure the Provider in Harness if needed, and
run `/ownership start`. Review the proposed
Learning Contract and accept it only when the ownership split and Gate target
match what you want to learn.

The commit reference above makes the source preview immutable. The public
release will replace it with the versioned npm package
`dsh-ai-coding-learning-loop@0.1.0-alpha.0`. Harness's official plugin command
performs the profile installation; this package has no install-time build
script or separate workspace setup.

The bundle also registers the packaged `ai-coding-learning-loop` Skill through
Harness's `ctx.skills` runtime seam. It remains discoverable by the model and
directly invocable by the user; its reference files resolve from the package's
own Skill directory. A project-local `.dsh/skills/ai-coding-learning-loop`
copy may intentionally override the bundled runtime registration.

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
