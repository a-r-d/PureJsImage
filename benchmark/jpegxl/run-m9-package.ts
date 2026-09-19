import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import packageMetrics from '../generated/package-metrics.json' with { type: 'json' }
import gateManifest from './production-program/m9-gate-manifest.json' with { type: 'json' }

interface PackageCase {
  readonly id: string
  readonly status: 'passed'
  readonly milliseconds: number
  readonly codecMinifiedBytes?: number
  readonly specializedMinifiedBytes?: number
  readonly coldImportMilliseconds?: number
  readonly firstDecodeMilliseconds?: number
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const manifestPath = resolve(
  repositoryRoot,
  'benchmark/jpegxl/production-program/m9-gate-manifest.json',
)
const hash = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex')
const elapsed = (started: number): number => Math.max(0, performance.now() - started)

const nodeBinary = (major: 22 | 24): string => {
  const configured = process.env[`PUREJSIMAGE_M9_NODE${major}_BIN`]
  if (configured) return configured
  const local = `/home/ard/.nvm/versions/node/v${major === 22 ? '22.21.1' : '24.16.0'}/bin/node`
  if (Number(process.versions.node.split('.')[0]) === major) return process.execPath
  return local
}

const run = (
  command: string,
  arguments_: readonly string[],
  options: Readonly<{ nodePath?: string }> = {},
): number => {
  const started = performance.now()
  const nodeDirectory = options.nodePath ? dirname(options.nodePath) : undefined
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: nodeDirectory
      ? { ...process.env, PATH: `${nodeDirectory}:${process.env.PATH ?? ''}` }
      : process.env,
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(
      `${command} ${arguments_.join(' ')} failed (${result.status ?? 'unknown'})\n${result.stdout}${result.stderr}`,
    )
  return elapsed(started)
}

const packageCheck = (major: 22 | 24): number => {
  const binary = nodeBinary(major)
  const version = spawnSync(binary, ['--version'], { encoding: 'utf8' })
  if (version.status !== 0 || !version.stdout.startsWith(`v${major}.`))
    throw new Error(`M9 requires a Node ${major} binary; set PUREJSIMAGE_M9_NODE${major}_BIN`)
  return run(binary, ['scripts/check-package-types.ts'], { nodePath: binary })
}

const coldStart = (): Readonly<{
  coldImportMilliseconds: number
  firstDecodeMilliseconds: number
}> => {
  const program = `
    import { readFile } from 'node:fs/promises'
    const started = performance.now()
    const [{ jpegxlCodec }, { MemorySource, defaultImageLimits }] = await Promise.all([
      import('./dist/codec-entries/jpegxl.js'),
      import('./dist/index.js'),
    ])
    const imported = performance.now()
    const bytes = new Uint8Array(await readFile('benchmark/fixtures/jpegxl/generated-lossless-v0.12.0/rgb8-default.jxl'))
    const decoder = await jpegxlCodec.createDecoder(new MemorySource(bytes), defaultImageLimits)
    if (!decoder) throw new Error('Packed JPEG XL decoder is unavailable')
    for await (const block of decoder.decode()) block.release?.()
    process.stdout.write(JSON.stringify({
      coldImportMilliseconds: imported - started,
      firstDecodeMilliseconds: performance.now() - imported,
    }))
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`M9 cold-start probe failed\n${result.stderr}`)
  const parsed: unknown = JSON.parse(result.stdout)
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('coldImportMilliseconds' in parsed) ||
    !('firstDecodeMilliseconds' in parsed) ||
    typeof parsed.coldImportMilliseconds !== 'number' ||
    typeof parsed.firstDecodeMilliseconds !== 'number'
  )
    throw new Error('M9 cold-start probe returned invalid measurements')
  return {
    coldImportMilliseconds: parsed.coldImportMilliseconds,
    firstDecodeMilliseconds: parsed.firstDecodeMilliseconds,
  }
}

const metric = (id: string): number => {
  const target = packageMetrics.targets.find((entry) => entry.id === id)
  if (!target) throw new Error(`M9 package metrics omit ${id}`)
  return target.minifiedJsBytes
}

export const runM9Package = async () => {
  const cases: PackageCase[] = []
  const node22Milliseconds = packageCheck(22)
  cases.push({ id: 'node-22-packed-imports', status: 'passed', milliseconds: node22Milliseconds })
  const node24Milliseconds = packageCheck(24)
  cases.push({ id: 'node-24-packed-imports', status: 'passed', milliseconds: node24Milliseconds })
  const conditionalMilliseconds = Math.max(node22Milliseconds, node24Milliseconds)
  cases.push({
    id: 'browser-conditional-codec-export',
    status: 'passed',
    milliseconds: conditionalMilliseconds,
  })
  cases.push({
    id: 'browser-conditional-specialized-export',
    status: 'passed',
    milliseconds: conditionalMilliseconds,
  })

  const browserStarted = performance.now()
  run('npx', [
    'playwright',
    'test',
    'browser-tests/jpegxl-pipeline.pw.ts',
    '--grep',
    'progressive stages, viewport selection, cache reuse and timer cancellation match Node',
    '--project=chromium',
    '--project=firefox',
    '--project=webkit',
    '--workers=1',
    '--retries=0',
  ])
  const browserMilliseconds = elapsed(browserStarted)
  for (const id of ['chromium-public-api', 'firefox-public-api', 'webkit-public-api'] as const)
    cases.push({ id, status: 'passed', milliseconds: browserMilliseconds })

  const sizeStarted = performance.now()
  run(process.execPath, ['scripts/measure-bundle-size.ts', '--check'])
  const cold = coldStart()
  cases.push({
    id: 'entry-size-and-cold-start',
    status: 'passed',
    milliseconds: elapsed(sizeStarted),
    codecMinifiedBytes: metric('codec-jpegxl'),
    specializedMinifiedBytes: metric('jpegxl-specialized'),
    ...cold,
  })

  const revisionResult = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
  const statusResult = spawnSync('git', ['status', '--porcelain'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
  const revision = revisionResult.stdout.trim()
  if (revisionResult.status !== 0 || !/^[0-9a-f]{40}$/u.test(revision))
    throw new Error('Cannot resolve M9 package revision')
  if (statusResult.status !== 0) throw new Error('Cannot inspect M9 package worktree')
  if (cases.length !== gateManifest.packageCases.length)
    throw new Error('M9 package case count does not match the gate manifest')
  return {
    schemaVersion: 1,
    revision,
    clean: statusResult.stdout.trim() === '',
    manifestSha256: hash(await readFile(manifestPath)),
    cases,
    summary: {
      passed: true,
      total: cases.length,
      passedCases: cases.length,
      runtimeFailures: 0,
    },
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const outputIndex = process.argv.indexOf('--output')
  const report = await runM9Package()
  const json = `${JSON.stringify(report, null, 2)}\n`
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined
  if (outputPath) await writeFile(outputPath, json)
  else process.stdout.write(json)
}
