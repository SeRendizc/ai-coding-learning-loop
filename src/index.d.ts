export type DelegationMode = 'GUIDED' | 'HUMAN_LED' | 'AI_LED' | 'DELEGATED'
export type MasteryLevel = 'EXPLAIN' | 'PREDICT' | 'APPLY'
export type GateResult = 'PASS' | 'RETRY' | 'BLOCK'

export interface LearningTarget {
  id: string
  mastery: MasteryLevel
  owner: 'human' | 'ai'
}

export interface WorkUnit {
  id: string
  implementation_owner: 'human' | 'ai' | 'pair'
}

export interface LearningContract {
  schema_version: 'ai-coding-learning-loop.learning-contract.v1'
  task_id: string
  mode: DelegationMode
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
