# Install and remove

## DeepSeek Harness bundle

The supported first target is DeepSeek Harness `0.1.0-rc.5` at commit
`47f943859bef60e4160492346772ded9b24f765a`.

```bash
git clone https://github.com/SeRendizc/ai-coding-learning-loop.git
cd ai-coding-learning-loop
npm test
dsh plugin --profile learning add "$PWD"
dsh --profile learning --dump-config
dsh --profile learning
```

Inside an interactive session, run `/ownership start`. Review the proposed
Learning Contract and accept it only when the ownership split and Gate target
match what you want to learn.

Evidence defaults to `.ai-coding-learning-loop/evidence`. Change
`evidenceRoot` in the inserted bundle configuration when the working directory
is temporary or shared.

Remove the bundle with the Harness plugin command shown by `dsh plugin --help`
for the installed release, then delete the sidecar evidence directory only if
its audit history is no longer required.

## Portable core

Until the first npm release, import the repository checkout through a local
package reference. The public subpath exports are `contracts`, `core`,
`evidence`, `session`, and `report`.

The CLI can initialize a task from a Learning Contract and inspect evidence
without Harness:

```bash
node bin/ownership.mjs init fixtures/learning-contracts/tiny-parser.json ./evidence
node bin/ownership.mjs status tiny-parser ./evidence
node bin/ownership.mjs report tiny-parser ./evidence ./knowledge-report.md
```

There is no evidence-schema migration promise before stable `1.0`. Pin the
package version and retain original events before upgrading.
