import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

interface ScalingRun {
  readonly dimensions: string
  readonly inputBytes: number
  readonly maximumRssBytes: number
  readonly mode: 'bounded' | 'full'
  readonly outputSha256: string
  readonly peakArrayBuffersDeltaBytes: number
  readonly peakExternalDeltaBytes: number
  readonly peakRssDeltaBytes: number
  readonly pixels: number
  readonly wallMilliseconds: number
}

const isScalingRun = (value: unknown): value is ScalingRun => {
  if (typeof value !== 'object' || value === null) return false
  if (!('mode' in value) || (value.mode !== 'bounded' && value.mode !== 'full')) return false
  if (!('dimensions' in value) || typeof value.dimensions !== 'string') return false
  if (!('pixels' in value) || typeof value.pixels !== 'number') return false
  if (!('inputBytes' in value) || typeof value.inputBytes !== 'number') return false
  if (!('outputSha256' in value) || typeof value.outputSha256 !== 'string') return false
  if (!('wallMilliseconds' in value) || typeof value.wallMilliseconds !== 'number') return false
  if (!('maximumRssBytes' in value) || typeof value.maximumRssBytes !== 'number') return false
  if (!('peakRssDeltaBytes' in value) || typeof value.peakRssDeltaBytes !== 'number') return false
  if (!('peakExternalDeltaBytes' in value) || typeof value.peakExternalDeltaBytes !== 'number') {
    return false
  }
  return (
    'peakArrayBuffersDeltaBytes' in value && typeof value.peakArrayBuffersDeltaBytes === 'number'
  )
}

const dimensions = [
  [512, 384],
  [1_024, 768],
  [2_048, 1_536],
] as const
const worker = fileURLToPath(new URL('./memory-scaling-worker.ts', import.meta.url))
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-memory-scaling-'))
const runs: ScalingRun[] = []

const median = (values: readonly number[]): number => {
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.floor(ordered.length / 2)] ?? 0
}

try {
  for (const [width, height] of dimensions) {
    const pixels = width * height
    const planes = new Uint8Array(pixels * 3)
    const rgbaRow = new Uint8Array(width * 4)
    const expected = createHash('sha256')
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x
        const first = (x * 13 + y * 3 + ((x >> 4) ^ (y >> 3)) * 17) & 0xff
        const second = (x * 5 + y * 11 + (x >> 5) * (y >> 5)) & 0xff
        const third = (x * 7 + y * 19 + ((x ^ y) >> 2)) & 0xff
        planes[index] = first
        planes[pixels + index] = second
        planes[2 * pixels + index] = third
        const outputOffset = x * 4
        rgbaRow[outputOffset] = third
        rgbaRow[outputOffset + 1] = first
        rgbaRow[outputOffset + 2] = second
        rgbaRow[outputOffset + 3] = 255
      }
      expected.update(rgbaRow)
    }
    const y4mPath = join(temporaryDirectory, `${width}x${height}.y4m`)
    const avifPath = join(temporaryDirectory, `${width}x${height}.avif`)
    const header = new TextEncoder().encode(
      `YUV4MPEG2 W${width} H${height} F1:1 Ip A1:1 C444 XYSCSS=444 XCOLORRANGE=FULL\nFRAME\n`,
    )
    const y4m = new Uint8Array(header.byteLength + planes.byteLength)
    y4m.set(header)
    y4m.set(planes, header.byteLength)
    await writeFile(y4mPath, y4m)
    const encoded = spawnSync(
      'avifenc',
      [
        '-j',
        '1',
        '--lossless',
        '--cicp',
        '1/13/0',
        '--tilecolslog2',
        '0',
        '--tilerowslog2',
        '0',
        '-s',
        '6',
        y4mPath,
        avifPath,
      ],
      { encoding: 'utf8', maxBuffer: 4 * 1_024 * 1_024 },
    )
    if (encoded.error) throw encoded.error
    if (encoded.status !== 0) throw new Error(`avifenc failed: ${encoded.stderr.trim()}`)
    const expectedSha256 = expected.digest('hex')
    for (const mode of ['full', 'bounded'] as const) {
      for (let run = 0; run < 3; run += 1) {
        const child = spawnSync(
          process.execPath,
          ['--expose-gc', worker, avifPath, `${width}`, `${height}`, expectedSha256, mode],
          { encoding: 'utf8', maxBuffer: 4 * 1_024 * 1_024 },
        )
        if (child.error) throw child.error
        if (child.status !== 0) {
          throw new Error(`${mode} ${width}x${height} failed: ${child.stderr.trim()}`)
        }
        const parsed: unknown = JSON.parse(child.stdout)
        if (!isScalingRun(parsed)) {
          throw new Error('AVIF scaling worker returned an invalid result')
        }
        runs.push(parsed)
      }
    }
  }

  const summaries = dimensions.flatMap(([width, height]) =>
    (['full', 'bounded'] as const).map((mode) => {
      const selected = runs.filter(
        (run) => run.dimensions === `${width}x${height}` && run.mode === mode,
      )
      return {
        dimensions: `${width}x${height}`,
        pixels: width * height,
        mode,
        inputBytes: selected[0]?.inputBytes ?? 0,
        outputSha256: selected[0]?.outputSha256 ?? '',
        medianMaximumRssBytes: median(selected.map((run) => run.maximumRssBytes)),
        medianPeakRssDeltaBytes: median(selected.map((run) => run.peakRssDeltaBytes)),
        medianPeakExternalDeltaBytes: median(selected.map((run) => run.peakExternalDeltaBytes)),
        medianPeakArrayBuffersDeltaBytes: median(
          selected.map((run) => run.peakArrayBuffersDeltaBytes),
        ),
        medianWallMilliseconds: median(selected.map((run) => run.wallMilliseconds)),
      }
    }),
  )
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    runsPerConfiguration: 3,
    notes: {
      comparison:
        'Full padded reconstruction and bounded public decode use the same checksum-pinned filter-free AV1 payload.',
      baseline: 'Captured with the compressed input retained after explicit GC settling.',
      correctness: 'Every full and bounded run must reproduce the same lossless RGBA SHA-256.',
    },
    summaries,
    runs,
  }
  const outputFlag = process.argv.indexOf('--output')
  const outputPath = outputFlag === -1 ? undefined : process.argv[outputFlag + 1]
  const serialized = `${JSON.stringify(report, undefined, 2)}\n`
  if (outputPath) await writeFile(outputPath, serialized)
  console.log(serialized.trim())
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
