export const PLAN_SCHEMA_VERSION = 'ai-coding-learning-loop.plan.v1'

export function planSubmissionParameters() {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'engineering_task',
      'implementation_steps',
      'verification_plan',
      'learning_anchors',
      'known_risks',
    ],
    properties: {
      engineering_task: {
        type: 'string',
        minLength: 1,
        description: 'Concrete coding task proposed for this Plan. Preserve an existing user coding request when one exists.',
      },
      implementation_steps: {
        type: 'array',
        minItems: 1,
        items: { type: 'string' },
        description: 'Ordered implementation steps for the proposed coding task.',
      },
      verification_plan: {
        type: 'array',
        minItems: 1,
        items: { type: 'string' },
        description: 'Concrete tests and checks that will verify the implementation.',
      },
      learning_anchors: {
        type: 'array',
        minItems: 1,
        items: { type: 'string' },
        description: 'Concepts the learner must understand, predict, or apply during Deliver and Gate.',
      },
      known_risks: {
        type: 'array',
        items: { type: 'string' },
        description: 'Known implementation, verification, or learning risks. Use an empty array only when none are known.',
      },
    },
  }
}

function requiredNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${field} is required`)
  return value.trim()
}

function requiredStringList(value, field, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)
    || value.some(item => typeof item !== 'string' || item.trim().length === 0)) {
    throw new TypeError(`${field} must be ${allowEmpty ? 'a' : 'a non-empty'} string array`)
  }
  return value.map(item => item.trim())
}

export function materializePlanSubmission(args, state) {
  const workUnitId = state?.active_work_unit_id
  if (typeof workUnitId !== 'string' || workUnitId.length === 0) {
    throw new Error('ownership_submit_plan requires an active Planning work unit')
  }
  return {
    schema_version: PLAN_SCHEMA_VERSION,
    work_unit_id: workUnitId,
    engineering_task: requiredNonEmptyString(args?.engineering_task, 'engineering_task'),
    implementation_steps: requiredStringList(args?.implementation_steps, 'implementation_steps'),
    verification_plan: requiredStringList(args?.verification_plan, 'verification_plan'),
    learning_anchors: requiredStringList(args?.learning_anchors, 'learning_anchors'),
    known_risks: requiredStringList(args?.known_risks, 'known_risks', { allowEmpty: true }),
  }
}
