#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { FileEvidenceLedger } from '../src/evidence.mjs'
import { buildLearningReport, renderMarkdownReport } from '../src/report.mjs'
import { LearningSession } from '../src/session.mjs'

function usage() {
  return `Usage:
  ai-coding-learning-loop init <contract.json> [evidence-root]
  ai-coding-learning-loop status <task-id> [evidence-root]
  ai-coding-learning-loop report <task-id> [evidence-root] [output.md]
`
}

const [command, subject, rootArg, outputArg] = process.argv.slice(2)
if (!command || !subject) {
  process.stderr.write(usage())
  process.exitCode = 2
} else {
  const root = resolve(rootArg ?? '.ai-coding-learning-loop/evidence')
  const ledger = new FileEvidenceLedger(root)
  const session = new LearningSession(ledger)
  try {
    if (command === 'init') {
      const contract = JSON.parse(await readFile(resolve(subject), 'utf8'))
      await session.acceptContract(contract)
      process.stdout.write(`accepted ${contract.task_id}\n`)
    } else if (command === 'status') {
      process.stdout.write(`${JSON.stringify(await session.state(subject), null, 2)}\n`)
    } else if (command === 'report') {
      const report = buildLearningReport(subject, await ledger.read(subject))
      const markdown = renderMarkdownReport(report)
      if (outputArg) {
        await writeFile(resolve(outputArg), markdown, 'utf8')
        process.stdout.write(`${resolve(outputArg)}\n`)
      } else {
        process.stdout.write(markdown)
      }
    } else {
      process.stderr.write(usage())
      process.exitCode = 2
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
