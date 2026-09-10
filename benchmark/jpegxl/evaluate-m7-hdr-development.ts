import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'
import { reuseM7ExpansionMetrics } from './m7-expansion-metric-cache.ts'
import { m7ExpansionCases, m7ExpansionSplit } from './m7-expansion-selection.ts'
import { m7DisplaySample } from './m7-hdr-mapping.ts'

const split = m7ExpansionSplit(process.env.PUREJSIMAGE_M7_EXPANSION_SPLIT)
const metricCache = process.env.PUREJSIMAGE_M7_EXPANSION_METRIC_CACHE
if (metricCache !== undefined && !/^[a-z0-9-]+$/u.test(metricCache))
  throw new Error('Invalid expansion metric cache run')

const id = process.argv[2]
const distance = Number(process.argv[3] ?? 1)
const runId = process.argv[4]
if (!id || ![0.25, 0.5, 1, 2, 3, 5].includes(distance) || !runId || !/^[a-z0-9-]+$/u.test(runId))
  throw new Error('Usage: evaluate-m7-hdr-development.ts source-id distance unique-run-id')
const entry = m7ExpansionCases(split, 'hdr').find((item) => item.id === id)
if (!entry || entry.status !== 'verified')
  throw new Error('Source is outside the selected frozen HDR cohort')
const root = `.tmp/jpegxl-m7/hdr-${split}-${runId}/${id}/distance-${distance}`
await mkdir(root, { recursive: true })
const tools = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const metrics = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-m7-metrics/tools'
const rust = '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli'
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const run = (tool: string, args: string[]): string => {
  const result = spawnSync(tool, args, {
    encoding: 'utf8',
    timeout: 600_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(`${tool}: ${result.stderr}; ${result.error ?? ''}`)
  return result.stdout
}
const npy = async (path: string, count: number): Promise<Float32Array> => {
  const bytes = await readFile(path)
  if (bytes[0] !== 147 || bytes.subarray(1, 6).toString('ascii') !== 'NUMPY' || bytes[6] !== 1)
    throw new Error('Invalid float oracle header')
  const start = 10 + bytes.readUInt16LE(8)
  if (
    !bytes.subarray(10, start).toString('ascii').includes("'<f4'") ||
    bytes.length !== start + count * 4
  )
    throw new Error('Invalid float oracle extent')
  const values = new Float32Array(count)
  for (let index = 0; index < count; index++) {
    const value = bytes.readFloatLE(start + index * 4)
    if (!Number.isFinite(value)) throw new Error('Nonfinite oracle sample')
    values[index] = value
  }
  return values
}
const prepared = `.tmp/jpegxl-m7/expansion-inputs/${id}`
const input = await readFile(`${prepared}/input-pq16.ppm`)
const header = /^P6\n(\d+) (\d+)\n65535\n/u.exec(input.subarray(0, 100).toString('ascii'))
if (!header) throw new Error('Invalid canonical PQ16 PPM')
const width = Number(header[1]),
  height = Number(header[2]),
  count = width * height * 3
if (!Number.isSafeInteger(count) || input.length !== header[0].length + count * 2)
  throw new Error('Invalid canonical sample extent')
const referenceBytes = await readFile(`${prepared}/reference.rgbf32be`)
if (referenceBytes.length !== count * 4) throw new Error('Invalid native-light reference extent')
const source = await readFile(`.tmp/jpegxl-m7/sources/${id}.hdr`)
if (hash(source) !== entry.sourceSha256) throw new Error('Frozen source changed')
const protocolBytes = await readFile(
  'benchmark/jpegxl/production-program/m7-hdr-alpha-protocol.json',
)
const preparedInfo: unknown = JSON.parse(await readFile(`${prepared}/input.json`, 'utf8'))
if (
  typeof preparedInfo !== 'object' ||
  preparedInfo === null ||
  !('protocolSha256' in preparedInfo) ||
  preparedInfo.protocolSha256 !== hash(protocolBytes) ||
  !('sourceSha256' in preparedInfo) ||
  preparedInfo.sourceSha256 !== entry.sourceSha256 ||
  !('mappingSha256' in preparedInfo) ||
  preparedInfo.mappingSha256 !==
    hash(await readFile(new URL('./m7-hdr-mapping.ts', import.meta.url))) ||
  !('artifacts' in preparedInfo) ||
  !Array.isArray(preparedInfo.artifacts)
)
  throw new Error('Prepared input provenance mismatch')
for (const artifact of preparedInfo.artifacts) {
  if (
    typeof artifact !== 'object' ||
    artifact === null ||
    !('name' in artifact) ||
    typeof artifact.name !== 'string' ||
    !/^[a-z0-9.-]+$/u.test(artifact.name) ||
    !('sha256' in artifact) ||
    typeof artifact.sha256 !== 'string'
  )
    throw new Error('Invalid prepared artifact provenance')
  if (hash(await readFile(`${prepared}/${artifact.name}`)) !== artifact.sha256)
    throw new Error(`Prepared artifact changed: ${artifact.name}`)
}
const sourcePaths = [
  'src/codecs/jpegxl-modular-encode.ts',
  'src/codecs/jpegxl-vardct-encode.ts',
  'src/codecs/jpegxl-vardct-forward-transforms.ts',
  'src/codecs/jpegxl-vardct-quantization.ts',
  'src/codecs/jpegxl-jpeg-encode.ts',
  'src/codecs/icc.ts',
  'benchmark/jpegxl/m7-hdr-mapping.ts',
]
const protocol = {
  id,
  distance,
  width,
  height,
  effort: 7,
  split,
  sourceSha256: entry.sourceSha256,
  inputSha256: hash(input),
  referenceSha256: hash(referenceBytes),
  mappingProtocolSha256: hash(protocolBytes),
  metricCache,
  metricCacheHarnessSha256: hash(
    await readFile(new URL('./m7-expansion-metric-cache.ts', import.meta.url)),
  ),
  sourceFiles: await Promise.all(
    sourcePaths.map(async (path) => ({
      path,
      sha256: hash(await readFile(new URL(`../../${path}`, import.meta.url))),
    })),
  ),
  oracleFiles: await Promise.all(
    [
      `${tools}/cjxl`,
      `${tools}/djxl`,
      `${tools}/jxlinfo`,
      rust,
      `${metrics}/ssimulacra2`,
      `${metrics}/butteraugli_main`,
    ].map(async (path) => ({ path, sha256: hash(await readFile(path)) })),
  ),
  timing: 'Serial quality evaluation, not isolated performance evidence',
}
await writeFile(`${root}/protocol.json`, JSON.stringify(protocol, null, 2) + '\n', { flag: 'wx' })
const results: object[] = []
let failures = 0
for (const engine of ['purejsimage', 'libjxl'] as const) {
  try {
    const output = `${root}/${engine}.jxl`
    if (engine === 'purejsimage') {
      const sink = new Uint8ArraySink()
      const encoder = await jpegxlCodec.createEncoder?.(sink, {
        width,
        height,
        pixelFormat: 'rgb16',
        limits: defaultImageLimits,
        colorSemantics: {
          family: 'rgb',
          primaries: 'srgb',
          transfer: { kind: 'pq' },
          matrix: 'identity',
          range: 'full',
          alpha: 'none',
          provenance: 'container-signaled',
          renderingIntent: 'relative',
        },
        options: { mode: 'lossy', distance, effort: 7, sampleBitDepth: 16 },
      })
      if (!encoder) throw new Error('Missing forward encoder')
      await encoder.write({
        x: 0,
        y: 0,
        width,
        height,
        format: 'rgb16',
        stride: width * 6,
        data: input.subarray(header[0].length),
      })
      await encoder.finish()
      await writeFile(output, sink.toUint8Array())
    } else {
      run(`${tools}/cjxl`, [
        `${prepared}/input-pq16.ppm`,
        output,
        '-d',
        String(distance),
        '-e',
        '7',
        '--num_threads=1',
        '-x',
        'color_space=RGB_D65_SRG_Rel_PeQ',
      ])
    }
    const metadata = run(`${tools}/jxlinfo`, [output, '-v'])
    await writeFile(`${root}/${engine}-metadata.txt`, metadata)
    if (
      !metadata.includes('16-bit RGB') ||
      !metadata.includes('Intensity target: 10000.') ||
      !metadata.includes('Orientation: 1 (Normal)') ||
      !metadata.includes('Transfer function: PQ') ||
      !metadata.includes('Rendering intent: Relative')
    )
      throw new Error('Independent HDR metadata mismatch')
    run(`${tools}/djxl`, [
      output,
      `${root}/${engine}-linear.npy`,
      '--num_threads=1',
      '--color_space=RGB_D65_SRG_Rel_Lin',
    ])
    const decoded = await npy(`${root}/${engine}-linear.npy`, count)
    let maximumIndependentDifference: number | null = null,
      maximumOwnDifference: number | null = null
    if (engine === 'purejsimage') {
      run(`${tools}/djxl`, [
        output,
        `${root}/${engine}-pq.npy`,
        '--num_threads=1',
        '--color_space=RGB_D65_SRG_Rel_PeQ',
      ])
      run(rust, [output, `${root}/${engine}-rust.npy`, '--num-threads', '1', '--data-type', 'f32'])
      const nativePq = await npy(`${root}/${engine}-pq.npy`, count),
        rustPq = await npy(`${root}/${engine}-rust.npy`, count)
      maximumIndependentDifference = 0
      for (let index = 0; index < count; index++)
        maximumIndependentDifference = Math.max(
          maximumIndependentDifference,
          Math.abs((nativePq[index] ?? 0) - (rustPq[index] ?? 0)),
        )
      if (maximumIndependentDifference > 1 / 255)
        throw new Error(`Independent PQ mismatch ${maximumIndependentDifference}`)
      const decoder = await jpegxlCodec.createDecoder?.(
        new MemorySource(await readFile(output)),
        defaultImageLimits,
      )
      if (!decoder || decoder.pixelFormat !== 'rgbf32')
        throw new Error('Missing native-light decoder')
      maximumOwnDifference = 0
      for await (const block of decoder.decode()) {
        try {
          const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
          for (let y = 0; y < block.height; y++)
            for (let x = 0; x < block.width * 3; x++) {
              const index = ((block.y + y) * width + block.x) * 3 + x
              maximumOwnDifference = Math.max(
                maximumOwnDifference,
                Math.abs(
                  (view.getFloat32(y * block.stride + x * 4, false) * 203) / 10000 -
                    (decoded[index] ?? 0),
                ),
              )
            }
        } finally {
          block.release?.()
        }
      }
      if (maximumOwnDifference > 1 / 255)
        throw new Error(`Own normalized-light mismatch ${maximumOwnDifference}`)
    }
    let squaredError = 0,
      referenceSquared = 0,
      maximumError = 0
    for (let index = 0; index < count; index++) {
      const light = ((decoded[index] ?? 0) * 10000) / 203,
        reference = referenceBytes.readFloatBE(index * 4)
      const error = Math.abs(light - reference)
      squaredError += error * error
      referenceSquared += reference * reference
      maximumError = Math.max(maximumError, error)
    }
    const displays: object[] = []
    for (const headroom of [1, 2, 4] as const) {
      const pixels = new Uint8Array(count)
      for (let index = 0; index < count; index++)
        pixels[index] = m7DisplaySample(((decoded[index] ?? 0) * 10000) / 203, headroom)
      const display = `${root}/${engine}-headroom-${headroom}.ppm`,
        reference = `${prepared}/headroom-${headroom}.ppm`
      await writeFile(
        display,
        Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]),
      )
      const decodedSha256 = hash(pixels)
      const cached = metricCache
        ? await reuseM7ExpansionMetrics({
            reportPath: `.tmp/jpegxl-m7/hdr-${split}-${metricCache}/${id}/distance-${distance}/report.json`,
            protocol,
            kind: 'hdr',
            id,
            sourceSha256: entry.sourceSha256,
            engine,
            setting: distance,
            domain: headroom,
            decodedSha256,
          })
        : undefined
      const ssimulacra2Text =
          cached?.ssimulacra2Text ?? run(`${metrics}/ssimulacra2`, [reference, display]),
        butteraugliText =
          cached?.butteraugliText ?? run(`${metrics}/butteraugli_main`, [reference, display])
      const ssimulacra2 = Number.parseFloat(ssimulacra2Text),
        butteraugli = Number.parseFloat(butteraugliText)
      if (!Number.isFinite(ssimulacra2) || !Number.isFinite(butteraugli))
        throw new Error('Invalid display metric')
      displays.push({
        headroom,
        ssimulacra2,
        butteraugli,
        ssimulacra2Text,
        butteraugliText,
        decodedSha256,
        ...(cached ? { metricReuse: cached.metricReuse } : {}),
      })
    }
    const encoded = await readFile(output)
    results.push({
      engine,
      status: 'measured',
      bytes: encoded.length,
      encodedSha256: hash(encoded),
      maximumIndependentDifference,
      maximumOwnDifference,
      nativeLight: {
        maximumError,
        rmse: Math.sqrt(squaredError / count),
        referenceRms: Math.sqrt(referenceSquared / count),
      },
      displays,
    })
  } catch (error) {
    failures++
    results.push({ engine, status: 'failed', error: String(error) })
  }
  await writeFile(
    `${root}/report.json`,
    JSON.stringify({ protocol, failures, results, stablePromotionGatePassed: false }, null, 2) +
      '\n',
  )
}
console.log(JSON.stringify({ id, distance, failures, root }))
if (failures) process.exitCode = 1
