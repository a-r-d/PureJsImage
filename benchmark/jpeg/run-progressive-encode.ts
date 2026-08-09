import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type ProbeMode = '420' | 'restart' | 'progressive' | 'progressive-restart'
type ProbeProfile = 'cold' | 'warm'

interface ProbeResult {
  readonly mode: ProbeMode
  readonly profile: ProbeProfile
  readonly progressive: boolean
  readonly frameMarker: 'SOF0' | 'SOF2'
  readonly scanCount: number
  readonly huffmanTableMarkers: number
  readonly restartMarkers: number
  readonly dimensions: string
  readonly medianMilliseconds: number
  readonly throughputMegapixelsPerSecond: number
  readonly peakRssMiB: number
  readonly retainedCoefficientBytes: number
  readonly outputBytes: number
  readonly psnr: number
  readonly independentDecode: 'passed'
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

const numberField = (value: Readonly<Record<string, unknown>>, key: string): number => {
  const field = value[key]
  if (typeof field !== 'number' || !Number.isFinite(field)) {
    throw new Error(`JPEG encode probe field ${key} is invalid`)
  }
  return field
}

const parseProbe = (output: string, mode: ProbeMode, profile: ProbeProfile): ProbeResult => {
  const parsed: unknown = JSON.parse(output)
  if (!isRecord(parsed)) throw new Error('JPEG encode probe output must be an object')
  if (parsed.mode !== mode || parsed.profile !== profile) {
    throw new Error(`JPEG encode probe returned ${String(parsed.mode)}/${String(parsed.profile)}`)
  }
  const progressive = parsed.progressive
  const frameMarker = parsed.frameMarker
  const independentDecode = parsed.independentDecode
  const dimensions = parsed.dimensions
  if (typeof progressive !== 'boolean') throw new Error('JPEG encode probe progressive is invalid')
  if (frameMarker !== 'SOF0' && frameMarker !== 'SOF2') {
    throw new Error('JPEG encode probe frame marker is invalid')
  }
  if (independentDecode !== 'passed') throw new Error('JPEG encode probe independent decode failed')
  if (typeof dimensions !== 'string') throw new Error('JPEG encode probe dimensions are invalid')
  return {
    mode,
    profile,
    progressive,
    frameMarker,
    independentDecode,
    dimensions,
    scanCount: numberField(parsed, 'scanCount'),
    huffmanTableMarkers: numberField(parsed, 'huffmanTableMarkers'),
    restartMarkers: numberField(parsed, 'restartMarkers'),
    medianMilliseconds: numberField(parsed, 'medianMilliseconds'),
    throughputMegapixelsPerSecond: numberField(parsed, 'throughputMegapixelsPerSecond'),
    peakRssMiB: numberField(parsed, 'peakRssMiB'),
    retainedCoefficientBytes: numberField(parsed, 'retainedCoefficientBytes'),
    outputBytes: numberField(parsed, 'outputBytes'),
    psnr: numberField(parsed, 'psnr'),
  }
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-progressive-jpeg-'))

const runProbe = (mode: ProbeMode, profile: ProbeProfile): Promise<ProbeResult> =>
  new Promise((resolve, reject) => {
    const resultPath = join(temporaryDirectory, `${mode}-${profile}.json`)
    const child = spawn(
      process.execPath,
      ['--expose-gc', 'benchmark/jpeg/encode-probe.ts', mode, profile, resultPath],
      { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe'] },
    )
    let error = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      error += chunk
    })
    child.on('error', reject)
    child.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(`JPEG encode probe ${mode}/${profile} failed (${code}):\n${error}`))
        return
      }
      try {
        resolve(parseProbe(await readFile(resultPath, 'utf8'), mode, profile))
      } catch (parseError: unknown) {
        reject(parseError)
      }
    })
  })

const modes: readonly ProbeMode[] = ['420', 'progressive', 'restart', 'progressive-restart']
const profiles: readonly ProbeProfile[] = ['cold', 'warm']
const results: ProbeResult[] = []
for (const profile of profiles) {
  for (const mode of modes) results.push(await runProbe(mode, profile))
}
await rm(temporaryDirectory, { recursive: true, force: true })

const generatedAt = new Date().toISOString()
const report = {
  generatedAt,
  note: 'Each row ran in an isolated process. Pixels were independently decoded before timing counted. RSS is absolute process peak RSS; progressive retained bytes are compact quantized Int16 coefficients.',
  results,
}
const markdown = [
  '# Progressive JPEG encode benchmark',
  '',
  `Generated: ${generatedAt}`,
  '',
  report.note,
  '',
  '| Mode | Profile | Frame/scans/DHT | Median | Throughput | Peak RSS | Coefficients | Output | PSNR |',
  '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...results.map(
    (result) =>
      `| ${result.mode} | ${result.profile} | ${result.frameMarker}/${result.scanCount}/${result.huffmanTableMarkers} | ${result.medianMilliseconds.toFixed(2)} ms | ${result.throughputMegapixelsPerSecond.toFixed(2)} MP/s | ${result.peakRssMiB.toFixed(2)} MiB | ${(result.retainedCoefficientBytes / 1_048_576).toFixed(2)} MiB | ${result.outputBytes} B | ${result.psnr.toFixed(2)} dB |`,
  ),
  '',
  'Baseline and progressive rows use the same deterministic 2048x1536 RGB input, quality 80,',
  '4:2:0 sampling and independent `jpeg-js` final-pixel validation. Baseline uses the standard',
  'Huffman tables; progressive gathers statistics and writes optimized tables per entropy-coded scan.',
  'Restart rows add a four-MCU restart interval; progressive restart intervals apply independently',
  'to each scan, as required by JPEG scan semantics.',
  '',
].join('\n')

if (process.argv.includes('--write')) {
  const date = generatedAt.slice(0, 10)
  const directory = join('benchmark', 'results')
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, `jpeg-progressive-encode-${date}.json`),
    `${JSON.stringify(report, undefined, 2)}\n`,
  )
  await writeFile(join(directory, `jpeg-progressive-encode-${date}.md`), markdown)
}

console.log(markdown)
