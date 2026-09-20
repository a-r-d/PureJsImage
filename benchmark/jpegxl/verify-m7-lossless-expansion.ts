import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'
import downloads from './production-program/m7-expansion-downloads.json' with { type: 'json' }

sharp.concurrency(1)
const runId = process.argv[2]
if (!runId || !/^[a-z0-9-]+$/u.test(runId)) throw new Error('Specify a unique run identifier')
const caseId = process.argv[3]
const cases = caseId
  ? downloads.cases.filter((entry) => entry.id === caseId && entry.split === 'development')
  : downloads.cases
if (cases.length === 0) throw new Error('Diagnostic case is outside the development split')
const directory = `.tmp/jpegxl-m7/lossless-expansion-${runId}`
await mkdir(directory, { recursive: true })
const tools = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const rust = '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli'
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const run = (tool: string, args: string[]): void => {
  const result = spawnSync(tool, args, { encoding: 'utf8', timeout: 600_000 })
  if (result.status !== 0) throw new Error(`${tool}: ${result.stderr}; ${result.error ?? ''}`)
}
const ppm = (bytes: Uint8Array, width: number, height: number): Uint8Array => {
  const header = /^P6\s+(\d+)\s+(\d+)\s+65535\s/u.exec(
    new TextDecoder().decode(bytes.subarray(0, 100)),
  )
  if (
    !header ||
    Number(header[1]) !== width ||
    Number(header[2]) !== height ||
    bytes.length !== header[0].length + width * height * 6
  )
    throw new Error('Invalid RGB16 oracle extent')
  return bytes.subarray(header[0].length)
}
const sourcePaths = [
  'src/codecs/jpegxl-modular-encode.ts',
  'src/codecs/jpegxl-decode.ts',
  'src/codecs/jpegxl-encoder-memory.ts',
]
const protocol = {
  selectedCaseIds: cases.map((entry) => entry.id),
  diagnosticSubset: caseId !== undefined,
  snapshotSources: await Promise.all(
    sourcePaths.map(async (path) => ({
      path,
      sha256: hash(await readFile(new URL(`../../${path}`, import.meta.url))),
    })),
  ),
  oracleFiles: await Promise.all(
    [`${tools}/cjxl`, `${tools}/djxl`, rust].map(async (path) => ({
      path,
      sha256: hash(await readFile(path)),
    })),
  ),
  sourceSelection: 'benchmark/jpegxl/production-program/m7-corpus-expansion.json',
  mappingProtocolSha256: hash(
    await readFile('benchmark/jpegxl/production-program/m7-hdr-alpha-protocol.json'),
  ),
  policy:
    'All 24 frozen expansion families, preserving their development/holdout splits. Native RGBA8 artwork and explicitly derived PQ16 HDR examples remain separate strata. PQ16 variants are not additional families or native integer-depth captures. Compare identical samples and color, exact invisible RGB and alpha, no metadata payload in either encoder. Timings are not measured in this concurrent conformance run.',
}
await writeFile(`${directory}/protocol.json`, `${JSON.stringify(protocol, null, 2)}\n`, {
  flag: 'wx',
})
const results: object[] = []
let failures = 0
for (const entry of cases) {
  try {
    if (entry.status !== 'verified') throw new Error('Frozen download failed')
    const source = await readFile(`.tmp/jpegxl-m7/sources/${entry.id}.${entry.format}`)
    if (hash(source) !== entry.sourceSha256) throw new Error('Frozen source hash mismatch')
    const high = entry.format === 'hdr'
    const inputDirectory = `.tmp/jpegxl-m7/expansion-inputs/${entry.id}`
    const info: unknown = JSON.parse(await readFile(`${inputDirectory}/input.json`, 'utf8'))
    if (
      typeof info !== 'object' ||
      info === null ||
      !('width' in info) ||
      !('height' in info) ||
      typeof info.width !== 'number' ||
      typeof info.height !== 'number' ||
      !('protocolSha256' in info) ||
      info.protocolSha256 !== protocol.mappingProtocolSha256 ||
      !('sourceSha256' in info) ||
      info.sourceSha256 !== entry.sourceSha256
    )
      throw new Error('Prepared input metadata mismatch')
    const { width, height } = info
    const pixels = high
      ? ppm(await readFile(`${inputDirectory}/input-pq16.ppm`), width, height)
      : await readFile(`${inputDirectory}/input.rgba8`)
    const stride = width * (high ? 6 : 4),
      format = high ? 'rgb16' : 'rgba8'
    if (pixels.length !== stride * height) throw new Error('Prepared input extent mismatch')
    const expectedHash = hash(pixels)
    const sink = new Uint8ArraySink()
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width,
      height,
      pixelFormat: format,
      limits: defaultImageLimits,
      colorSemantics: {
        family: 'rgb',
        primaries: 'srgb',
        transfer: high ? { kind: 'pq' } : { kind: 'srgb' },
        matrix: 'identity',
        range: 'full',
        alpha: high ? 'none' : 'straight',
        provenance: 'container-signaled',
        renderingIntent: 'relative',
      },
      options: { mode: 'lossless', effort: 7, sampleBitDepth: high ? 16 : 8 },
    })
    if (!encoder) throw new Error('Missing encoder')
    await encoder.write({ x: 0, y: 0, width, height, format, stride, data: pixels })
    await encoder.finish()
    const encoded = sink.toUint8Array(),
      output = `${directory}/${entry.id}.jxl`
    await writeFile(output, encoded)
    const oracles: object[] = []
    for (const oracle of ['libjxl', 'jxl-rs'] as const) {
      const decoded = `${directory}/${entry.id}-${oracle}.${high ? 'ppm' : 'png'}`
      run(
        oracle === 'libjxl' ? `${tools}/djxl` : rust,
        oracle === 'libjxl'
          ? [
              output,
              decoded,
              '--num_threads=1',
              `--bits_per_sample=${high ? 16 : 8}`,
              ...(high ? ['--color_space=RGB_D65_SRG_Rel_PeQ'] : []),
            ]
          : [output, decoded, '--num-threads', '1', '--data-type', high ? 'u16' : 'u8'],
      )
      const actual = high
        ? ppm(await readFile(decoded), width, height)
        : await sharp(decoded).toColourspace('srgb').ensureAlpha().raw().toBuffer()
      const decodedHash = hash(actual)
      if (decodedHash !== expectedHash) throw new Error(`${oracle} exact samples differ`)
      oracles.push({ oracle, decodedHash, exact: true })
    }
    const own = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits, {
      colorOutput: 'preserve',
    })
    if (!own || own.pixelFormat !== format) throw new Error('Own native sample format changed')
    let rows = 0
    for await (const block of own.decode()) {
      try {
        for (let y = 0; y < block.height; y++) {
          const actual = block.data.subarray(y * block.stride, y * block.stride + stride)
          if (
            hash(actual) !==
            hash(pixels.subarray((block.y + y) * stride, (block.y + y + 1) * stride))
          )
            throw new Error('Own decoded samples differ')
          rows++
        }
      } finally {
        block.release?.()
      }
    }
    if (rows !== height) throw new Error('Own row extent changed')
    let nativeInput = `${inputDirectory}/input-pq16.ppm`
    if (!high) {
      nativeInput = `${directory}/${entry.id}-input.pam`
      await writeFile(
        nativeInput,
        Buffer.concat([
          Buffer.from(
            `P7\nWIDTH ${width}\nHEIGHT ${height}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`,
          ),
          pixels,
        ]),
      )
    }
    const nativeOutput = `${directory}/${entry.id}-libjxl-e7.jxl`
    run(`${tools}/cjxl`, [
      nativeInput,
      nativeOutput,
      '-d',
      '0',
      '-e',
      '7',
      '--num_threads=1',
      '--keep_invisible=1',
      ...(high ? ['-x', 'color_space=RGB_D65_SRG_Rel_PeQ'] : []),
    ])
    const nativeBytes = await readFile(nativeOutput)
    results.push({
      id: entry.id,
      split: entry.split,
      sourceSha256: entry.sourceSha256,
      status: 'verified',
      width,
      height,
      format,
      sampleOrigin: high ? 'derived PQ16 from original relative HDR' : 'native RGBA8 artwork',
      normalizedHash: expectedHash,
      pureBytes: encoded.length,
      nativeBytes: nativeBytes.length,
      ratio: encoded.length / nativeBytes.length,
      encodedSha256: hash(encoded),
      oracles,
      ownExact: true,
    })
  } catch (error) {
    failures++
    results.push({ id: entry.id, split: entry.split, status: 'failed', error: String(error) })
  }
  await writeFile(
    `${directory}/report.json`,
    `${JSON.stringify({ protocol, completed: results.length, failures, results }, null, 2)}\n`,
  )
  console.log(`${results.length}/${cases.length}: ${entry.id}; failures=${failures}`)
}
if (failures) process.exitCode = 1
