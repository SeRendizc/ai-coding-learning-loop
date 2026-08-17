export type DelegationMode = 'GUIDED' | 'HUMAN_LED' | 'AI_LED' | 'DELEGATED'
export type MasteryLevel = 'EXPLAIN' | 'PREDICT' | 'APPLY'
export type GateResult = 'PASS' | 'RETRY' | 'BLOCK'
export type LearnerExpertise = 'BEGINNER' | 'PRACTITIONER' | 'EXPERT'

export interface LearningTarget {
  id: string
  mastery: MasteryLevel
  owner: 'human' | 'ai'
  description: string
}

export interface WorkUnit {
  id: string
  implementation_owner: 'human' | 'ai' | 'pair'
}

export interface PlanRecord {
  schema_version: 'ai-coding-learning-loop.plan.v1'
  work_unit_id: string
  implementation_steps: string[]
  verification_plan: string[]
  learning_anchors: string[]
  known_risks: string[]
}

export interface LearningContract {
  schema_version: 'ai-coding-learning-loop.learning-contract.v1'
  task_id: string
  /** Explicit coding task; optional only for backwards-compatible recovered v1 evidence. */
  engineering_task?: string
  goal: string
  mode: DelegationMode
  learner_profile?: { expertise: LearnerExpertise; locale: 'zh-CN' | 'en' }
  learning_targets: LearningTarget[]
  work_units: WorkUnit[]
  gate: { max_attempts: number; require_unseen_variant: boolean }
  change_policy: 'explicit-confirmation'
}

export interface DeliverRecord {
  schema_version: 'ai-coding-learning-loop.deliver.v1'
  work_unit_id: string
  implementation_ref: string
  verification_refs: string[]
  learning_targets: string[]
  topics_taught: string[]
  examples_used?: string[]
  known_gaps: string[]
  ready_for_gate: true
}

export interface PluginConfig {
  maxEntries?: number
  evidenceRoot?: string
}

export declare const name: 'ai-coding-learning-loop'
export declare const inject: readonly ['tools']
export declare const Config: {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: 'ai-coding-learning-loop'
    validate(input?: unknown): { value: Required<PluginConfig> } | { issues: Array<{ message: string; path?: string[] }> }
  }
}

export declare function apply(ctx: object, config?: PluginConfig): void
export declare function getProbeSnapshot(ctx: object): Readonly<{
  active: boolean
  totalObserved: number
  dropped: number
  entries: readonly object[]
}>
export declare function getOwnershipController(ctx: object): unknown | null
