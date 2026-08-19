import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw new Error('usage: verify-harness.mjs <deepseek-harness-checkout>')

const lock = JSON.parse(readFileSync(new URL('../compatibility/upstream-lock.json', import.meta.url)))
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json')))
const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

const actual = {
  commit,
  name: manifest.name,
  version: manifest.version,
  packageManager: manifest.packageManager,
  node: manifest.engines?.node,
}
const expected = { commit: lock.commit, ...lock.package }

const apiCatalog = readFileSync(resolve(root, 'packages/extensions/tool-cordis/src/api-catalog.ts'), 'utf8')
const publishGuide = readFileSync(resolve(root, 'docs/user/develop/basic/publish.md'), 'utf8')
const seams = {
  preExecuteWaterfall:
    apiCatalog.includes("name: 'tools/pre-execute'")
    && apiCatalog.includes("mode: 'waterfall'")
    && apiCatalog.includes('next: () => Promise<PreToolDecision>'),
  immutableResult:
    apiCatalog.includes("name: 'tools/result'")
    && apiCatalog.includes("mode: 'emit'")
    && apiCatalog.includes('exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>'),
  bundleManifest: publishGuide.includes('"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }'),
}

if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  console.error(JSON.stringify({ expected, actual }, null, 2))
  process.exitCode = 1
} else if (Object.values(seams).some(value => value === false)) {
  console.error(JSON.stringify({ message: 'required Harness seams changed', seams }, null, 2))
  process.exitCode = 1
} else {
  console.log(`DeepSeek Harness ${actual.version} @ ${actual.commit}: package and H0 seams verified`)
}
