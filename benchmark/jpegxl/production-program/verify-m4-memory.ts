import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { jpegxlCodec } from '../../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../../src/limits.ts'
import { MemorySource } from '../../../src/source.ts'

const work = '.tmp/jpegxl-m4-memory'
const tools = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const snapshot = (): Readonly<{
  rss: number
  heapUsed: number
  external: number
  arrayBuffers: number
}> => {
  const { rss, heapUsed, external, arrayBuffers } = process.memoryUsage()
  return { rss, heapUsed, external, arrayBuffers }
}
const decode = async (
  input: Uint8Array,
): Promise<
  Readonly<{
    outputHash: string
    outputBytes: number
    peak: ReturnType<typeof snapshot>
    milliseconds: number
  }>
> => {
  const start = performance.now()
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(input), defaultImageLimits, {
    hdrOutput: 'linear-float',
  })
  if (!decoder || decoder.pixelFormat !== 'rgbf32') throw new Error('HDR float decoder unavailable')
  const digest = createHash('sha256')
  let outputBytes = 0
  const peak = { ...snapshot() }
  for await (const block of decoder.decode()) {
    try {
      digest.update(block.data)
      outputBytes += block.data.length
      const current = snapshot()
      for (const key of ['rss', 'heapUsed', 'external', 'arrayBuffers'] as const)
        peak[key] = Math.max(peak[key], current[key])
    } finally {
      block.release?.()
    }
  }
  if (outputBytes !== decoder.width * decoder.height * 12)
    throw new Error('Incomplete float output')
  return {
    outputHash: digest.digest('hex'),
    outputBytes,
    peak,
    milliseconds: performance.now() - start,
  }
}

if (process.argv[2] === '--worker') {
  const path = process.argv[3]
  if (!path) throw new Error('Missing worker input')
  const input = new Uint8Array(await readFile(path))
  if (process.argv[4] === 'warm') await decode(input)
  if (!globalThis.gc) throw new Error('Memory worker requires --expose-gc')
  for (let round = 0; round < 3; round++) {
    globalThis.gc()
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  const baseline = snapshot()
  const result = await decode(input)
  globalThis.gc()
  await new Promise<void>((resolve) => setImmediate(resolve))
  globalThis.gc()
  console.log(
    JSON.stringify({
      mode: process.argv[4],
      inputHash: hash(input),
      inputBytes: input.length,
      baseline,
      ...result,
      afterCollection: snapshot(),
      absoluteProcessPeakRss: process.resourceUsage().maxRSS * 1024,
    }),
  )
} else {
  await mkdir(work, { recursive: true })
  const results: unknown[] = []
  for (const size of [512, 1024]) {
    const pixels = new Uint8Array(size * size * 6)
    const view = new DataView(pixels.buffer)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        for (let c = 0; c < 3; c++)
          view.setUint16(
            (y * size * 3 + x * 3 + c) * 2,
            Math.round((((x * 7 + y * 3 + c * 251) % 1024) / 1023) * 65535),
            false,
          )
    const ppm = `${work}/pq-${size}.ppm`
    const path = `${work}/pq-${size}.jxl`
    await writeFile(ppm, Buffer.concat([Buffer.from(`P6\n${size} ${size}\n65535\n`), pixels]))
    const encoded = spawnSync(
      `${tools}/cjxl`,
      [ppm, path, '-d', '1', '-e', '1', '--num_threads=1', '-x', 'color_space=RGB_D65_202_Rel_PeQ'],
      { encoding: 'utf8' },
    )
    if (encoded.status !== 0) throw new Error(encoded.stderr)
    const oraclePath = `${work}/pq-${size}.npy`
    const oracle = spawnSync(
      `${tools}/djxl`,
      [path, oraclePath, '--num_threads=1', '--color_space=RGB_D65_SRG_Rel_Lin'],
      { encoding: 'utf8' },
    )
    if (oracle.status !== 0) throw new Error(oracle.stderr)
    const reference = await readFile(oraclePath)
    const offset = 10 + reference.readUInt16LE(8)
    const input = new Uint8Array(await readFile(path))
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(input), defaultImageLimits, {
      hdrOutput: 'linear-float',
    })
    if (!decoder) throw new Error('Decoder unavailable')
    let maximumNormalizedError = 0,
      squared = 0,
      samples = 0
    const digest = createHash('sha256')
    for await (const block of decoder.decode()) {
      try {
        digest.update(block.data)
        const data = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
        for (let i = 0; i < block.data.length; i += 4) {
          const difference =
            Math.abs(
              data.getFloat32(i, false) -
                (reference.readFloatLE(offset + samples * 4) * 10000) / 203,
            ) /
            (10000 / 203)
          maximumNormalizedError = Math.max(maximumNormalizedError, difference)
          squared += difference * difference
          samples++
        }
      } finally {
        block.release?.()
      }
    }
    const rmse = Math.sqrt(squared / samples)
    if (maximumNormalizedError > 1 / 255 || rmse > 0.55 / 255)
      throw new Error(`HDR oracle mismatch: ${maximumNormalizedError}, ${rmse}`)
    const expectedHash = digest.digest('hex')
    for (const mode of ['cold', 'warm']) {
      const child = spawnSync(
        process.execPath,
        ['--expose-gc', fileURLToPath(import.meta.url), '--worker', path, mode],
        { encoding: 'utf8' },
      )
      if (child.status !== 0) throw new Error(child.stderr)
      const value: unknown = JSON.parse(child.stdout)
      if (
        typeof value !== 'object' ||
        value === null ||
        !('outputHash' in value) ||
        value.outputHash !== expectedHash
      )
        throw new Error('Memory worker output changed')
      results.push({ size, maximumNormalizedError, rmse, ...value })
    }
  }
  await writeFile(
    'benchmark/jpegxl/production-program/m4-memory.json',
    `${JSON.stringify({ schemaVersion: 1, libjxlRevision: 'a7a9c787341cf703dede03c2009fa460cae5e5df', memoryClass: 'Explicit full-frame high-depth VarDCT fallback; ordinary M3 sRGB band path is unchanged', peakPolicy: 'Absolute isolated-process peak includes warmup; warm baseline follows three collections across event-loop turns', results }, null, 2)}\n`,
  )
  console.log('Four isolated HDR memory cases passed independent pixel validation')
}
