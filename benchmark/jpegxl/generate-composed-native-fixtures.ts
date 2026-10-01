/** Dev-only pinned libjxl C API encoder and coalesced native-plane decoder. Run with Bun. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { jpegXlHdrFloatOracle } from './hdr-float-oracle.ts'

const root = resolve('tests/fixtures/jpegxl/composed-native')
const work = resolve('.tmp/jpegxl-composed-native-fixtures')
await mkdir(root, { recursive: true })
await mkdir(work, { recursive: true })
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const libraryPath = resolve('.tmp/jpegxl-remediation-oracle/lib/libjxl.so.0.12.0')
const librarySha256 = hash(new Uint8Array(await readFile(libraryPath)))
if (
  librarySha256 !== '29eea9f83a05f1851e18fc5f414916ca6c28e278f68622969bea68d7516ecdc5' ||
  process.platform !== 'linux' ||
  process.arch !== 'x64'
)
  throw new Error('This oracle requires the pinned Linux x64 libjxl library')
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const ffiPath = 'bun:ffi',
  ffi: unknown = await import(ffiPath)
if (!record(ffi) || typeof ffi.dlopen !== 'function' || typeof ffi.ptr !== 'function')
  throw new Error('Run with Bun')
const pointerOf = ffi.ptr
const definitions = {
  JxlEncoderVersion: { args: [], returns: 'u32' },
  JxlEncoderGetError: { args: ['ptr'], returns: 'u32' },
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
  JxlEncoderSetICCProfile: { args: ['ptr', 'ptr', 'u64'], returns: 'u32' },
  JxlEncoderFrameSettingsCreate: { args: ['ptr', 'ptr'], returns: 'ptr' },
  JxlEncoderSetFrameLossless: { args: ['ptr', 'i32'], returns: 'u32' },
  JxlEncoderFrameSettingsSetOption: { args: ['ptr', 'i32', 'i64'], returns: 'u32' },
  JxlEncoderInitFrameHeader: { args: ['ptr'], returns: 'void' },
  JxlEncoderSetFrameHeader: { args: ['ptr', 'ptr'], returns: 'u32' },
  JxlEncoderSetExtraChannelBlendInfo: { args: ['ptr', 'u64', 'ptr'], returns: 'u32' },
  JxlEncoderAddImageFrame: { args: ['ptr', 'ptr', 'ptr', 'u64'], returns: 'u32' },
  JxlEncoderSetExtraChannelBuffer: { args: ['ptr', 'ptr', 'ptr', 'u64', 'u32'], returns: 'u32' },
  JxlEncoderCloseInput: { args: ['ptr'], returns: 'void' },
  JxlEncoderProcessOutput: { args: ['ptr', 'ptr', 'ptr'], returns: 'u32' },
} as const
const library: unknown = ffi.dlopen(libraryPath, definitions)
if (!record(library) || !record(library.symbols) || typeof library.close !== 'function')
  throw new Error('Invalid FFI library')
const symbols = library.symbols
type Argument = number | Uint8Array | Uint32Array | Float32Array | BigUint64Array
const call = (name: keyof typeof definitions, ...args: Argument[]): unknown => {
  const fn = symbols[name]
  if (typeof fn !== 'function') throw new Error(`Missing ${name}`)
  return fn(...args)
}
const number = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('Invalid C result')
  return value
}
const ok = (name: keyof typeof definitions, ...args: Argument[]): void => {
  if (call(name, ...args) !== 0) throw new Error(`${name} failed`)
}
if (call('JxlEncoderVersion') !== 12000) throw new Error('Wrong libjxl version')
interface Definition {
  readonly id: string
  readonly cmyk?: boolean
  readonly gray?: boolean
  readonly depth: 16 | 32
  readonly animation?: boolean
  readonly associated?: boolean
  readonly mode: 0 | 1 | 2 | 3 | 4
  readonly grouped?: boolean
  readonly profile?: string
  readonly transfer?: 'pq' | 'hlg'
}
const cases: readonly Definition[] = [
  { id: 'float32-cropped-still', depth: 32, mode: 0 },
  { id: 'gray16-add-animation', depth: 16, gray: true, mode: 1, animation: true },
  { id: 'float32-straight-blend-animation', depth: 32, mode: 2, animation: true },
  {
    id: 'float16-associated-blend-animation',
    depth: 16,
    mode: 2,
    animation: true,
    associated: true,
  },
  { id: 'float32-muladd-animation', depth: 32, mode: 3, animation: true },
  { id: 'float32-multiply-grouped', depth: 32, mode: 4, grouped: true },
  {
    id: 'float32-icc-blend-animation',
    depth: 32,
    mode: 2,
    animation: true,
    profile: 'm4-color/oriented-icc.icc',
  },
  {
    id: 'gray16-icc-associated-still',
    depth: 16,
    gray: true,
    mode: 2,
    associated: true,
    profile: 'm8-native/gray.icc',
  },
  {
    id: 'pq32-associated-animation',
    depth: 32,
    mode: 2,
    animation: true,
    associated: true,
    transfer: 'pq',
  },
  { id: 'hlg32-blend-animation', depth: 32, mode: 2, animation: true, transfer: 'hlg' },
  { id: 'cmyk16-cropped-still', depth: 16, cmyk: true, mode: 0 },
  { id: 'cmyk16-blend-animation', depth: 16, cmyk: true, mode: 2, animation: true },
  {
    id: 'cmyk16-associated-grouped',
    depth: 16,
    cmyk: true,
    mode: 2,
    associated: true,
    grouped: true,
  },
]
const fixtures = []
try {
  for (const entry of cases) {
    const width = entry.grouped ? 1025 : 6,
      height = 3,
      colorCount = entry.gray ? 1 : 3
    const profile =
      entry.cmyk || entry.profile
        ? new Uint8Array(
            await readFile(`tests/fixtures/jpegxl/${entry.profile ?? 'cmyk-pipeline/source.icc'}`),
          )
        : undefined
    const encoder = number(call('JxlEncoderCreate', 0))
    try {
      ok('JxlEncoderUseContainer', encoder, 1)
      ok('JxlEncoderSetCodestreamLevel', encoder, 10)
      const info = new Uint8Array(512),
        basic = new DataView(info.buffer)
      call('JxlEncoderInitBasicInfo', info)
      basic.setUint32(4, width, true)
      basic.setUint32(8, height, true)
      basic.setUint32(12, entry.depth, true)
      basic.setUint32(16, entry.cmyk ? 0 : entry.depth === 16 ? 5 : 8, true)
      basic.setUint32(36, 1, true)
      basic.setUint32(44, Number(!!entry.animation), true)
      basic.setUint32(52, colorCount, true)
      basic.setUint32(56, entry.cmyk ? 2 : 1, true)
      basic.setUint32(60, 32, true)
      basic.setUint32(64, 8, true)
      basic.setUint32(68, Number(!!entry.associated), true)
      basic.setUint32(80, 10, true)
      basic.setUint32(84, 1, true)
      if (entry.transfer) basic.setFloat32(20, 1000, true)
      ok('JxlEncoderSetBasicInfo', encoder, info)
      const alphaIndex = entry.cmyk ? 1 : 0
      for (let index = 0; index <= alphaIndex; index++) {
        const extra = new Uint8Array(64),
          view = new DataView(extra.buffer),
          alpha = index === alphaIndex
        call('JxlEncoderInitExtraChannelInfo', alpha ? 0 : 4, extra)
        view.setUint32(4, alpha ? 32 : 16, true)
        view.setUint32(8, alpha ? 8 : 0, true)
        view.setUint32(20, Number(alpha && !!entry.associated), true)
        ok('JxlEncoderSetExtraChannelInfo', encoder, index, extra)
      }
      if (profile) ok('JxlEncoderSetICCProfile', encoder, profile, profile.length)
      else {
        const color = new Uint8Array(256)
        call('JxlColorEncodingSetToLinearSRGB', color, Number(!!entry.gray))
        if (entry.transfer) {
          const colorView = new DataView(color.buffer)
          colorView.setUint32(24, 9, true)
          colorView.setUint32(80, entry.transfer === 'pq' ? 16 : 18, true)
        }
        ok('JxlEncoderSetColorEncoding', encoder, color)
      }
      for (let frame = 0; frame < 3; frame++) {
        const fw = frame === 0 ? width : entry.grouped ? width - 2 : 5,
          fh = frame === 0 ? height : 2
        const settings = number(call('JxlEncoderFrameSettingsCreate', encoder, 0))
        ok('JxlEncoderSetFrameLossless', settings, 1)
        ok('JxlEncoderFrameSettingsSetOption', settings, 0, 7)
        ok('JxlEncoderFrameSettingsSetOption', settings, 25, 0)
        ok('JxlEncoderFrameSettingsSetOption', settings, 27, 0)
        const header = new Uint8Array(64),
          frameView = new DataView(header.buffer)
        call('JxlEncoderInitFrameHeader', header)
        frameView.setUint32(0, entry.animation ? frame + 1 : 0, true)
        frameView.setUint32(16, Number(frame !== 0), true)
        frameView.setInt32(20, frame === 0 ? 0 : frame === 1 ? -1 : 2, true)
        frameView.setInt32(24, frame === 1 ? 1 : 0, true)
        frameView.setUint32(28, fw, true)
        frameView.setUint32(32, fh, true)
        frameView.setUint32(36, frame === 0 ? 0 : entry.mode, true)
        frameView.setUint32(40, frame === 0 ? 0 : 1, true)
        frameView.setUint32(44, alphaIndex, true)
        frameView.setUint32(48, 1, true)
        frameView.setUint32(52, 1, true)
        ok('JxlEncoderSetFrameHeader', settings, header)
        const blend = header.subarray(36, 52)
        for (let index = 0; index <= alphaIndex; index++)
          ok('JxlEncoderSetExtraChannelBlendInfo', settings, index, blend)
        const pixels = fw * fh
        const alphaValues = Float32Array.from(
          { length: pixels },
          (_, pixel) => [0, 0.25, 0.5, 1][(pixel + frame) % 4] ?? 1,
        )
        const colors = Float32Array.from({ length: pixels * colorCount }, (_, sample) => {
          const pixel = Math.floor(sample / colorCount),
            channel = sample % colorCount
          const value = entry.cmyk
            ? ((pixel * 3 + channel * 5 + frame * 7) % 17) / 16
            : ([-0.25, 0, 0.125, 0.5, 1, 2][(pixel + channel * 2 + frame) % 6] ?? 0)
          return value * (entry.associated ? (alphaValues[pixel] ?? 1) : 1)
        })
        const format = Uint32Array.of(colorCount, 0, 0, 0, 0, 0)
        ok('JxlEncoderAddImageFrame', settings, format, colors, colors.byteLength)
        for (let index = 0; index <= alphaIndex; index++) {
          const values =
            index === alphaIndex
              ? alphaValues
              : Float32Array.from(
                  { length: pixels },
                  (_, pixel) =>
                    (((pixel + frame * 3) % 17) / 16) *
                    (entry.associated ? (alphaValues[pixel] ?? 1) : 1),
                )
          ok('JxlEncoderSetExtraChannelBuffer', settings, format, values, values.byteLength, index)
        }
      }
      call('JxlEncoderCloseInput', encoder)
      const output = new Uint8Array(1_048_576),
        pointer = new BigUint64Array([BigInt(number(pointerOf(output)))]),
        available = new BigUint64Array([BigInt(output.length)])
      const status = call('JxlEncoderProcessOutput', encoder, pointer, available)
      if (status !== 0)
        throw new Error(
          `${entry.id}: ProcessOutput status ${status}, error ${call('JxlEncoderGetError', encoder)}`,
        )
      const bytes = output.slice(0, output.length - Number(available[0]))
      await writeFile(`${root}/${entry.id}.jxl`, bytes)
      const directory = `${work}/${entry.id}`
      execFileSync(
        'bun',
        [
          'benchmark/jpegxl/flush-progressive-oracle.ts',
          `${root}/${entry.id}.jxl`,
          directory,
          'native-planes-float32',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
      const manifest: unknown = JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'))
      if (!record(manifest) || !Array.isArray(manifest.stages))
        throw new Error('Missing coalesced native stages')
      const finals = manifest.stages.filter(
        (stage: unknown) => record(stage) && stage.kind === 'final',
      )
      if (finals.length !== (entry.animation ? 3 : 1))
        throw new Error('Wrong displayed frame count')
      for (let index = 0; index < finals.length; index++) {
        const stage: unknown = finals[index]
        if (
          !record(stage) ||
          typeof stage.file !== 'string' ||
          !/^stage-\d+\.bin$/.test(stage.file)
        )
          throw new Error('Invalid stage file')
        const raw = new Uint8Array(await readFile(`${directory}/${stage.file}`)),
          view = new DataView(raw.buffer)
        let reference: Uint8Array = raw
        if (entry.gray) {
          reference = new Uint8Array(width * height * 16)
          const output = new DataView(reference.buffer)
          for (let pixel = 0; pixel < width * height; pixel++)
            for (let channel = 0; channel < 4; channel++)
              output.setFloat32(
                (pixel * 4 + channel) * 4,
                view.getFloat32((pixel * 2 + (channel === 3 ? 1 : 0)) * 4, false),
                false,
              )
        }
        if (entry.cmyk && profile) {
          if (!Array.isArray(stage.extras)) throw new Error('Missing native black channel')
          const black: unknown = stage.extras.find(
            (extra: unknown) => record(extra) && extra.type === 4,
          )
          if (
            !record(black) ||
            typeof black.file !== 'string' ||
            !/^stage-\d+-extra-\d+\.bin$/.test(black.file)
          )
            throw new Error('Missing black samples')
          const blackBytes = new Uint8Array(await readFile(`${directory}/${black.file}`)),
            blackView = new DataView(blackBytes.buffer)
          const input = Uint16Array.from({ length: width * height * 4 }, (_, sample) => {
            const pixel = Math.floor(sample / 4),
              channel = sample % 4,
              alpha = entry.associated ? view.getFloat32((pixel * 4 + 3) * 4, false) : 1
            const value =
              channel === 3
                ? blackView.getFloat32(pixel * 4, false)
                : view.getFloat32((pixel * 4 + channel) * 4, false)
            return alpha <= 0
              ? 0
              : 65535 - Math.round(Math.max(0, Math.min(1, value / alpha)) * 65535)
          })
          await writeFile(`${directory}/input.bin`, new Uint8Array(input.buffer))
          execFileSync(
            'bun',
            [
              'benchmark/jpegxl/littlecms-profile-oracle.ts',
              'tests/fixtures/jpegxl/cmyk-pipeline/source.icc',
              `${directory}/input.bin`,
              `${directory}/srgb.bin`,
              '4',
              '16',
            ],
            { stdio: ['ignore', 'pipe', 'pipe'] },
          )
          const colors = new Uint16Array(
            new Uint8Array(await readFile(`${directory}/srgb.bin`)).buffer,
          )
          reference = new Uint8Array(width * height * 8)
          const outputView = new DataView(reference.buffer)
          for (let pixel = 0; pixel < width * height; pixel++)
            for (let channel = 0; channel < 4; channel++) {
              const alpha = view.getFloat32((pixel * 4 + 3) * 4, false)
              outputView.setUint16(
                (pixel * 4 + channel) * 2,
                channel === 3
                  ? Math.round(Math.max(0, Math.min(1, alpha)) * 65535)
                  : entry.associated && alpha <= 0
                    ? 0
                    : (colors[pixel * 3 + channel] ?? 0),
                false,
              )
            }
        }
        const id = `${entry.id}-${index}`
        let linearReference: Uint8Array | undefined
        if (entry.profile) {
          const input = Float32Array.from({ length: width * height * colorCount }, (_, sample) => {
            const pixel = Math.floor(sample / colorCount),
              a = entry.associated
                ? view.getFloat32((pixel * (colorCount + 1) + colorCount) * 4, false)
                : 1
            const value = view.getFloat32(
              (pixel * (colorCount + 1) + (sample % colorCount)) * 4,
              false,
            )
            return a <= 0 ? 0 : Math.max(0, Math.min(1, value / a))
          })
          await writeFile(`${directory}/input.bin`, new Uint8Array(input.buffer))
          execFileSync(
            'bun',
            [
              'benchmark/jpegxl/littlecms-profile-oracle.ts',
              `tests/fixtures/jpegxl/${entry.profile}`,
              `${directory}/input.bin`,
              `${directory}/srgb.bin`,
              String(colorCount),
              '16',
              'float32',
            ],
            { stdio: ['ignore', 'pipe', 'pipe'] },
          )
          const colors = new Uint16Array(
            new Uint8Array(await readFile(`${directory}/srgb.bin`)).buffer,
          )
          reference = new Uint8Array(width * height * 8)
          const output = new DataView(reference.buffer)
          for (let pixel = 0; pixel < width * height; pixel++)
            for (let channel = 0; channel < 4; channel++) {
              const a = view.getFloat32((pixel * (colorCount + 1) + colorCount) * 4, false)
              output.setUint16(
                (pixel * 4 + channel) * 2,
                channel === 3
                  ? Math.round(Math.max(0, Math.min(1, a)) * 65535)
                  : entry.associated && a <= 0
                    ? 0
                    : (colors[pixel * 3 + channel] ?? 0),
                false,
              )
            }
        } else if (entry.transfer) {
          const hdr = await jpegXlHdrFloatOracle(
            directory,
            raw,
            width,
            height,
            colorCount,
            true,
            !!entry.associated,
            'rec2020',
            entry.transfer,
          )
          reference = hdr.reference
          linearReference = hdr.linearReference
          await writeFile(`${root}/${id}.linear.bin.gz`, gzipSync(linearReference))
        }
        await writeFile(`${root}/${id}.bin.gz`, gzipSync(reference))
        fixtures.push({
          id,
          file: `${entry.id}.jxl`,
          frame: index,
          width,
          height,
          category: entry.cmyk ? 'cmyk' : entry.profile ? 'icc' : entry.transfer ? 'hdr' : 'float',
          format: entry.cmyk || entry.profile ? 'rgba16' : entry.transfer ? 'rgba8' : 'rgbaf32',
          depth: entry.depth,
          alphaDepth: 32,
          associated: !!entry.associated,
          animation: !!entry.animation,
          colorTolerance: entry.cmyk
            ? 350
            : entry.profile
              ? entry.gray
                ? 8
                : 180
              : entry.transfer
                ? 3
                : 0.000002,
          linearTolerance: 0.0005,
          sha256: hash(bytes),
          referenceSha256: hash(reference),
          sourceSha256: hash(raw),
          ...(linearReference ? { linearSha256: hash(linearReference) } : {}),
        })
      }
    } finally {
      call('JxlEncoderDestroy', encoder)
    }
  }
} finally {
  library.close()
}
await writeFile(
  `${root}/manifest.json`,
  `${JSON.stringify({ oracle: 'Pinned libjxl 0.12.0 C API lossless encoder and coalesced Float32 source-plane decoder; CMYK source composition precedes LittleCMS 2.17 UInt16 A2B0 conversion', librarySha256, fixtures }, null, 2)}\n`,
)
