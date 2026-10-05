import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { jpegxlCodec } from '../../../src/codecs/jpegxl.ts'
import { Uint8ArraySink } from '../../../src/sink.ts'
import { hashM8Sources } from '../m8-output-digest.ts'
import { hash, json, run } from './io.ts'

const output = process.argv[2]
if (!output) throw new Error('Specify a report path')
const directory = '.tmp/jpegxl-comparison-v1/parity-fast-fixtures'
await mkdir(directory, { recursive: true })
const tools = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const rust = '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli'
const rows = []
for (const depth of [8, 16] as const) {
  const maximum = 2 ** depth - 1,
    sampleBytes = depth / 8
  for (const kind of ['transparent', 'half-alpha', 'opaque', 'gray', 'noise'] as const) {
    const width = kind === 'gray' ? 3 : kind === 'noise' ? 8193 : 1025
    const height = kind === 'gray' ? 1025 : kind === 'noise' ? 3 : 41
    const channels = kind === 'gray' ? 1 : 4
    const format =
      channels === 1 ? (depth === 8 ? 'gray8' : 'gray16') : depth === 8 ? 'rgba8' : 'rgba16'
    const pixels = new Uint8Array(width * height * channels * sampleBytes)
    let state = 0x51d403e7
    for (let position = 0; position < width * height; position++) {
      const x = position % width,
        y = Math.floor(position / width)
      for (let channel = 0; channel < channels; channel++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        const value =
          kind === 'gray'
            ? depth === 8
              ? 179
              : 37299
            : kind === 'noise'
              ? state >>> (32 - depth)
              : channel === 3
                ? kind === 'transparent'
                  ? 0
                  : kind === 'half-alpha'
                    ? 2 ** (depth - 1)
                    : maximum
                : (x * (depth === 8 ? 1 : 37) + y * (depth === 8 ? 3 : 409) + channel * 1901) &
                  maximum
        const offset = (position * channels + channel) * sampleBytes
        if (sampleBytes === 2) pixels[offset] = value >>> 8
        pixels[offset + sampleBytes - 1] = value
      }
    }
    const sink = new Uint8ArraySink()
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width,
      height,
      pixelFormat: format,
      colorSemantics: {
        family: channels === 1 ? 'gray' : 'rgb',
        primaries: 'srgb',
        transfer: { kind: 'srgb' },
        matrix: 'identity',
        range: 'full',
        alpha: channels === 4 ? 'straight' : 'none',
        provenance: 'assumed-default',
        renderingIntent: 'relative',
      },
      options: { mode: 'lossless', effort: 1 },
    })
    if (!encoder) throw new Error('Missing encoder')
    await encoder.write({
      x: 0,
      y: 0,
      width,
      height,
      stride: width * channels * sampleBytes,
      format,
      data: pixels,
    })
    await encoder.finish()
    const encoded = sink.toUint8Array()
    const artifact = `${directory}/${kind}-${depth}.jxl`
    await writeFile(artifact, encoded)
    const oracles = []
    for (const oracle of [
      { name: 'libjxl', executable: `${tools}/djxl`, args: ['--num_threads=1'] },
      { name: 'jxl-rs', executable: rust, args: ['--num-threads', '1'] },
    ]) {
      const path = `${artifact}.${oracle.name}.npy`
      run(oracle.executable, [artifact, path, ...oracle.args])
      const npy = await readFile(path)
      if (npy[6] !== 1) throw new Error('Expected NPY version 1')
      const start = 10 + npy.readUInt16LE(8)
      const header = npy.subarray(10, start).toString('ascii')
      if (
        !header.includes("'<f4'") ||
        !header.includes(`(1, ${height}, ${width}, ${channels})`) ||
        npy.length !== start + width * height * channels * 4
      )
        throw new Error(`Unexpected normalized float layout: ${header}`)
      for (let sample = 0; sample < width * height * channels; sample++) {
        const expected =
          sampleBytes === 2
            ? (pixels[sample * 2] ?? 0) * 256 + (pixels[sample * 2 + 1] ?? 0)
            : (pixels[sample] ?? 0)
        const value = npy.readFloatLE(start + sample * 4)
        if (!Number.isFinite(value) || Math.round(value * maximum) !== expected)
          throw new Error(`${oracle.name}: changed ${kind}-${depth} sample ${sample}`)
      }
      oracles.push({
        oracle: oracle.name,
        executableSha256: hash(await readFile(oracle.executable)),
        normalizedFloatSha256: hash(npy),
        samplesCompared: width * height * channels,
        maximumSampleError: 0,
      })
    }
    rows.push({
      kind,
      depth,
      width,
      height,
      format,
      inputSha256: hash(pixels),
      artifact,
      bytes: encoded.length,
      encodedSha256: hash(encoded),
      status: 'verified',
      oracles,
    })
    console.log(`${kind}-${depth}: exact in both independent decoders`)
  }
}
await json(output, {
  schemaVersion: 1,
  implementationSourceSha256: await hashM8Sources(),
  verifierSha256: hash(await readFile(import.meta.filename)),
  policy:
    'Deterministic exact 8/16-bit samples, hidden RGB, constant alpha, vertical groups and independent noise crossing the DC group boundary. Decode to normalized Float32 and round to the original integer grid.',
  rows,
})
