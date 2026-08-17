import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { requiredGateLevels } from '../src/contracts.mjs'
import { FileEvidenceLedger } from '../src/evidence.mjs'
import { buildLearningReport } from '../src/report.mjs'
import { LearningSession } from '../src/session.mjs'

const MODES = {
  GUIDED: { owner: 'human', ai_share: 0.25, scripted_rounds: 8 },
  HUMAN_LED: { owner: 'human', ai_share: 0.45, scripted_rounds: 6 },
  AI_LED: { owner: 'ai', ai_share: 0.75, scripted_rounds: 4 },
  DELEGATED: { owner: 'ai', ai_share: 1, scripted_rounds: 3 },
}

const tasks = JSON.parse(await readFile(new URL('./tasks.json', import.meta.url), 'utf8'))
const outputRoot = resolve(process.argv[2] ?? fileURLToPath(new URL('../evaluation', import.meta.url)))
const temporaryRoot = await mkdtemp(join(tmpdir(), 'learning-comparison-'))
const rows = []

try {
  let clock = 0
  for (const task of tasks) {
    rows.push({
      task_id: task.id,
      mode: 'NO_SKILL',
      protocol_fixture: true,
      engineering_verification: 'PASS',
      learning_status: 'UNMEASURED',
      ai_implementation_share: null,
      scripted_rounds: null,
      deliver_topic_coverage: null,
      gate_attempts: null,
      warning: 'No learning evidence was collected.',
    })
    for (const [mode, metrics] of Object.entries(MODES)) {
      const taskId = `${task.id}-${mode.toLowerCase()}`
      const ledger = new FileEvidenceLedger(temporaryRoot, {
        now: () => new Date(1723852800000 + clock++ * 1000),
      })
      const session = new LearningSession(ledger)
      const mastery = requiredGateLevels(mode).at(-1)
      const contract = {
        schema_version: 'ai-coding-learning-loop.learning-contract.v1',
        task_id: taskId,
        goal: 'comparison-fixture',
        mode,
        learning_targets: [{ id: task.target_id, mastery, owner: 'human', description: task.target }],
        work_units: [{ id: task.work_unit_id, implementation_owner: metrics.owner }],
        gate: { max_attempts: 3, require_unseen_variant: mastery !== 'EXPLAIN' },
        change_policy: 'explicit-confirmation',
      }
      const deliver = {
        schema_version: 'ai-coding-learning-loop.deliver.v1',
        work_unit_id: task.work_unit_id,
        implementation_ref: task.implementation_ref,
        verification_refs: [task.verification_ref],
        learning_targets: [task.target_id],
        topics_taught: [
          'scope', 'reading-order', 'data-flow', 'design-rationale', 'invariants',
          'failure-paths', 'verification', 'prior-knowledge-link', 'transfer-example', 'known-gaps',
        ],
        examples_used: [`${task.id}-variant`],
        known_gaps: [],
        ready_for_gate: true,
      }
      await session.acceptContract(contract)
      await session.brief(taskId, task.work_unit_id, ['scope', 'invariants'])
      await session.startPlan(taskId, task.work_unit_id)
      await session.submitPlan(taskId, {
        schema_version: 'ai-coding-learning-loop.plan.v1',
        work_unit_id: task.work_unit_id,
        implementation_steps: [`implement ${task.target_id}`],
        verification_plan: [task.verification_ref],
        learning_anchors: [task.target_id],
        known_risks: [],
      })
      await session.recordPlanReview(taskId, 'APPROVE')
      await session.startWork(taskId, task.work_unit_id)
      await session.submitImplementation(taskId, task.work_unit_id, task.implementation_ref)
      await session.recordVerification(taskId, task.work_unit_id, 'PASS', task.implementation_ref, [task.verification_ref])
      await session.completeDeliver(taskId, deliver)
      await session.askGate(taskId, {
        schema_version: 'ai-coding-learning-loop.gate-case.v1',
        id: `${task.id}-${mode.toLowerCase()}-gate`,
        level: mastery,
        learning_target_id: task.target_id,
        deliver_topic: 'transfer-example',
        deliver_ref: task.implementation_ref,
        prompt: `Apply ${task.target_id} to the supplied fixture variant.`,
        rubric: [`explains ${task.target_id}`, 'uses the changed constraint'],
      })
      await session.evaluateGate(taskId, 'fixture answer intentionally not persisted', {
        result: 'PASS',
        criterion_results: [
          { criterion: `explains ${task.target_id}`, passed: true },
          { criterion: 'uses the changed constraint', passed: true },
        ],
        mastered_targets: [task.target_id],
      })
      const events = await ledger.read(taskId)
      const report = buildLearningReport(taskId, events)
      rows.push({
        task_id: task.id,
        mode,
        protocol_fixture: true,
        engineering_verification: report.engineering_status.verification,
        learning_status: report.learning_status.phase,
        ai_implementation_share: metrics.ai_share,
        scripted_rounds: metrics.scripted_rounds,
        deliver_topic_coverage: 1,
        gate_attempts: report.learning_status.gate_attempts,
        evidence: events.map(event => ({ id: event.event_id, type: event.type, payload_sha256: event.payload_sha256 })),
      })
    }
  }

  const artifact = {
    schema_version: 'ai-coding-learning-loop.comparison.v1',
    generated_from: 'deterministic protocol fixtures',
    empirical_human_study: false,
    tasks: tasks.map(task => task.id),
    rows,
    limitations: [
      'PASS answers are scripted fixtures and do not measure a human learner.',
      'round and implementation-share values are scenario inputs, not observed productivity results.',
      'use Agent Eval Lab to consume this versioned artifact without importing plugin internals.',
    ],
  }
  await mkdir(outputRoot, { recursive: true })
  await writeFile(join(outputRoot, 'comparison-report.json'), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  const markdown = `# Protocol comparison\n\nThis is a deterministic fixture evaluation, not a human-learning benchmark.\n\n`
    + `| Task | Mode | Engineering | Learning | AI share | Scripted rounds |\n|---|---|---:|---:|---:|---:|\n`
    + rows.map(row => `| ${row.task_id} | ${row.mode} | ${row.engineering_verification} | ${row.learning_status} | ${row.ai_implementation_share ?? 'n/a'} | ${row.scripted_rounds ?? 'n/a'} |`).join('\n')
    + `\n\n## Limits\n\n${artifact.limitations.map(item => `- ${item}`).join('\n')}\n`
  await writeFile(join(outputRoot, 'comparison-report.md'), markdown, 'utf8')
  process.stdout.write(`${rows.length} comparison rows written to ${outputRoot}\n`)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
