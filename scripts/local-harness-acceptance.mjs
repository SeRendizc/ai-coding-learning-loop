import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = 'https://github.com/deepseek-ai/deepseek-harness.git'
const commit = '47f943859bef60e4160492346772ded9b24f765a'
const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const localRoot = join(pluginRoot, '.local-test')
const harnessRoot = join(localRoot, 'deepseek-harness')
const dshHome = join(localRoot, 'dsh-home')
const evidenceRoot = join(localRoot, 'evidence')
const reportPath = join(localRoot, 'harness-live-report.json')
const configPath = join(localRoot, 'composed-config.yml')
const corepackHome = join(localRoot, 'corepack')
const onWindows = process.platform === 'win32'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? pluginRoot,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    shell: onWindows,
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    if (options.capture) {
      process.stdout.write(result.stdout ?? '')
      process.stderr.write(result.stderr ?? '')
    }
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`)
  }
  return result.stdout ?? ''
}

function hasCommit() {
  const result = spawnSync('git', ['-C', harnessRoot, 'cat-file', '-e', `${commit}^{commit}`], {
    encoding: 'utf8',
    shell: onWindows,
    stdio: 'ignore',
  })
  return result.status === 0
}

mkdirSync(localRoot, { recursive: true })

if (existsSync(harnessRoot) && lstatSync(harnessRoot).isSymbolicLink()) {
  throw new Error(`${harnessRoot} must be a real disposable directory, not a symbolic link`)
}
if (!existsSync(join(harnessRoot, '.git'))) {
  if (existsSync(harnessRoot)) {
    throw new Error(`${harnessRoot} already exists but is not a Git checkout; move it aside and retry`)
  }
  run('git', ['clone', '--filter=blob:none', '--no-checkout', repository, harnessRoot])
}
if (!hasCommit()) {
  run('git', ['-C', harnessRoot, 'fetch', '--depth=1', 'origin', commit])
}
run('git', ['-C', harnessRoot, 'checkout', '--detach', commit])

const packageManagerEnv = {
  COREPACK_HOME: corepackHome,
  COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
}
run('corepack', ['pnpm', 'install', '--frozen-lockfile'], {
  cwd: harnessRoot,
  env: packageManagerEnv,
})

const harnessEnv = { ...packageManagerEnv, DSH_HOME: dshHome }
run('corepack', ['pnpm', 'dsh', 'plugin', '--profile', 'web', 'add', pluginRoot], {
  cwd: harnessRoot,
  env: harnessEnv,
})
const composedConfig = run('corepack', ['pnpm', 'dsh', '--profile', 'web', '--dump-config'], {
  cwd: harnessRoot,
  env: harnessEnv,
  capture: true,
})
if (!composedConfig.includes('id: ai-coding-learning-loop')) {
  throw new Error('the composed web profile does not contain ai-coding-learning-loop')
}
writeFileSync(configPath, composedConfig, 'utf8')

run(process.execPath, [
  '--import',
  'tsx/esm',
  join(pluginRoot, 'scripts', 'live-harness-smoke.mjs'),
  harnessRoot,
  evidenceRoot,
  reportPath,
], { cwd: harnessRoot })

const report = JSON.parse(readFileSync(reportPath, 'utf8'))
if (report.result !== 'PASS' || report.provider_call_performed !== false) {
  throw new Error(`unexpected live report: ${JSON.stringify(report)}`)
}

process.stdout.write([
  '',
  'Local acceptance PASS',
  `Harness: ${commit}`,
  `Composed config: ${resolve(configPath)}`,
  `Live report: ${resolve(reportPath)}`,
  'Provider called: false',
  '',
].join('\n'))
