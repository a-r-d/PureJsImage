/** Development-only pinned libjxl C API progressive oracle. Run with Bun on Linux x64. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const inputPath = process.argv[2]
const outputDirectory = process.argv[3]
if (!inputPath || !outputDirectory)
  throw new Error('Usage: bun benchmark/jpegxl/flush-progressive-oracle.ts INPUT OUTPUT_DIRECTORY')
if (process.platform !== 'linux' || process.arch !== 'x64')
  throw new Error('The pinned C ABI requires Linux x64')
const libraryPath = resolve('.tmp/jpegxl-remediation-oracle/lib/libjxl.so.0.12.0')
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const librarySha256 = sha256(await readFile(libraryPath))
if (librarySha256 !== '29eea9f83a05f1851e18fc5f414916ca6c28e278f68622969bea68d7516ecdc5')
  throw new Error('The progressive oracle requires the pinned libjxl shared library')
const ffiPath = 'bun:ffi'
const ffi: unknown = await import(ffiPath)
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
if (!record(ffi) || typeof ffi.dlopen !== 'function') throw new Error('Run the oracle with Bun')
const definitions = {
  JxlDecoderVersion: { args: [], returns: 'u32' },
  JxlDecoderCreate: { args: ['ptr'], returns: 'ptr' },
  JxlDecoderDestroy: { args: ['ptr'], returns: 'void' },
  JxlDecoderSubscribeEvents: { args: ['ptr', 'i32'], returns: 'u32' },
  JxlDecoderSetProgressiveDetail: { args: ['ptr', 'i32'], returns: 'u32' },
  JxlDecoderSetKeepOrientation: { args: ['ptr', 'i32'], returns: 'u32' },
  JxlDecoderSetInput: { args: ['ptr', 'ptr', 'u64'], returns: 'u32' },
  JxlDecoderReleaseInput: { args: ['ptr'], returns: 'u64' },
  JxlDecoderProcessInput: { args: ['ptr'], returns: 'u32' },
  JxlDecoderGetBasicInfo: { args: ['ptr', 'ptr'], returns: 'u32' },
  JxlDecoderPreviewOutBufferSize: { args: ['ptr', 'ptr', 'ptr'], returns: 'u32' },
  JxlDecoderSetPreviewOutBuffer: { args: ['ptr', 'ptr', 'ptr', 'u64'], returns: 'u32' },
  JxlDecoderImageOutBufferSize: { args: ['ptr', 'ptr', 'ptr'], returns: 'u32' },
  JxlDecoderSetImageOutBuffer: { args: ['ptr', 'ptr', 'ptr', 'u64'], returns: 'u32' },
  JxlDecoderSetImageOutBitDepth: { args: ['ptr', 'ptr'], returns: 'u32' },
  JxlDecoderGetIntendedDownsamplingRatio: { args: ['ptr'], returns: 'u64' },
  JxlDecoderFlushImage: { args: ['ptr'], returns: 'u32' },
} as const
const library: unknown = ffi.dlopen(libraryPath, definitions)
if (!record(library) || !record(library.symbols) || typeof library.close !== 'function')
  throw new Error('Invalid C API library')
const symbols = library.symbols
const call = (
  name: keyof typeof definitions,
  ...args: (number | Uint8Array | BigUint64Array)[]
): unknown => {
  const fn = symbols[name]
  if (typeof fn !== 'function') throw new Error(`Missing ${name}`)
  return fn(...args)
}
const number = (value: unknown): number => {
  if (typeof value === 'bigint' && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER))
    return Number(value)
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new Error('Invalid C API integer')
  return value
}
const ok = (
  name: keyof typeof definitions,
  ...args: (number | Uint8Array | BigUint64Array)[]
): void => {
  if (call(name, ...args) !== 0) throw new Error(`${name} failed`)
}
if (call('JxlDecoderVersion') !== 12000) throw new Error('Wrong libjxl version')
const input = new Uint8Array(await readFile(inputPath))
const decoder = number(call('JxlDecoderCreate', 0))
if (!decoder) throw new Error('Could not create libjxl decoder')
const stages: {
  stage: number
  kind: 'flush' | 'final'
  intendedDownsampling: number
  consumedBytes: number
  file: string
  sha256: string
}[] = []
let previewPixels: Uint8Array | undefined
let previewWidth = 0
let previewHeight = 0
let pixels: Uint8Array | undefined
let width = 0
let height = 0
let channels = 0
let bitDepth = 0
let alphaBitDepth = 0
const format = new Uint8Array(24)
const pixelFormat = new DataView(format.buffer)
try {
  // kPasses includes complete DC and every AC pass. Preserve encoded coordinates.
  ok('JxlDecoderSubscribeEvents', decoder, 0x40 | 0x200 | 0x400 | 0x1000 | 0x8000)
  ok('JxlDecoderSetProgressiveDetail', decoder, 3)
  ok('JxlDecoderSetKeepOrientation', decoder, 1)
  ok('JxlDecoderSetInput', decoder, input, input.length)
  await mkdir(outputDirectory, { recursive: true })
  for (let eventCount = 0; ; eventCount += 1) {
    if (eventCount >= 256) throw new Error('Oracle event limit exceeded')
    const status = number(call('JxlDecoderProcessInput', decoder))
    if (status === 0) break
    if (status === 1 || status === 2)
      throw new Error(`Native decode failed or needs more input: ${status}`)
    if (status === 0x40) {
      const info = new Uint8Array(512)
      ok('JxlDecoderGetBasicInfo', decoder, info)
      const basic = new DataView(info.buffer)
      previewWidth = basic.getUint32(72, true)
      previewHeight = basic.getUint32(76, true)
      width = basic.getUint32(4, true)
      height = basic.getUint32(8, true)
      bitDepth = basic.getUint32(12, true)
      alphaBitDepth = basic.getUint32(60, true)
      if (
        basic.getUint32(16, true) !== 0 ||
        basic.getUint32(64, true) !== 0 ||
        bitDepth > 16 ||
        alphaBitDepth > 16
      )
        throw new Error('This oracle output contract requires integer samples up to 16 bits')
      channels = basic.getUint32(52, true) + (basic.getUint32(60, true) > 0 ? 1 : 0)
      pixelFormat.setUint32(0, channels, true)
      pixelFormat.setUint32(4, Math.max(bitDepth, alphaBitDepth) > 8 ? 3 : 2, true)
      pixelFormat.setUint32(8, 2, true) // JXL_BIG_ENDIAN, matching native sample blocks.
    } else if (status === 3) {
      const size = new BigUint64Array(1)
      ok('JxlDecoderPreviewOutBufferSize', decoder, format, size)
      const bytes = size[0]
      if (bytes === undefined || bytes > 536_870_912n)
        throw new Error('Preview exceeds oracle limit')
      previewPixels = new Uint8Array(Number(bytes))
      ok('JxlDecoderSetPreviewOutBuffer', decoder, format, previewPixels, previewPixels.length)
    } else if (status === 0x200) {
      if (!previewPixels) throw new Error('Missing native preview buffer')
      await writeFile(resolve(outputDirectory, 'embedded-preview.bin'), previewPixels)
    } else if (status === 5) {
      const size = new BigUint64Array(1)
      ok('JxlDecoderImageOutBufferSize', decoder, format, size)
      const bytes = size[0]
      if (bytes === undefined || bytes > 536_870_912n)
        throw new Error('Oracle output exceeds 512 MiB')
      pixels = new Uint8Array(Number(bytes))
      ok('JxlDecoderSetImageOutBuffer', decoder, format, pixels, pixels.length)
      const depth = new Uint8Array(12)
      new DataView(depth.buffer).setUint32(0, 1, true) // JXL_BIT_DEPTH_FROM_CODESTREAM.
      ok('JxlDecoderSetImageOutBitDepth', decoder, depth)
    } else if (status === 0x8000 || status === 0x1000) {
      if (!pixels) throw new Error('Native stage has no output buffer')
      if (status === 0x8000) ok('JxlDecoderFlushImage', decoder)
      const intendedDownsampling =
        status === 0x1000 ? 1 : number(call('JxlDecoderGetIntendedDownsamplingRatio', decoder))
      const remaining = number(call('JxlDecoderReleaseInput', decoder))
      const consumedBytes = input.length - remaining
      if (consumedBytes < 0 || consumedBytes > input.length)
        throw new Error('Native input offset is invalid')
      const file = `stage-${stages.length}.bin`
      await writeFile(resolve(outputDirectory, file), pixels)
      stages.push({
        stage: stages.length,
        kind: status === 0x1000 ? 'final' : 'flush',
        intendedDownsampling,
        consumedBytes,
        file,
        sha256: sha256(pixels),
      })
      if (remaining) ok('JxlDecoderSetInput', decoder, input.subarray(consumedBytes), remaining)
    } else if (status !== 0x400) throw new Error(`Unexpected native event ${status}`)
  }
  if (stages.at(-1)?.kind !== 'final')
    throw new Error('Oracle did not produce a verified final image')
  await writeFile(
    resolve(outputDirectory, 'manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        sourceRevision: 'a7a9c787341cf703dede03c2009fa460cae5e5df',
        librarySha256,
        api: [
          'JxlDecoderSetProgressiveDetail(kPasses)',
          'JxlDecoderFlushImage',
          'JxlDecoderGetIntendedDownsamplingRatio',
        ],
        inputPath,
        inputSha256: sha256(input),
        inputBytes: input.length,
        width,
        height,
        channels,
        bitDepth,
        alphaBitDepth,
        output:
          'encoded-coordinate integer samples; 16-bit samples use big endian; flush stages retain full dimensions',
        preview: previewPixels
          ? {
              width: previewWidth,
              height: previewHeight,
              file: 'embedded-preview.bin',
              sha256: sha256(previewPixels),
            }
          : null,
        stages,
      },
      null,
      2,
    )}\n`,
  )
} finally {
  call('JxlDecoderDestroy', decoder)
  library.close()
}
