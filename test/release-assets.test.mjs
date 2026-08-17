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
  const skill = await text('skills/ai-coding-learning-loop/SKILL.md')
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
