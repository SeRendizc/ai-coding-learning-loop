import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const text = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const json = async path => JSON.parse(await text(path))

test('four public presets express distinct ownership modes', async () => {
  const expected = new Map([
    ['guided.yml', 'GUIDED'],
    ['human-led.yml', 'HUMAN_LED'],
    ['ai-led.yml', 'AI_LED'],
    ['delegated.yml', 'DELEGATED'],
  ])
  for (const [file, mode] of expected) {
    assert.match(await text(`presets/${file}`), new RegExp(`mode: ${mode}`))
  }
})

test('public skill has a valid minimal frontmatter contract', async () => {
  const skill = (await text('skills/ai-coding-learning-loop/SKILL.md')).replace(/\r\n?/gu, '\n')
  assert.match(skill, /^---\nname: ai-coding-learning-loop\ndescription: .+\n---\n/)
  assert.match(skill, /Deliver completely/)
  assert.match(skill, /Gate transfer/)
})

test('comparison artifact covers every task and baseline plus four modes', async () => {
  const report = await json('evaluation/comparison-report.json')
  assert.equal(report.schema_version, 'ai-coding-learning-loop.comparison.v1')
  assert.equal(report.empirical_human_study, false)
  assert.equal(report.rows.length, report.tasks.length * 5)
  for (const task of report.tasks) {
    assert.deepEqual(
      report.rows.filter(row => row.task_id === task).map(row => row.mode).sort(),
      ['AI_LED', 'DELEGATED', 'GUIDED', 'HUMAN_LED', 'NO_SKILL'],
    )
  }
})

test('release metadata remains public and learning-oriented', async () => {
  const manifest = await json('package.json')
  assert.equal(manifest.private, undefined)
  assert.match(manifest.description, /Learning-aware/)
  assert.ok(manifest.files.includes('skills'))
  assert.ok(manifest.files.includes('evaluation'))
})

test('pinned Harness live acceptance is reproducible and provider-free', async () => {
  const workflow = await text('.github/workflows/harness-live.yml')
  const script = await text('scripts/live-harness-smoke.mjs')
  const schema = await json('evaluation/harness-live-report.schema.json')
  assert.match(workflow, /47f943859bef60e4160492346772ded9b24f765a/)
  assert.match(workflow, /plugin --profile learning add/)
  assert.match(script, /provider_call_performed: false/)
  assert.match(script, /packages\/core\/system-prompt\/src\/index\.ts/)
  assert.equal(schema.properties.provider_call_performed.type, 'boolean')

  const report = await json('evaluation/harness-live-report.json')
  assert.equal(report.result, 'PASS')
  assert.equal(report.upstream.commit, '47f943859bef60e4160492346772ded9b24f765a')
  assert.equal(report.provider_call_performed, false)
  assert.match(report.artifact.digest, /^sha256:[a-f0-9]{64}$/)
})

test('local testing keeps disposable evidence and credentials out of Git', async () => {
  const ignore = await text('.gitignore')
  const guide = await text('docs/local-testing.md')
  const install = await text('docs/install.md')
  const orchestrator = await text('scripts/local-harness-acceptance.mjs')
  const manifest = await json('package.json')
  assert.match(ignore, /^\.ai-coding-learning-loop\/$/m)
  assert.match(ignore, /^\.local-test\/$/m)
  assert.match(ignore, /^\.env$/m)
  assert.doesNotMatch(ignore, /^\.dsh\/$/m)
  assert.match(guide, /provider_call_performed: false/)
  assert.match(guide, /47f943859bef60e4160492346772ded9b24f765a/)
  assert.match(guide, /npm run test:local/)
  assert.match(guide, /maintainers only/i)
  assert.match(install, /plugin --profile web add github:/)
  assert.doesNotMatch(install, /git clone https:\/\/github\.com\/deepseek-ai\/deepseek-harness/)
  assert.match(orchestrator, /--profile', 'web'/)
  assert.match(orchestrator, /provider_call_performed/)
  assert.match(orchestrator, /pnpm@11\.7\.0/)
  assert.match(orchestrator, /pnpm\.cjs/)
  assert.match(orchestrator, /packageManagerBin/)
  assert.match(orchestrator, /delimiter/)
  assert.match(orchestrator, /pathToFileURL\(pluginRoot\)\.href/)
  assert.match(orchestrator, /'add', pluginSpec/)
  assert.doesNotMatch(orchestrator, /'add', pluginRoot/)
  assert.doesNotMatch(orchestrator, /npmCli,\s*'exec'/)
  assert.doesNotMatch(orchestrator, /shell:\s*true/)
  assert.equal(manifest.scripts['verify:harness'], 'node scripts/verify-harness.mjs')
  assert.match(manifest.scripts['test:local'], /test:harness:local/)
})

test('executable file URLs use platform-native paths', async () => {
  const cliTest = await text('test/cli.test.mjs')
  const evaluationVerifier = await text('scripts/verify-evaluation.mjs')
  for (const source of [cliTest, evaluationVerifier]) {
    assert.match(source, /fileURLToPath/)
    assert.doesNotMatch(source, /\.pathname/)
  }
  assert.match(evaluationVerifier, /normalizeLineEndings/)
})

test('CI exercises local checks on both Linux and Windows', async () => {
  const workflow = await text('.github/workflows/ci.yml')
  const windowsAcceptance = await text('.github/workflows/windows-local.yml')
  assert.match(workflow, /ubuntu-latest/)
  assert.match(workflow, /windows-latest/)
  assert.match(workflow, /npm run check:local/)
  assert.match(windowsAcceptance, /windows-latest/)
  assert.match(windowsAcceptance, /working-directory: workspace with spaces/)
  assert.match(windowsAcceptance, /npm run test:local/)
})
