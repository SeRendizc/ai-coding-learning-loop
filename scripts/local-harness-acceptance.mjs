import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repository = 'https://github.com/deepseek-ai/deepseek-harness.git'
const commit = '47f943859bef60e4160492346772ded9b24f765a'
const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const pluginSpec = pathToFileURL(pluginRoot).href
const localRoot = join(pluginRoot, '.local-test')
const harnessRoot = join(localRoot, 'deepseek-harness')
const dshHome = join(localRoot, 'dsh-home')
const evidenceRoot = join(localRoot, 'evidence')
const reportPath = join(localRoot, 'harness-live-report.json')
const configPath = join(localRoot, 'composed-config.yml')
const npmCache = join(localRoot, 'npm-cache')
const packageManagerRoot = join(localRoot, 'package-manager')
const pnpmCli = join(packageManagerRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
const packageManagerBin = join(packageManagerRoot, 'node_modules', '.bin')
const npmCli = process.env.npm_execpath
const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') ?? 'PATH'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? pluginRoot,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
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
    stdio: 'ignore',
  })
  return result.status === 0
}

function runPnpm(args, options = {}) {
  return run(process.execPath, [pnpmCli, ...args], {
    ...options,
    env: {
      npm_config_cache: npmCache,
      [pathKey]: `${packageManagerBin}${delimiter}${process.env[pathKey] ?? ''}`,
      ...options.env,
    },
  })
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

if (!existsSync(pnpmCli)) {
  if (!npmCli) {
    throw new Error('npm_execpath is unavailable; run this through npm run test:harness:local')
  }
  run(process.execPath, [
    npmCli,
    'install',
    '--prefix',
    packageManagerRoot,
    '--no-save',
    '--ignore-scripts',
    'pnpm@11.7.0',
  ], { env: { npm_config_cache: npmCache } })
}

runPnpm(['install', '--frozen-lockfile'], {
  cwd: harnessRoot,
})

const harnessEnv = { DSH_HOME: dshHome }
runPnpm(['dsh', 'plugin', '--profile', 'web', 'add', pluginSpec], {
  cwd: harnessRoot,
  env: harnessEnv,
})
const composedConfig = runPnpm(['dsh', '--profile', 'web', '--dump-config'], {
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
