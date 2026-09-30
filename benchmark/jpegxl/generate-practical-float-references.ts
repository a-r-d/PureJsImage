import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  encodeJpegXlNative,
  type JpegXlNativeExtraInput,
  type JpegXlNativePlaneInput,
} from '../../src/jpegxl.ts'

const decoder = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/djxl'
const root = 'tests/fixtures/jpegxl/practical-float'
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
if (
  sha256(await readFile(decoder)) !==
  '8da836ae132de221c53532a8296cc5b9e5f4bef16df4fcf4681f8b61ee4f3788'
) {
  throw new Error('Pinned libjxl decoder differs')
}

const halfBits = new Map<number, number>([
  [0, 0],
  [0.1875, 0x3200],
  [0.375 * (128 / 255), 0x3206],
  [0.375 * (192 / 255), 0x3485],
  [0.5 * (128 / 255), 0x3404],
  [0.5 * (192 / 255), 0x3606],
  [0.75 * (128 / 255), 0x3606],
  [0.75 * (192 / 255), 0x3885],
  [0.25, 0x3400],
  [0.28125, 0x3480],
  [0.375, 0x3600],
  [0.5, 0x3800],
  [0.5625, 0x3880],
  [0.75, 0x3a00],
  [1, 0x3c00],
])
const half = (values: readonly number[]): Uint16Array =>
  Uint16Array.from(values, (value) => {
    const bits = halfBits.get(value)
    if (bits === undefined) throw new Error(`No pinned binary16 sample for ${value}`)
    return bits
  })
const float = (values: readonly number[]): Uint32Array =>
  new Uint32Array(Float32Array.from(values).buffer)

const pfm = (bytes: Uint8Array, channels: 1 | 3): readonly number[] => {
  let offset = 0
  const line = (): string => {
    const end = bytes.indexOf(10, offset)
    if (end < 0) throw new Error('Truncated PFM header')
    const value = new TextDecoder().decode(bytes.subarray(offset, end))
    offset = end + 1
    return value
  }
  if (line() !== (channels === 1 ? 'Pf' : 'PF')) throw new Error('Unexpected PFM channels')
  if (line() !== '4 1' || line() !== '1.0') throw new Error('Unexpected PFM layout')
  if (bytes.length - offset !== 4 * channels * 4) throw new Error('Unexpected PFM data length')
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.length - offset)
  return Array.from({ length: 4 * channels }, (_, index) => view.getFloat32(index * 4, false))
}

const manifest: {
  name: string
  jxlSha256: string
  colorPfmSha256: string
  alphaPfmSha256: string
  color: readonly number[]
  alpha: readonly number[]
  rgba16: readonly number[]
}[] = []
await mkdir(root, { recursive: true })
for (const family of ['gray', 'rgb'] as const) {
  for (const colorDepth of [16, 32] as const) {
    for (const alphaDepth of [colorDepth === 16 ? 32 : 16, 8]) {
      for (const associated of [false, true]) {
        const name = `${family}${colorDepth}-alpha${alphaDepth}-${associated ? 'associated' : 'straight'}`
        const alpha = alphaDepth === 8 ? [128 / 255, 192 / 255, 0, 1] : [0.5, 0.75, 0, 1]
        const source = family === 'gray' ? [0.75] : [0.375, 0.5, 0.75]
        const color = source.map((value) =>
          Array.from({ length: 4 }, (_, index) =>
            associated ? value * (alpha[index] ?? 0) : value,
          ),
        )
        const colorPlane = (values: readonly number[]): JpegXlNativePlaneInput => ({
          data: colorDepth === 16 ? half(values) : float(values),
          bitDepth: colorDepth,
          sampleFormat: colorDepth === 16 ? 'binary16' : 'binary32',
        })
        const colorPlanes:
          | readonly [JpegXlNativePlaneInput]
          | readonly [JpegXlNativePlaneInput, JpegXlNativePlaneInput, JpegXlNativePlaneInput] =
          family === 'gray'
            ? [colorPlane(color[0] ?? [])]
            : [colorPlane(color[0] ?? []), colorPlane(color[1] ?? []), colorPlane(color[2] ?? [])]
        const alphaPlane: JpegXlNativeExtraInput =
          alphaDepth === 8
            ? {
                type: 0,
                data: Uint8Array.of(128, 192, 0, 255),
                bitDepth: 8,
                associatedAlpha: associated,
              }
            : {
                type: 0,
                data: alphaDepth === 16 ? half(alpha) : float(alpha),
                bitDepth: alphaDepth,
                sampleFormat: alphaDepth === 16 ? 'binary16' : 'binary32',
                associatedAlpha: associated,
              }
        const bytes = await encodeJpegXlNative({
          width: 4,
          height: 1,
          color: colorPlanes,
          extraChannels: [alphaPlane],
        })
        const jxlPath = join(root, `${name}.jxl`)
        const pfmPath = join(root, `${name}.pfm`)
        await writeFile(jxlPath, bytes)
        execFileSync(
          decoder,
          [
            jxlPath,
            pfmPath,
            '--no_coalescing',
            '--output_frames',
            '--output_extra_channels',
            '--num_threads=1',
          ],
          { timeout: 30_000, stdio: 'pipe' },
        )
        const colorPfm = await readFile(pfmPath)
        const alphaPfm = await readFile(`${pfmPath}-ec1.pfm`)
        const decodedColor = pfm(colorPfm, family === 'gray' ? 1 : 3)
        const decodedAlpha = pfm(alphaPfm, 1)
        const rgba16 = Array.from({ length: 4 }, (_, pixel) => {
          const a = decodedAlpha[pixel] ?? 0
          const channel = (index: number): number => {
            if (associated && a <= 0) return 0
            const native = decodedColor[family === 'gray' ? pixel : pixel * 3 + index] ?? 0
            const straight = associated ? native / a : native
            return Math.round(Math.max(0, Math.min(65_535, (straight - 0.25) * 65_535)))
          }
          return [channel(0), channel(1), channel(2), Math.round(a * 65_535)]
        }).flat()
        manifest.push({
          name,
          jxlSha256: sha256(bytes),
          colorPfmSha256: sha256(colorPfm),
          alphaPfmSha256: sha256(alphaPfm),
          color: decodedColor,
          alpha: decodedAlpha,
          rgba16,
        })
      }
    }
  }
}
const shiftedName = 'rgb32-alpha8-shift1-associated'
const shiftedBytes = await encodeJpegXlNative({
  width: 4,
  height: 1,
  color: [
    { data: float([0.1875, 0.1875, 0.375, 0.375]), bitDepth: 32, sampleFormat: 'binary32' },
    { data: float([0.25, 0.25, 0.5, 0.5]), bitDepth: 32, sampleFormat: 'binary32' },
    { data: float([0.375, 0.375, 0.75, 0.75]), bitDepth: 32, sampleFormat: 'binary32' },
  ],
  extraChannels: [
    { type: 0, data: Uint8Array.of(128, 255), bitDepth: 8, dimShift: 1, associatedAlpha: true },
  ],
})
const shiftedJxlPath = join(root, `${shiftedName}.jxl`)
const shiftedPfmPath = join(root, `${shiftedName}.pfm`)
await writeFile(shiftedJxlPath, shiftedBytes)
execFileSync(
  decoder,
  [
    shiftedJxlPath,
    shiftedPfmPath,
    '--no_coalescing',
    '--output_frames',
    '--output_extra_channels',
    '--num_threads=1',
  ],
  { timeout: 30_000, stdio: 'pipe' },
)
const shiftedColorPfm = await readFile(shiftedPfmPath)
const shiftedAlphaPfm = await readFile(`${shiftedPfmPath}-ec1.pfm`)
const shiftedColor = pfm(shiftedColorPfm, 3)
const shiftedAlpha = pfm(shiftedAlphaPfm, 1)
const shiftedRgba16 = Array.from({ length: 4 }, (_, pixel) => {
  const a = shiftedAlpha[pixel] ?? 0
  return Array.from({ length: 3 }, (_, channel) => {
    if (a <= 0) return 0
    const straight = (shiftedColor[pixel * 3 + channel] ?? 0) / a
    return Math.round(Math.max(0, Math.min(65_535, (straight - 0.25) * 65_535)))
  }).concat(Math.round(Math.max(0, Math.min(1, a)) * 65_535))
}).flat()
manifest.push({
  name: shiftedName,
  jxlSha256: sha256(shiftedBytes),
  colorPfmSha256: sha256(shiftedColorPfm),
  alphaPfmSha256: sha256(shiftedAlphaPfm),
  color: shiftedColor,
  alpha: shiftedAlpha,
  rgba16: shiftedRgba16,
})
await writeFile(
  join(root, 'manifest.json'),
  `${JSON.stringify({ libjxl: '0.12.0', manifest }, null, 2)}\n`,
)
