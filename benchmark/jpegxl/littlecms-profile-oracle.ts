/** Development-only LittleCMS 2.17 float-evaluated display oracle. Run with Bun. */
import { readFile, writeFile } from 'node:fs/promises'

const [profilePath, inputPath, outputPath, channelsText, depthText] = process.argv.slice(2)
if (
  !profilePath ||
  !inputPath ||
  !outputPath ||
  (channelsText !== '1' && channelsText !== '3') ||
  (depthText !== '8' && depthText !== '16')
)
  throw new Error('Expected profile, native UInt16 input, output, channels 1/3 and depth 8/16')
const profile = new Uint8Array(await readFile(profilePath))
const input = new Uint8Array(await readFile(inputPath))
const channels = Number(channelsText)
const depth = Number(depthText)
const pixels = input.length / (channels * 2)
if (!Number.isSafeInteger(pixels) || pixels < 1) throw new Error('Invalid LittleCMS input')
const floating = new Float64Array(pixels * 3)
const output = new Uint8Array(pixels * 3 * (depth / 8))
if (process.platform !== 'linux' || process.arch !== 'x64')
  throw new Error('The ICC oracle requires Linux x64')
const ffiPath = 'bun:ffi'
const ffi: unknown = await import(ffiPath)
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
if (!record(ffi) || typeof ffi.dlopen !== 'function') throw new Error('Run the ICC oracle with Bun')
const definitions = {
  cmsGetEncodedCMMversion: { args: [], returns: 'u32' },
  cmsOpenProfileFromMem: { args: ['ptr', 'u32'], returns: 'ptr' },
  cmsCreate_sRGBProfile: { args: [], returns: 'ptr' },
  cmsCreateTransform: {
    args: ['ptr', 'u32', 'ptr', 'u32', 'u32', 'u32'],
    returns: 'ptr',
  },
  cmsDoTransform: {
    args: ['ptr', 'ptr', 'ptr', 'u32'],
    returns: 'void',
  },
  cmsDeleteTransform: { args: ['ptr'], returns: 'void' },
  cmsCloseProfile: { args: ['ptr'], returns: 'i32' },
} as const
const library: unknown = ffi.dlopen('/usr/lib/x86_64-linux-gnu/liblcms2.so.2', definitions)
if (!record(library) || !record(library.symbols) || typeof library.close !== 'function')
  throw new Error('Invalid ICC library')
const symbols = library.symbols
const call = (name: keyof typeof definitions, ...args: (number | Uint8Array)[]): unknown => {
  const fn = symbols[name]
  if (typeof fn !== 'function') throw new Error(`Missing ${name}`)
  return fn(...args)
}
const integer = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new Error('Invalid ICC integer')
  return value
}
if (integer(call('cmsGetEncodedCMMversion')) !== 2170)
  throw new Error('The ICC oracle requires LittleCMS 2.17')
const source = integer(call('cmsOpenProfileFromMem', profile, profile.length))
const target = integer(call('cmsCreate_sRGBProfile'))
if (!source || !target) throw new Error('LittleCMS profile open failed')
// PT_GRAY=3, PT_RGB=4; channel count starts at bit 3, byte count at bit 0.
const inputFormat = ((channels === 1 ? 3 : 4) << 16) | (channels << 3) | 2
// Floating samples avoid rounding the intermediate linear channel to UInt16.
// FLOAT_SH=bit 22; a zero byte count denotes eight-byte samples.
const outputFormat = (1 << 22) | (4 << 16) | (3 << 3)
// cmsFLAGS_NOOPTIMIZE avoids reducing the reference to a resampled display LUT.
const transform = integer(
  call('cmsCreateTransform', source, inputFormat, target, outputFormat, 0, 0x0100),
)
if (!transform) throw new Error('LittleCMS transform construction failed')
try {
  call('cmsDoTransform', transform, input, new Uint8Array(floating.buffer), pixels)
  const words = depth === 16 ? new Uint16Array(output.buffer) : undefined
  const maximum = depth === 16 ? 65535 : 255
  for (let index = 0; index < floating.length; index++) {
    const value = floating[index]
    if (value === undefined || !Number.isFinite(value)) throw new Error('Non-finite ICC reference')
    const sample = Math.round(Math.max(0, Math.min(1, value)) * maximum)
    if (words) words[index] = sample
    else output[index] = sample
  }
  await writeFile(outputPath, output)
} finally {
  call('cmsDeleteTransform', transform)
  call('cmsCloseProfile', source)
  call('cmsCloseProfile', target)
  library.close()
}
