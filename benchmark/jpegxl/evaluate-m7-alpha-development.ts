import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { encodeJpegXlVarDct8 } from '../../src/codecs/jpegxl-vardct-encode.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'
import { reuseM7ExpansionMetrics } from './m7-expansion-metric-cache.ts'
import { m7ExpansionCases, m7ExpansionSplit } from './m7-expansion-selection.ts'
import { m7CompositeSample } from './m7-hdr-mapping.ts'

const split = m7ExpansionSplit(process.env.PUREJSIMAGE_M7_EXPANSION_SPLIT)
const metricCache = process.env.PUREJSIMAGE_M7_EXPANSION_METRIC_CACHE
if (metricCache !== undefined && !/^[a-z0-9-]+$/u.test(metricCache))
  throw new Error('Invalid expansion metric cache run')

sharp.concurrency(1)
const runId = process.argv[2]
if (!runId || !/^[a-z0-9-]+$/u.test(runId)) throw new Error('Specify a unique run identifier')
const directory = `.tmp/jpegxl-m7/alpha-${split}-${runId}`
await mkdir(directory, { recursive: true })
const tools = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const metrics = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-m7-metrics/tools'
const rust = '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli'
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const run = (tool: string, args: string[]): string => {
  const result = spawnSync(tool, args, { encoding: 'utf8', timeout: 600000, maxBuffer: 4194304 })
  if (result.status !== 0) throw new Error(`${tool}: ${result.stderr}; ${result.error ?? ''}`)
  return result.stdout
}
const sourcePaths = [
  'src/codecs/jpegxl-vardct-encode.ts',
  'src/codecs/jpegxl-vardct-forward-transforms.ts',
  'src/codecs/jpegxl-vardct-quantization.ts',
  'src/codecs/jpegxl-jpeg-encode.ts',
  'src/codecs/jpegxl-modular-encode.ts',
  'benchmark/jpegxl/m7-hdr-mapping.ts',
]
const protocolBytes = await readFile(
  'benchmark/jpegxl/production-program/m7-hdr-alpha-protocol.json',
)
const mappingHash = hash(await readFile(new URL('./m7-hdr-mapping.ts', import.meta.url)))
const cases = m7ExpansionCases(split, 'png')
const protocol = {
  split,
  harnessSha256: hash(await readFile(import.meta.filename)),
  ownDecoderSha256: hash(
    await readFile(new URL('../../src/codecs/jpegxl-decode.ts', import.meta.url)),
  ),
  ownDecoderPolicy:
    'Every first-party point must decode to complete ordered RGBA8 rows, match native RGB within 2 and retain original alpha exactly.',
  cases: cases.map((entry) => ({ id: entry.id, sourceSha256: entry.sourceSha256 })),
  policy: `Complete frozen transparent ${split} cohort. Exact JXL alpha, independently decoded straight RGBA8, linear-light black and white composites under the pre-existing frozen mapping. JXL distance .25/.5/1/2/3/5; WebP/AVIF quality 40/55/70/80/90/97 are separate curve coordinates. JPEG cannot preserve alpha and is excluded from this alpha-preserving comparison; the SDR cohort supplies its JPEG comparison. Every failure is retained. Serial quality measurements do not qualify runtime performance.`,
  mappingProtocolSha256: hash(protocolBytes),
  mappingHash,
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
      rust,
      `${metrics}/ssimulacra2`,
      `${metrics}/butteraugli_main`,
    ].map(async (path) => ({ path, sha256: hash(await readFile(path)) })),
  ),
  sharpVersions: sharp.versions,
}
await writeFile(`${directory}/protocol.json`, `${JSON.stringify(protocol, null, 2)}\n`, {
  flag: 'wx',
})
let failures = 0
for (const entry of cases) {
  const prepared = `.tmp/jpegxl-m7/expansion-inputs/${entry.id}`
  const root = `${directory}/${entry.id}`
  await mkdir(root, { recursive: true })
  const points: object[] = []
  try {
    const source = await readFile(`.tmp/jpegxl-m7/sources/${entry.id}.png`)
    if (hash(source) !== entry.sourceSha256) throw new Error('Frozen source changed')
    const info: unknown = JSON.parse(await readFile(`${prepared}/input.json`, 'utf8'))
    if (
      typeof info !== 'object' ||
      info === null ||
      !('width' in info) ||
      typeof info.width !== 'number' ||
      !('height' in info) ||
      typeof info.height !== 'number' ||
      !('sourceSha256' in info) ||
      info.sourceSha256 !== entry.sourceSha256 ||
      !('protocolSha256' in info) ||
      info.protocolSha256 !== protocol.mappingProtocolSha256 ||
      !('mappingSha256' in info) ||
      info.mappingSha256 !== mappingHash ||
      !('artifacts' in info) ||
      !Array.isArray(info.artifacts)
    )
      throw new Error('Prepared provenance mismatch')
    const { width, height } = info
    for (const artifact of info.artifacts) {
      if (
        typeof artifact !== 'object' ||
        artifact === null ||
        !('name' in artifact) ||
        typeof artifact.name !== 'string' ||
        !/^[a-z0-9.-]+$/u.test(artifact.name) ||
        !('sha256' in artifact) ||
        typeof artifact.sha256 !== 'string'
      )
        throw new Error('Invalid artifact provenance')
      if (hash(await readFile(`${prepared}/${artifact.name}`)) !== artifact.sha256)
        throw new Error('Prepared artifact changed')
    }
    const pixels = await readFile(`${prepared}/input.rgba8`)
    if (!Number.isSafeInteger(width * height * 4) || pixels.length !== width * height * 4)
      throw new Error('Input extent mismatch')
    const image = () => sharp(pixels, { raw: { width, height, channels: 4 } })
    const inputPng = `${root}/input.png`
    await writeFile(inputPng, await image().withIccProfile('srgb').png().toBuffer())
    const rgba = async (path: string): Promise<Uint8Array> => {
      const output = await sharp(path)
        .toColourspace('srgb')
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      if (
        output.info.width !== width ||
        output.info.height !== height ||
        output.info.channels !== 4
      )
        throw new Error('Decoded extent changed')
      return output.data
    }
    for (const engine of ['purejsimage', 'libjxl', 'webp', 'avif'] as const) {
      for (const setting of engine === 'purejsimage' || engine === 'libjxl'
        ? [0.25, 0.5, 1, 2, 3, 5]
        : [40, 55, 70, 80, 90, 97]) {
        try {
          const path = `${root}/${engine}-${setting}`
          let encoded: Uint8Array,
            decoded: Uint8Array,
            independentMaximum: number | null = null,
            ownMaximum: number | null = null
          if (engine === 'purejsimage' || engine === 'libjxl') {
            if (engine === 'purejsimage') {
              const sink = new Uint8ArraySink()
              for (const part of encodeJpegXlVarDct8(
                pixels,
                width,
                height,
                setting,
                undefined,
                4,
                7,
              ))
                await sink.write(part)
              encoded = sink.toUint8Array()
              await writeFile(`${path}.jxl`, encoded)
            } else {
              run(`${tools}/cjxl`, [
                inputPng,
                `${path}.jxl`,
                '-d',
                String(setting),
                '-e',
                '7',
                '--num_threads=1',
                '--container=0',
              ])
              encoded = await readFile(`${path}.jxl`)
            }
            run(`${tools}/djxl`, [
              `${path}.jxl`,
              `${path}.png`,
              '--num_threads=1',
              '--bits_per_sample=8',
            ])
            decoded = await rgba(`${path}.png`)
            for (let index = 3; index < pixels.length; index += 4)
              if (decoded[index] !== pixels[index]) throw new Error('JXL alpha is not exact')
            if (engine === 'purejsimage') {
              run(rust, [
                `${path}.jxl`,
                `${path}-rust.png`,
                '--num-threads',
                '1',
                '--data-type',
                'u8',
              ])
              const independent = await rgba(`${path}-rust.png`)
              independentMaximum = 0
              for (let index = 0; index < pixels.length; index++)
                independentMaximum = Math.max(
                  independentMaximum,
                  Math.abs((decoded[index] ?? 0) - (independent[index] ?? 0)),
                )
              if (independentMaximum > 1)
                throw new Error(`Independent RGBA mismatch ${independentMaximum}`)
              for (let index = 3; index < pixels.length; index += 4)
                if (independent[index] !== pixels[index]) throw new Error('Rust alpha is not exact')
              const decoder = await jpegxlCodec.createDecoder?.(
                new MemorySource(encoded),
                defaultImageLimits,
              )
              if (decoder?.pixelFormat !== 'rgba8') throw new Error('Missing own RGBA8 decoder')
              ownMaximum = 0
              let nextRow = 0
              for await (const block of decoder.decode()) {
                try {
                  if (
                    block.format !== 'rgba8' ||
                    block.x !== 0 ||
                    block.y !== nextRow ||
                    block.width !== width ||
                    block.height < 1 ||
                    nextRow + block.height > height
                  )
                    throw new Error('Own RGBA8 output has invalid row coverage')
                  for (let y = 0; y < block.height; y++) {
                    for (let x = 0; x < width * 4; x++) {
                      const sourceIndex = (nextRow + y) * width * 4 + x
                      const sample = block.data[y * block.stride + x] ?? -1000
                      ownMaximum = Math.max(
                        ownMaximum,
                        Math.abs(sample - (decoded[sourceIndex] ?? 1000)),
                      )
                      if ((x & 3) === 3 && sample !== pixels[sourceIndex])
                        throw new Error('Own alpha is not exact')
                    }
                  }
                  nextRow += block.height
                } finally {
                  block.release?.()
                }
              }
              if (nextRow !== height || ownMaximum > 2)
                throw new Error(`Own RGBA8 mismatch ${ownMaximum}; rows ${nextRow}/${height}`)
            }
          } else {
            encoded = await (engine === 'webp'
              ? image().webp({ quality: setting, effort: 6, alphaQuality: 100 })
              : image().avif({ quality: setting, effort: 6, chromaSubsampling: '4:2:0' })
            ).toBuffer()
            await writeFile(`${path}.${engine}`, encoded)
            decoded = await rgba(`${path}.${engine}`)
          }
          let alphaMaximumError = 0
          for (let index = 3; index < pixels.length; index += 4)
            alphaMaximumError = Math.max(
              alphaMaximumError,
              Math.abs((decoded[index] ?? 0) - (pixels[index] ?? 0)),
            )
          const composites: object[] = []
          for (const background of [0, 1] as const) {
            const color = background === 0 ? 'black' : 'white'
            const output = new Uint8Array(width * height * 3)
            for (let position = 0; position < width * height; position++)
              for (let channel = 0; channel < 3; channel++)
                output[position * 3 + channel] = m7CompositeSample(
                  decoded[position * 4 + channel] ?? 0,
                  decoded[position * 4 + 3] ?? 0,
                  background,
                )
            const display = `${path}-${color}.ppm`,
              reference = `${prepared}/background-${color}.ppm`
            await writeFile(
              display,
              Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), output]),
            )
            const decodedSha256 = hash(output)
            const cached = metricCache
              ? await reuseM7ExpansionMetrics({
                  reportPath: `.tmp/jpegxl-m7/alpha-${split}-${metricCache}/${entry.id}/report.json`,
                  protocolPath: `.tmp/jpegxl-m7/alpha-${split}-${metricCache}/protocol.json`,
                  protocol,
                  kind: 'alpha',
                  id: entry.id,
                  sourceSha256: entry.sourceSha256,
                  engine,
                  setting,
                  domain: color,
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
              throw new Error('Invalid composite metrics')
            composites.push({
              background: color,
              ssimulacra2,
              butteraugli,
              ssimulacra2Text,
              butteraugliText,
              decodedSha256,
              ...(cached ? { metricReuse: cached.metricReuse } : {}),
            })
          }
          points.push({
            engine,
            setting,
            status: 'measured',
            bytes: encoded.length,
            encodedSha256: hash(encoded),
            decodedSha256: hash(decoded),
            independentMaximum,
            ownMaximum,
            alphaMaximumError,
            composites,
          })
        } catch (error) {
          failures++
          points.push({ engine, setting, status: 'failed', error: String(error) })
        }
        await writeFile(
          `${root}/report.json`,
          `${JSON.stringify({ id: entry.id, sourceSha256: entry.sourceSha256, points, stablePromotionGatePassed: false }, null, 2)}\n`,
        )
      }
    }
  } catch (error) {
    failures++
    await writeFile(
      `${root}/failure.json`,
      `${JSON.stringify({ id: entry.id, error: String(error) }, null, 2)}\n`,
    )
  }
  console.log(JSON.stringify({ id: entry.id, points: points.length, failures }))
}
console.log(JSON.stringify({ cases: cases.length, failures }))
if (failures) process.exitCode = 1
