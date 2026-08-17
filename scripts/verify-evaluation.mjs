import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const output = await mkdtemp(join(tmpdir(), 'learning-evaluation-'))
try {
  const comparisonScript = fileURLToPath(new URL('../examples/run-comparison.mjs', import.meta.url))
  execFileSync(process.execPath, [comparisonScript, output], {
    stdio: 'inherit',
  })
  for (const filename of ['comparison-report.json', 'comparison-report.md']) {
    const expected = await readFile(new URL(`../evaluation/${filename}`, import.meta.url), 'utf8')
    const actual = await readFile(join(output, filename), 'utf8')
    if (actual !== expected) throw new Error(`${filename} is stale; run npm run demo`)
  }
  process.stdout.write('committed evaluation artifacts are reproducible\n')
} finally {
  await rm(output, { recursive: true, force: true })
}
