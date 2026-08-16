import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const output = await mkdtemp(join(tmpdir(), 'learning-evaluation-'))
try {
  execFileSync(process.execPath, [new URL('../examples/run-comparison.mjs', import.meta.url).pathname, output], {
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
