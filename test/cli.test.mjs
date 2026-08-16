import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('portable CLI initializes and recovers a fixture contract', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ownership-cli-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const contract = new URL('../fixtures/learning-contracts/tiny-parser.json', import.meta.url).pathname
  const cli = new URL('../bin/ownership.mjs', import.meta.url).pathname
  const accepted = execFileSync(process.execPath, [cli, 'init', contract, root], { encoding: 'utf8' })
  assert.equal(accepted, 'accepted tiny-parser\n')
  const state = JSON.parse(execFileSync(process.execPath, [cli, 'status', 'tiny-parser', root], { encoding: 'utf8' }))
  assert.equal(state.phase, 'CONTRACTED')
  assert.equal(state.engineering_status, 'PENDING')
  assert.equal(state.learning_status, 'UNTAUGHT')
})
