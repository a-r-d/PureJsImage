import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, open, readFile, rm, writeFile, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { EncodeRequest, ImageEncoder } from '../../src/codec.ts'
import type { ImageSink } from '../../src/sink.ts'

const argument = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(name)
  if (index < 0) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const root = resolve(argument('--root', '.'))
const revision = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).stdout.trim()
const sourceHash = createHash('sha256')
  .update(await readFile(resolve(root, 'src/codecs/jpegxl-modular-encode.ts')))
  .digest('hex')
if (process.argv.includes('--worker')) {
  const width = Number(argument('--width', '512')),
    height = Number(argument('--height', '512'))
  const effort = Number(argument('--effort', '7'))
  const mode = argument('--mode', 'cold')
  const imported: unknown = await import(
    pathToFileURL(resolve(root, 'src/codecs/jpegxl-modular-encode.ts')).href
  )
  if (!object(imported) || typeof imported.createJpegXlModularEncoder !== 'function')
    throw new Error('Encoder unavailable')
  const create = imported.createJpegXlModularEncoder
  const pixels = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3
      pixels[i] = (x + y) & 255
      pixels[i + 1] = (x * 3 + (y >>> 2)) & 255
      pixels[i + 2] = ((x >>> 2) + y * 5) & 255
    }
  let verificationFile: FileHandle | undefined
  const execute = async () => {
    let bytes = 0,
      writes = 0
    const hash = createHash('sha256')
    const sink: ImageSink = {
      async write(data) {
        bytes += data.byteLength
        writes += 1
        hash.update(data)
        if (verificationFile) await verificationFile.writeFile(data)
      },
      async close() {},
      async abort() {},
    }
    const request: EncodeRequest = {
      width,
      height,
      pixelFormat: 'rgb8',
      colorSemantics: {
        family: 'rgb',
        primaries: 'srgb',
        transfer: { kind: 'srgb' },
        matrix: 'identity',
        range: 'full',
        alpha: 'none',
        provenance: 'assumed-default',
        renderingIntent: 'relative',
      },
      options: { effort },
    }
    const started = performance.now()
    const candidate: unknown = await create(sink, request)
    if (
      !object(candidate) ||
      typeof candidate.write !== 'function' ||
      typeof candidate.finish !== 'function'
    )
      throw new Error('Invalid encoder')
    await candidate.write({
      x: 0,
      y: 0,
      width,
      height,
      stride: width * 3,
      format: 'rgb8',
      data: pixels,
    } satisfies Parameters<ImageEncoder['write']>[0])
    await candidate.finish()
    const milliseconds = performance.now() - started
    const counters = {
      peak: candidate.managedPeakBytes,
      live: candidate.managedLiveBytes,
      allocations: candidate.managedLiveAllocations,
    }
    return {
      milliseconds,
      megapixelsPerSecond: (width * height) / 1000 / milliseconds,
      outputBytes: bytes,
      sinkWrites: writes,
      sha256: hash.digest('hex'),
      managed: counters,
    }
  }
  if (mode === 'warm') await execute()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    globalThis.gc?.()
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  const baseline = process.memoryUsage()
  const measurement = await execute()
  const after = process.memoryUsage()
  const absolutePeakRssBytes = process.resourceUsage().maxRSS * 1024
  const directory = await mkdtemp(join(tmpdir(), 'purejsimage-jxl-memory-'))
  try {
    const encodedPath = join(directory, 'encoded.jxl'),
      decodedPath = join(directory, 'decoded.ppm')
    verificationFile = await open(encodedPath, 'w')
    let verified: Awaited<ReturnType<typeof execute>>
    try {
      verified = await execute()
    } finally {
      await verificationFile.close()
      verificationFile = undefined
    }
    if (verified.sha256 !== measurement.sha256)
      throw new Error('Measured encoder output differs from independent validation run')
    const oracle = argument(
      '--oracle-tools',
      '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools',
    )
    const decoded = spawnSync(
      join(oracle, 'djxl'),
      [encodedPath, decodedPath, '--bits_per_sample=8'],
      { encoding: 'utf8' },
    )
    if (decoded.status !== 0) throw new Error(decoded.stderr || String(decoded.error))
    const bytes = await readFile(decodedPath)
    const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(bytes.subarray(0, 128).toString('ascii'))
    if (
      !header ||
      Number(header[1]) !== width ||
      Number(header[2]) !== height ||
      createHash('sha256').update(bytes.subarray(header[0].length)).digest('hex') !==
        createHash('sha256').update(pixels).digest('hex')
    )
      throw new Error('Independent memory workload pixel mismatch')
    console.log(
      JSON.stringify({
        width,
        height,
        effort,
        mode,
        inputBytes: pixels.byteLength,
        baseline,
        after,
        absolutePeakRssBytes,
        ...measurement,
        independentExactPixels: true,
      }),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
} else {
  const results: unknown[] = []
  for (const [width, height] of [
    [512, 512],
    [6000, 4000],
  ])
    for (const effort of [1, 3, 5, 7])
      for (const mode of ['cold', 'warm']) {
        const child = spawnSync(
          process.execPath,
          [
            '--expose-gc',
            fileURLToPath(import.meta.url),
            '--worker',
            '--root',
            root,
            '--oracle-tools',
            argument(
              '--oracle-tools',
              '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools',
            ),
            '--width',
            String(width),
            '--height',
            String(height),
            '--effort',
            String(effort),
            '--mode',
            mode,
          ],
          { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
        )
        if (child.status !== 0) throw new Error(child.stderr || child.stdout)
        const result: unknown = JSON.parse(child.stdout)
        if (
          !object(result) ||
          typeof result.sha256 !== 'string' ||
          typeof result.milliseconds !== 'number'
        )
          throw new Error('Invalid worker report')
        results.push(result)
        console.error(
          `${width}x${height} effort ${effort} ${mode}: ${result.milliseconds.toFixed(1)} ms`,
        )
      }
  const report = {
    schemaVersion: 2,
    revision,
    sourceSha256: sourceHash,
    generatedAt: new Date().toISOString(),
    allocationMetric:
      'actual encoder-owned backing buffers when live counters are present; legacy baseline peak is an estimate',
    validation: {
      passed: true,
      oracle: 'djxl a7a9c787341cf703dede03c2009fa460cae5e5df',
      policy:
        'Every measured hash matches a separate independently decoded exact-pixel encode. Timings and process peak are captured before independent verification.',
    },
    memoryScope:
      'caller input and hashing sink excluded from managed buffers; absolute process peak RSS includes both and warmup; three explicit collections before warm baseline',
    workloads:
      'disclosed procedural RGB8 at 512x512 and native 24 MP; all requested efforts, sectioned large-image path',
    results,
  }
  const output = argument('--output', '.tmp/pr35-remediation/encoder-memory.json')
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Wrote ${output}`)
}
