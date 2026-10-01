/** Development-only pinned libjxl mixed integer-color/floating-alpha fixture encoder. Run with Bun. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

const libraryPath = '.tmp/jpegxl-remediation-oracle/lib/libjxl.so.0.12.0'
const hash = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
const librarySha256 = hash(new Uint8Array(await readFile(libraryPath)))
if (librarySha256 !== '29eea9f83a05f1851e18fc5f414916ca6c28e278f68622969bea68d7516ecdc5')
  throw new Error('Wrong pinned libjxl')
const record = (input: unknown): input is Record<string, unknown> =>
  typeof input === 'object' && input !== null
const ffiPath = 'bun:ffi',
  ffi: unknown = await import(ffiPath)
if (!record(ffi) || typeof ffi.dlopen !== 'function' || typeof ffi.ptr !== 'function')
  throw new Error('Run with Bun')
const pointerOf = ffi.ptr
const definitions = {
  JxlEncoderCreate: { args: ['ptr'], returns: 'ptr' },
  JxlEncoderDestroy: { args: ['ptr'], returns: 'void' },
  JxlEncoderUseContainer: { args: ['ptr', 'i32'], returns: 'u32' },
  JxlEncoderSetCodestreamLevel: { args: ['ptr', 'i32'], returns: 'u32' },
  JxlEncoderInitBasicInfo: { args: ['ptr'], returns: 'void' },
  JxlEncoderSetBasicInfo: { args: ['ptr', 'ptr'], returns: 'u32' },
  JxlEncoderInitExtraChannelInfo: { args: ['u32', 'ptr'], returns: 'void' },
  JxlEncoderSetExtraChannelInfo: { args: ['ptr', 'u64', 'ptr'], returns: 'u32' },
  JxlColorEncodingSetToLinearSRGB: { args: ['ptr', 'i32'], returns: 'void' },
  JxlEncoderSetColorEncoding: { args: ['ptr', 'ptr'], returns: 'u32' },
  JxlEncoderFrameSettingsCreate: { args: ['ptr', 'ptr'], returns: 'ptr' },
  JxlEncoderFrameSettingsSetOption: { args: ['ptr', 'i32', 'i64'], returns: 'u32' },
  JxlEncoderInitFrameHeader: { args: ['ptr'], returns: 'void' },
  JxlEncoderSetFrameHeader: { args: ['ptr', 'ptr'], returns: 'u32' },
  JxlEncoderSetExtraChannelBlendInfo: { args: ['ptr', 'u64', 'ptr'], returns: 'u32' },
  JxlEncoderAddImageFrame: { args: ['ptr', 'ptr', 'ptr', 'u64'], returns: 'u32' },
  JxlEncoderCloseInput: { args: ['ptr'], returns: 'void' },
  JxlEncoderProcessOutput: { args: ['ptr', 'ptr', 'ptr'], returns: 'u32' },
} as const
const library: unknown = ffi.dlopen(libraryPath, definitions)
if (!record(library) || !record(library.symbols) || typeof library.close !== 'function')
  throw new Error('Invalid library')
const symbols = library.symbols
const call = (
  name: keyof typeof definitions,
  ...args: (number | Uint8Array | Uint32Array | Float32Array | BigUint64Array)[]
): unknown => {
  const fn = symbols[name]
  if (typeof fn !== 'function') throw new Error(`Missing ${name}`)
  return fn(...args)
}
const integer = (input: unknown): number => {
  if (typeof input !== 'number' || !Number.isSafeInteger(input)) throw new Error('Invalid C result')
  return input
}
const ok = (
  name: keyof typeof definitions,
  ...args: (number | Uint8Array | Uint32Array | Float32Array | BigUint64Array)[]
): void => {
  if (call(name, ...args) !== 0) throw new Error(`${name} failed`)
}
const root = 'tests/fixtures/jpegxl/gap-alpha'
await mkdir(root, { recursive: true })
const fixtures = []
try {
  for (const [colorBits, colorExponent, bits, exponent, blend] of [
    [8, 0, 32, 8, false],
    [8, 0, 16, 4, false],
    [32, 8, 8, 0, false],
    [16, 5, 8, 0, false],
    [24, 8, 8, 0, false],
    [32, 8, 8, 0, true],
  ] as const)
    for (const associated of [false, true]) {
      const id = blend
        ? `vardct-linear-blend-${associated ? 'associated' : 'straight'}`
        : colorExponent === 0
          ? `vardct-alpha-${bits}-${exponent}-${associated ? 'associated' : 'straight'}`
          : `vardct-color-${colorBits}-${colorExponent}-${associated ? 'associated' : 'straight'}`
      const encoder = integer(call('JxlEncoderCreate', 0))
      try {
        ok('JxlEncoderUseContainer', encoder, 1)
        ok('JxlEncoderSetCodestreamLevel', encoder, 10)
        const info = new Uint8Array(512),
          basic = new DataView(info.buffer)
        call('JxlEncoderInitBasicInfo', info)
        basic.setUint32(4, 16, true)
        basic.setUint32(8, 16, true)
        basic.setUint32(12, colorBits, true)
        basic.setUint32(16, colorExponent, true)
        basic.setUint32(36, 0, true)
        basic.setUint32(52, 3, true)
        basic.setUint32(56, 1, true)
        basic.setUint32(60, bits, true)
        basic.setUint32(64, exponent, true)
        basic.setUint32(68, Number(associated), true)
        ok('JxlEncoderSetBasicInfo', encoder, info)
        const extra = new Uint8Array(64),
          view = new DataView(extra.buffer)
        call('JxlEncoderInitExtraChannelInfo', 0, extra)
        view.setUint32(4, bits, true)
        view.setUint32(8, exponent, true)
        view.setUint32(20, Number(associated), true)
        ok('JxlEncoderSetExtraChannelInfo', encoder, 0, extra)
        const color = new Uint8Array(256)
        call('JxlColorEncodingSetToLinearSRGB', color, 0)
        ok('JxlEncoderSetColorEncoding', encoder, color)
        for (let frame = 0; frame < (blend ? 2 : 1); frame++) {
          const settings = integer(call('JxlEncoderFrameSettingsCreate', encoder, 0))
          ok('JxlEncoderFrameSettingsSetOption', settings, 0, 7)
          if (blend) {
            const header = new Uint8Array(64),
              frameView = new DataView(header.buffer)
            call('JxlEncoderInitFrameHeader', header)
            frameView.setUint32(36, frame === 0 ? 0 : 2, true)
            frameView.setUint32(40, frame === 0 ? 0 : 1, true)
            frameView.setUint32(44, 0, true)
            frameView.setUint32(48, 1, true)
            frameView.setUint32(52, frame === 0 ? 1 : 0, true)
            ok('JxlEncoderSetFrameHeader', settings, header)
            ok('JxlEncoderSetExtraChannelBlendInfo', settings, 0, header.subarray(36, 52))
          }
          const data = new Float32Array(16 * 16 * 4)
          for (let pixel = 0; pixel < 256; pixel++) {
            const a = [0, 0.25, 0.5, 1][(pixel + frame) % 4] ?? 1
            for (let channel = 0; channel < 3; channel++)
              data[pixel * 4 + channel] =
                (((pixel + channel * 3 + frame * 5) % 16) / 16) * (associated ? a : 1)
            data[pixel * 4 + 3] = a
          }
          ok(
            'JxlEncoderAddImageFrame',
            settings,
            Uint32Array.of(4, 0, 0, 0, 0, 0),
            data,
            data.byteLength,
          )
        }
        call('JxlEncoderCloseInput', encoder)
        const output = new Uint8Array(1_048_576),
          pointer = new BigUint64Array([BigInt(integer(pointerOf(output)))]),
          available = new BigUint64Array([BigInt(output.length)])
        ok('JxlEncoderProcessOutput', encoder, pointer, available)
        const input = output.slice(0, output.length - Number(available[0]))
        await writeFile(`${root}/${id}.jxl`, input)
        const directory = `.tmp/jpegxl-gap-alpha/${id}`
        execFileSync(
          'bun',
          [
            'benchmark/jpegxl/flush-progressive-oracle.ts',
            `${root}/${id}.jxl`,
            directory,
            'linear-float32',
          ],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        )
        const manifest: unknown = JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'))
        if (!record(manifest) || !Array.isArray(manifest.stages))
          throw new Error('Invalid oracle output')
        const last: unknown = manifest.stages.at(-1)
        if (!record(last) || typeof last.file !== 'string')
          throw new Error('Invalid reference frame')
        const reference = new Uint8Array(await readFile(`${directory}/${last.file}`))
        await writeFile(`${root}/${id}.bin.gz`, gzipSync(reference, { level: 9 }))
        fixtures.push({
          id,
          file: `${id}.jxl`,
          sha256: hash(input),
          referenceSha256: hash(reference),
          colorBits,
          colorExponent,
          bits,
          exponent,
          associated,
          blend,
          width: 16,
          height: 16,
        })
      } finally {
        call('JxlEncoderDestroy', encoder)
      }
    }
} finally {
  library.close()
}
await writeFile(
  `${root}/manifest.json`,
  `${JSON.stringify({ schemaVersion: 1, oracle: 'libjxl 0.12.0 mixed integer/floating color and alpha, including linear reference blends, preferred linear sRGB float decode', librarySha256, license: 'CC0-1.0 generated synthetic gradients', fixtures }, null, 2)}\n`,
)
console.log(`Generated ${fixtures.length} floating-alpha VarDCT fixtures`)
