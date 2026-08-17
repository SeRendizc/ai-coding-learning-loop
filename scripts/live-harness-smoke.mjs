import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function required(value, message) {
  if (!value) throw new Error(message)
  return value
}

const harnessRoot = resolve(required(process.argv[2], 'usage: live-harness-smoke.mjs <harness-root> <evidence-root> <report.json>'))
const evidenceRoot = resolve(required(process.argv[3], 'evidence root is required'))
const reportPath = resolve(required(process.argv[4], 'report path is required'))
const fromHarness = relative => import(pathToFileURL(resolve(harnessRoot, relative)).href)

const [cordis, systemPromptModule, toolsModule, commandsModule, questionsModule, skillsModule, plugin] = await Promise.all([
  fromHarness('vendor/cordis/src/index.ts'),
  fromHarness('packages/core/system-prompt/src/index.ts'),
  fromHarness('packages/core/tools/src/index.ts'),
  fromHarness('packages/interaction/commands/src/index.ts'),
  fromHarness('packages/interaction/user-questions/src/index.ts'),
  fromHarness('packages/skill/skill/src/index.ts'),
  import(new URL('../index.js', import.meta.url)),
])

const ctx = new cordis.Context()
await ctx.plugin(systemPromptModule.default)
await ctx.plugin(toolsModule.default)
await ctx.plugin(commandsModule.default)
await ctx.plugin(questionsModule.default)
await ctx.plugin(skillsModule.default)

const fiber = await ctx.plugin(plugin, { maxEntries: 8, evidenceRoot })
const pluginContext = fiber.ctx
const agentView = { id: 's4-live-agent' }
const commandNames = ctx.commands.list(agentView).map(command => command.name)
const skill = await ctx.skills.get('ai-coding-learning-loop')
if (!commandNames.includes('ownership')) throw new Error('Harness did not register /ownership')
if (skill?.source !== 'runtime') throw new Error('Harness did not load the packaged runtime Skill')

ctx.tools.register(toolsModule.defineTool({
  name: 's4_live_probe',
  description: 'Exercise the authoritative Harness tool lifecycle for S4 live compatibility evidence.',
  parameters: {},
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
  execute: async () => 'probe-ok',
}))
const toolResult = await ctx.tools.execute({
  signal: new AbortController().signal,
  callId: 's4-live-call',
  name: 's4_live_probe',
  arguments: {},
})
if (toolResult.isError || toolResult.value !== 'probe-ok') throw new Error('real Harness tool execution failed')
const probe = plugin.getProbeSnapshot(pluginContext)
if (probe.totalObserved !== 2 || probe.entries.map(entry => entry.phase).join(',') !== 'pre-execute,result') {
  throw new Error(`plugin did not observe the real Harness pre-execute/result lifecycle: ${JSON.stringify(probe)}`)
}

const controller = required(plugin.getOwnershipController(pluginContext), 'learning controller was not mounted')
await controller.acceptContract({
  schema_version: 'ai-coding-learning-loop.learning-contract.v1',
  task_id: 's4-live-smoke',
  goal: 'live-harness-compatibility',
  mode: 'DELEGATED',
  learning_targets: [{
    id: 'harness-boundary',
    mastery: 'APPLY',
    owner: 'human',
    description: 'Separate learning delegation from Harness tool authorization.',
  }],
  work_units: [{ id: 'live-smoke', implementation_owner: 'ai' }],
  gate: { max_attempts: 3, require_unseen_variant: true },
  change_policy: 'explicit-confirmation',
})
const beforeRestart = await controller.state('s4-live-smoke')
const lifecycleSession = {
  id: 's4-live-smoke',
  messages: [],
  deriveMessages() { return this.messages },
}
const lifecycleAgent = { session: lifecycleSession }
let lifecycleCall = 0
const record = async arguments_ => {
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: `s4-lifecycle-${lifecycleCall++}`,
    name: 'ownership_lifecycle',
    arguments: arguments_,
    agent: lifecycleAgent,
  })
  if (result.isError) throw new Error(`lifecycle action failed: ${JSON.stringify(result.content)}`)
  return result.value
}
const implementationRef = 'sha256:s4-live-implementation'
await record({ action: 'brief', work_unit_id: 'live-smoke', topics: ['Harness lifecycle boundary'] })
await record({ action: 'start_work', work_unit_id: 'live-smoke' })
await record({ action: 'submit_implementation', work_unit_id: 'live-smoke', implementation_ref: implementationRef })
await record({
  action: 'record_verification',
  work_unit_id: 'live-smoke',
  verification_result: 'PASS',
  implementation_ref: implementationRef,
  verification_refs: ['live:s4-probe'],
})
await record({ action: 'complete_deliver', deliver_record: {
  schema_version: 'ai-coding-learning-loop.deliver.v1',
  work_unit_id: 'live-smoke',
  implementation_ref: implementationRef,
  verification_refs: ['live:s4-probe'],
  learning_targets: ['harness-boundary'],
  topics_taught: [
    'scope', 'reading-order', 'data-flow', 'design-rationale', 'invariants',
    'failure-paths', 'verification', 'prior-knowledge-link', 'transfer-example', 'known-gaps',
  ],
  known_gaps: [],
  ready_for_gate: true,
} })
await record({ action: 'ask_gate', gate_case: {
  schema_version: 'ai-coding-learning-loop.gate-case.v1',
  id: 'live-gate-apply',
  level: 'APPLY',
  learning_target_id: 'harness-boundary',
  deliver_topic: 'failure-paths',
  deliver_ref: implementationRef,
  prompt: 'Apply the authorization boundary to a delegated tool call.',
  rubric: ['keeps Harness authorization authoritative'],
} })
lifecycleSession.messages = [{
  role: 'user',
  content: [{ type: 'text', text: 'Delegation does not bypass Harness authorization.' }],
}]
await record({ action: 'record_gate_answer' })
const lifecycleResult = await record({ action: 'evaluate_gate', gate_evaluation: {
  result: 'PASS',
  criterion_results: [{ criterion: 'keeps Harness authorization authoritative', passed: true }],
  mastered_targets: ['harness-boundary'],
} })
if (lifecycleResult.state.phase !== 'CLOSED' || lifecycleResult.state.learning_status !== 'MASTERED') {
  throw new Error(`lifecycle tool did not close verified learning: ${JSON.stringify(lifecycleResult)}`)
}
const Ledger = controller.ledger.constructor
const restarted = new Ledger(evidenceRoot)
const afterRestartEvents = await restarted.read('s4-live-smoke')
if (beforeRestart.phase !== 'CONTRACTED' || afterRestartEvents.length !== 9) {
  throw new Error('sidecar evidence did not survive a fresh ledger instance')
}

await fiber.dispose()
const cleanup = {
  controller_removed: plugin.getOwnershipController(pluginContext) === null,
  command_removed: !ctx.commands.list(agentView).some(command => command.name === 'ownership'),
  skill_removed: await ctx.skills.get('ai-coding-learning-loop') === undefined,
  lifecycle_tool_removed: ctx.tools.get('ownership_lifecycle') === undefined,
}
if (Object.values(cleanup).some(value => value !== true)) throw new Error('Harness fiber disposal left plugin state behind')

const upstreamCommit = execFileSync('git', ['-C', harnessRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const upstreamPackage = JSON.parse(await readFile(resolve(harnessRoot, 'package.json'), 'utf8'))
const report = {
  schema_version: 'ai-coding-learning-loop.harness-live.v1',
  generated_at: new Date().toISOString(),
  upstream: {
    package: '@deepseek-ai/dsh-root',
    version: upstreamPackage.version,
    commit: upstreamCommit,
  },
  result: 'PASS',
  checks: {
    actual_cordis_context: true,
    command_registered: true,
    packaged_skill_registered: true,
    real_tool_pre_execute_and_result: true,
    lifecycle_tool_registered: true,
    durable_lifecycle_closed: true,
    durable_contract_recovered: true,
    fiber_cleanup: cleanup,
  },
  evidence_backend: 'sidecar-file-v1',
  provider_call_performed: false,
  automation: process.env.GITHUB_RUN_ID === undefined ? null : {
    repository: process.env.GITHUB_REPOSITORY,
    run_id: Number(process.env.GITHUB_RUN_ID),
    sha: process.env.GITHUB_SHA,
  },
}
await mkdir(resolve(reportPath, '..'), { recursive: true })
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
