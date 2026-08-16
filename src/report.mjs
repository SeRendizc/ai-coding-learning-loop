import { sha256 } from './canonical.mjs'
import { projectTask } from './core.mjs'

function eventCount(events, type) {
  return events.filter(event => event.type === type).length
}

export function buildLearningReport(taskId, events, options = {}) {
  const state = projectTask(taskId, events)
  const contract = events.find(event => event.type === 'contract.accepted')?.payload?.contract
  if (!contract) throw new Error('report requires an accepted Learning Contract')
  const requiredTargets = contract.learning_targets.map(target => target.id).sort()
  const mastered = new Set(state.mastered_targets)
  const missing = requiredTargets.filter(target => !mastered.has(target))
  const report = {
    schema_version: 'ai-coding-learning-loop.report.v1',
    task_id: taskId,
    mode: contract.mode,
    evidence_backend: options.evidence_backend ?? 'sidecar-file-v1',
    as_of_event: events.at(-1)?.event_id ?? null,
    engineering_status: {
      verification: state.engineering_status,
      evidence_refs: events
        .filter(event => event.type === 'work_unit.verified')
        .flatMap(event => event.refs),
    },
    learning_status: {
      phase: state.learning_status,
      gate_attempts: state.gate_attempts,
      mastered_targets: state.mastered_targets,
      unresolved_targets: [...new Set([...missing, ...state.unresolved_targets])].sort(),
      deliver_count: eventCount(events, 'deliver.completed'),
      remediation_count: Math.max(0, eventCount(events, 'deliver.completed') - 1),
    },
    metrics: {
      total_events: events.length,
      tool_observations: eventCount(events, 'tool.observed'),
      knowledge_debt_items: missing.length,
    },
    limitations: [
      'knowledge_debt_items counts missing agreed evidence; it is not a cognitive ability score',
      'a digest proves binding and change detection, not correctness or authentic understanding',
    ],
  }
  return Object.freeze({ ...report, report_sha256: sha256(report) })
}

export function renderMarkdownReport(report) {
  return `# AI Coding Learning Report: ${report.task_id}\n\n`
    + `- Mode: ${report.mode}\n`
    + `- Engineering verification: ${report.engineering_status.verification}\n`
    + `- Learning status: ${report.learning_status.phase}\n`
    + `- Gate attempts: ${report.learning_status.gate_attempts}\n`
    + `- Mastered targets: ${report.learning_status.mastered_targets.join(', ') || 'none'}\n`
    + `- Unresolved targets: ${report.learning_status.unresolved_targets.join(', ') || 'none'}\n`
    + `- Evidence backend: ${report.evidence_backend}\n`
    + `- Report digest: ${report.report_sha256}\n\n`
    + `## Limits\n\n${report.limitations.map(item => `- ${item}`).join('\n')}\n`
}
