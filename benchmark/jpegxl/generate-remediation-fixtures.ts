/** Development-only libjxl C API fixture generator. Run with Bun on Linux x64.
 * The codec under test does not generate the input codestreams or oracle pixels.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const revision = 'a7a9c787341cf703dede03c2009fa460cae5e5df'
const libraryPath = resolve(process.argv[2] ?? '.tmp/jpegxl-remediation-oracle/lib/libjxl.so')
const tools = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const directory = 'tests/fixtures/jpegxl/remediation'
const temporary = '.tmp/pr35-remediation'
await mkdir(directory, { recursive: true })
await mkdir(temporary, { recursive: true })
if (process.platform !== 'linux' || process.arch !== 'x64')
  throw new Error('This pinned C ABI fixture generator requires Linux x64')
const git = spawnSync(
  'git',
  ['-C', '.tmp/jpegxl-oracles/libjxl-v0.12.0/source', 'rev-parse', 'HEAD'],
  { encoding: 'utf8' },
)
if (git.status !== 0 || git.stdout.trim() !== revision) {
  const archive = await readFile('.tmp/jpegxl-oracles/libjxl-v0.12.0/source-a7a9c787.tar.gz')
  if (
    createHash('sha256').update(archive).digest('hex') !==
    '818398895831069902e3677d285054a7d1255b11b221e94c6aaa1cb83b0a3f29'
  )
    throw new Error('Wrong libjxl source archive')
}
const ffiPath = 'bun:ffi'
const ffi: unknown = await import(ffiPath)
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
if (!record(ffi) || typeof ffi.dlopen !== 'function' || typeof ffi.ptr !== 'function')
  throw new Error('Run this development oracle with Bun')
const definitions = {
  JxlEncoderVersion: { args: [], returns: 'u32' },
  JxlEncoderCreate: { args: ['ptr'], returns: 'ptr' },
  JxlEncoderDestroy: { args: ['ptr'], returns: 'void' },
  JxlEncoderInitBasicInfo: { args: ['ptr'], returns: 'void' },
  JxlEncoderSetBasicInfo: { args: ['ptr', 'ptr'], returns: 'u32' },
  JxlColorEncodingSetToSRGB: { args: ['ptr', 'i32'], returns: 'void' },
  JxlEncoderSetColorEncoding: { args: ['ptr', 'ptr'], returns: 'u32' },
  JxlEncoderSetICCProfile: { args: ['ptr', 'ptr', 'u64'], returns: 'u32' },
  JxlEncoderFrameSettingsCreate: { args: ['ptr', 'ptr'], returns: 'ptr' },
  JxlEncoderSetFrameLossless: { args: ['ptr', 'i32'], returns: 'u32' },
  JxlEncoderSetFrameBitDepth: { args: ['ptr', 'ptr'], returns: 'u32' },
  JxlEncoderFrameSettingsSetOption: { args: ['ptr', 'i32', 'i64'], returns: 'u32' },
  JxlEncoderAddImageFrame: { args: ['ptr', 'ptr', 'ptr', 'u64'], returns: 'u32' },
  JxlEncoderCloseInput: { args: ['ptr'], returns: 'void' },
  JxlEncoderProcessOutput: { args: ['ptr', 'ptr', 'ptr'], returns: 'u32' },
} as const
const library: unknown = ffi.dlopen(libraryPath, definitions)
if (!record(library) || !record(library.symbols) || typeof library.close !== 'function')
  throw new Error('Invalid FFI library')
const symbols = library.symbols
const call = (
  name: keyof typeof definitions,
  ...args: (number | Uint8Array | Uint32Array | Float32Array | BigUint64Array)[]
): unknown => {
  const fn = symbols[name]
  if (typeof fn !== 'function') throw new Error(`Missing ${name}`)
  return fn(...args)
}
const number = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Invalid C API numeric result')
  return value
}
const ok = (
  name: keyof typeof definitions,
  ...args: (number | Uint8Array | Uint32Array | Float32Array | BigUint64Array)[]
): void => {
  if (call(name, ...args) !== 0) throw new Error(`${name} failed`)
}
if (call('JxlEncoderVersion') !== 12000) throw new Error('Wrong libjxl library version')
const toneMapping = {
  intensityTarget: 2000,
  minNits: 0.125,
  relativeToMaxDisplay: true,
  linearBelow: 0.25,
}
const cases = [
  { id: 'hlg-12', color: 3, depth: 12, alpha: 0, transfer: 18, associated: false },
  { id: 'hlg-alpha-12-8', color: 3, depth: 12, alpha: 8, transfer: 18, associated: false },
  { id: 'pq-12', color: 3, depth: 12, alpha: 0, transfer: 16, associated: false },
  { id: 'pq-alpha-12-16', color: 3, depth: 12, alpha: 16, transfer: 16, associated: false },
  { id: 'gray-alpha-8-8', color: 1, depth: 8, alpha: 8, transfer: 13, associated: false },
  { id: 'gray-alpha-12-8', color: 1, depth: 12, alpha: 8, transfer: 13, associated: false },
  { id: 'gray-alpha-16-16', color: 1, depth: 16, alpha: 16, transfer: 13, associated: false },
  { id: 'gray-associated-12-8', color: 1, depth: 12, alpha: 8, transfer: 13, associated: true },
  { id: 'gray-icc-alpha-8-8', color: 1, depth: 8, alpha: 8, transfer: 13, associated: false },
] as const
const results = []
try {
  for (const entry of cases) {
    const encoder = number(call('JxlEncoderCreate', 0))
    if (!encoder) throw new Error('Could not create libjxl encoder')
    try {
      const width = 5,
        height = 3,
        channels = entry.color + (entry.alpha ? 1 : 0)
      // Fixed libjxl 0.12.0 public C structs, Linux x64 ABI. Oversized storage
      // accommodates the documented BasicInfo forward-compatibility padding.
      const info = new Uint8Array(512),
        basic = new DataView(info.buffer)
      call('JxlEncoderInitBasicInfo', info)
      basic.setUint32(4, width, true)
      basic.setUint32(8, height, true)
      basic.setUint32(12, entry.depth, true)
      basic.setUint32(36, 1, true)
      basic.setUint32(52, entry.color, true)
      basic.setUint32(56, entry.alpha ? 1 : 0, true)
      basic.setUint32(60, entry.alpha, true)
      basic.setUint32(68, Number(entry.associated), true)
      if (entry.transfer === 18 || entry.transfer === 16) {
        basic.setFloat32(20, toneMapping.intensityTarget, true)
        basic.setFloat32(24, toneMapping.minNits, true)
        basic.setUint32(28, 1, true)
        basic.setFloat32(32, toneMapping.linearBelow, true)
      }
      ok('JxlEncoderSetBasicInfo', encoder, info)
      const color = new Uint8Array(104),
        colorView = new DataView(color.buffer)
      call('JxlColorEncodingSetToSRGB', color, Number(entry.color === 1))
      colorView.setUint32(24, entry.transfer === 13 ? 1 : 9, true)
      colorView.setUint32(80, entry.transfer, true)
      colorView.setUint32(96, 1, true)
      if (entry.id === 'gray-icc-alpha-8-8') {
        const sourcePath = '.tmp/jpegxl-conformance/testcases/grayscale/input.jxl'
        const source = await readFile(sourcePath)
        if (
          createHash('sha256').update(source).digest('hex') !==
          '78fbbba852e99946d187dcf0bcbd7fb0e7c22be2f0852523aaae6ed91e7e3c39'
        )
          throw new Error('Wrong pinned gray ICC source')
        const iccPath = `${temporary}/gray-source.icc`
        const result = spawnSync(
          `${tools}/djxl`,
          [
            sourcePath,
            `${temporary}/gray-source.png`,
            `--orig_icc_out=${iccPath}`,
            '--num_threads=1',
          ],
          { encoding: 'utf8' },
        )
        if (result.status !== 0) throw new Error(result.stderr)
        const profile = await readFile(iccPath)
        if (
          createHash('sha256').update(profile).digest('hex') !==
          '3f62598dfd40d6642ca5fd962559bb6615af15448a57a3972a4089c109e62fbd'
        )
          throw new Error('Wrong pinned gray profile')
        ok('JxlEncoderSetICCProfile', encoder, profile, profile.length)
      } else ok('JxlEncoderSetColorEncoding', encoder, color)
      const settings = number(call('JxlEncoderFrameSettingsCreate', encoder, 0))
      ok('JxlEncoderSetFrameLossless', settings, 1)
      ok('JxlEncoderFrameSettingsSetOption', settings, 0, 1)
      const input = new Uint8Array(width * height * channels * 2),
        values = new DataView(input.buffer)
      for (let pixel = 0; pixel < width * height; pixel++) {
        const alpha = (pixel % 5) / 4
        for (let c = 0; c < channels; c++) {
          const maximum = 2 ** (c === entry.color ? entry.alpha : entry.depth) - 1
          const normalized =
            c === entry.color
              ? alpha
              : (((pixel * 3 + c * 7) % 15) / 14) * (entry.associated ? alpha : 1)
          values.setUint16((pixel * channels + c) * 2, Math.round(normalized * maximum), false)
        }
      }
      const normalizedInput = new Float32Array(width * height * channels)
      for (let i = 0; i < normalizedInput.length; i++) {
        const maximum = 2 ** (i % channels === entry.color ? entry.alpha : entry.depth) - 1
        normalizedInput[i] = values.getUint16(i * 2, false) / maximum
      }
      // Float input lets libjxl quantize color and alpha at their independent depths.
      const format = new Uint32Array([channels, 0, 0, 0, 0, 0])
      ok('JxlEncoderAddImageFrame', settings, format, normalizedInput, normalizedInput.byteLength)
      call('JxlEncoderCloseInput', encoder)
      const output = new Uint8Array(65536)
      const pointer = new BigUint64Array([BigInt(number(ffi.ptr(output)))])
      const available = new BigUint64Array([BigInt(output.length)])
      ok('JxlEncoderProcessOutput', encoder, pointer, available)
      const bytes = output.slice(0, output.length - Number(available[0]))
      const path = `${directory}/${entry.id}.jxl`
      await writeFile(path, bytes)
      const reference = `${temporary}/${entry.id}.npy`
      const decoded = spawnSync(`${tools}/djxl`, [path, reference, '--num_threads=1'], {
        encoding: 'utf8',
      })
      if (decoded.status !== 0) throw new Error(decoded.stderr)
      const npy = await readFile(reference),
        start = 10 + npy.readUInt16LE(8)
      const samples = new Uint8Array(width * height * channels * 4),
        floats = new DataView(samples.buffer)
      if (npy.length - start !== samples.length) throw new Error('Unexpected djxl output layout')
      let maximumNormalizedError = 0
      for (let i = 0; i < width * height * channels; i++) {
        const actual = npy.readFloatLE(start + i * 4)
        floats.setFloat32(i * 4, actual, false)
        const maximum = 2 ** (i % channels === entry.color ? entry.alpha : entry.depth) - 1
        maximumNormalizedError = Math.max(
          maximumNormalizedError,
          Math.abs(actual - values.getUint16(i * 2, false) / maximum),
        )
      }
      if (maximumNormalizedError > 1e-6)
        throw new Error(`${entry.id}: independent sample mismatch ${maximumNormalizedError}`)
      await writeFile(`${directory}/${entry.id}.bin`, samples)
      const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
      results.push({
        ...entry,
        width,
        height,
        sha256: sha256(bytes),
        pixelsSha256: sha256(samples),
        maximumNormalizedError,
        ...(entry.transfer === 13 ? {} : { toneMapping }),
      })
    } finally {
      call('JxlEncoderDestroy', encoder)
    }
  }
} finally {
  library.close()
}
await writeFile(
  `${directory}/manifest.json`,
  JSON.stringify(
    {
      schemaVersion: 1,
      libjxlRevision: revision,
      libraryVersion: 12000,
      source: 'Analytical native integer samples generated before codec fixes',
      license:
        'MIT analytical pixels and generator; the embedded gray ICC profile retains the BSD-3-Clause conformance attribution in README.md and CONFORMANCE-LICENSE.txt',
      generation:
        'Bun FFI calling pinned libjxl 0.12.0 public C API; djxl encoded-sample float reference',
      cases: results,
    },
    null,
    2,
  ) + '\n',
)
console.log(`Generated and independently verified ${results.length} fixtures`)
