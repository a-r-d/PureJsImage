import { hashM8Sources } from './m8-output-digest.ts'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { encodeJpegXlNative, openJpegXlSequence } from '../../src/jpegxl.ts'
import { hashM8Layer } from './m8-output-digest.ts'

const sourceSha256 = await hashM8Sources()
const native = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/djxl'
const digest = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
const nativeSha256 = digest(await readFile(native))
if (nativeSha256 !== '8da836ae132de221c53532a8296cc5b9e5f4bef16df4fcf4681f8b61ee4f3788')
  throw new Error('Native decoder hash differs')
const directory = '.tmp/jpegxl-m8/native-channel-verification'
await mkdir(directory, { recursive: true })
const path = '.tmp/jpegxl-conformance/testcases/spot/input.jxl'
const input = await readFile(path)
execFileSync(
  native,
  [
    path,
    `${directory}/spot.pfm`,
    '--no_coalescing',
    '--output_frames',
    '--output_extra_channels',
    '--norender_spotcolors',
    '--num_threads=1',
  ],
  { stdio: 'pipe', timeout: 120000 },
)
const sequence = await openJpegXlSequence(input)
const outputDigest = createHash('sha256')
const layers = []
try {
  for await (const layer of sequence.layers()) {
    hashM8Layer(outputDigest, layer)
    const channels = []
    for (let c = 0; c < layer.planes.length; c++) {
      const suffix = c < 3 ? '' : `-ec${c - 2}`
      const pfm = await readFile(`${directory}/spot.pfm-${layer.internalFrameIndex}${suffix}.pfm`)
      let start = 0
      const lines: string[] = []
      for (let i = 0; i < 3; i++) {
        const end = pfm.indexOf(10, start)
        if (end < 0) throw new Error('Truncated PFM')
        lines.push(pfm.toString('ascii', start, end))
        start = end + 1
      }
      const dimensions = (lines[1] ?? '').split(' ').map(Number)
      const width = dimensions[0],
        height = dimensions[1],
        components = c < 3 ? 3 : 1
      const plane = layer.planes[c]
      if (
        !width ||
        !height ||
        !plane ||
        plane.length !== width * height ||
        pfm.length !== start + plane.length * components * 4
      )
        throw new Error('Native spot plane dimensions differ')
      let differences = 0,
        maximumFloatError = 0
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const nativeValue =
            pfm.readFloatBE(
              start +
                ((height - 1 - y) * width * components + x * components + (c < 3 ? c : 0)) * 4,
            ) * 65535
          const value = plane[y * width + x] ?? 0
          if (Math.round(nativeValue) !== value) differences++
          maximumFloatError = Math.max(maximumFloatError, Math.abs(nativeValue - value))
        }
      channels.push({
        channel: c,
        width,
        height,
        nativeSha256: digest(pfm),
        differences,
        maximumFloatError,
        passed: differences === 0,
      })
    }
    layers.push({
      index: layer.internalFrameIndex,
      extraChannels: layer.header.extraChannels,
      channels,
    })
  }
} finally {
  await sequence.close()
}

const written = []
const values = Uint16Array.of(0, 100, 32768, 65535)
for (const id of ['gray16-alpha-icc', 'rgb16-icc', 'binary16'] as const) {
  const floating = id === 'binary16',
    gray = id !== 'rgb16-icc'
  const plane = {
    data: floating ? Uint16Array.of(0xbc00, 0, 0x3800, 0x4000) : values,
    bitDepth: 16,
    ...(floating ? { sampleFormat: 'binary16' as const } : {}),
  }
  const profile = floating
    ? undefined
    : await readFile(
        gray
          ? 'tests/fixtures/jpegxl/m8-native/gray.icc'
          : 'tests/fixtures/jpegxl/m4-color/oriented-icc.icc',
      )
  const encoded = await encodeJpegXlNative({
    width: 4,
    height: 1,
    color: gray ? [plane] : [plane, plane, plane],
    ...(profile ? { iccProfile: profile } : {}),
    extraChannels: id === 'gray16-alpha-icc' ? [{ ...plane, type: 0, name: 'coverage' }] : [],
  })
  const file = `${directory}/${id}.jxl`
  await writeFile(file, encoded)
  execFileSync(
    native,
    [file, `${directory}/${id}.npy`, `--orig_icc_out=${directory}/${id}.icc`, '--num_threads=1'],
    { stdio: 'pipe', timeout: 120000 },
  )
  const npy = await readFile(`${directory}/${id}.npy`)
  const start = 10 + npy.readUInt16LE(8),
    channels = gray ? (floating ? 1 : 2) : 3
  if (
    !npy.subarray(10, start).toString('ascii').includes("'<f4'") ||
    npy.length !== start + 4 * channels * 4
  )
    throw new Error(`${id}: native array extent differs`)
  let differences = 0
  for (let i = 0; i < 4; i++)
    for (let c = 0; c < channels; c++) {
      const value = npy.readFloatLE(start + (i * channels + c) * 4)
      if (floating ? value !== [-1, 0, 0.5, 2][i] : Math.round(value * 65535) !== values[i])
        differences++
    }
  const nativeProfileSha256 = profile ? digest(await readFile(`${directory}/${id}.icc`)) : undefined
  const profileMatches = !profile || nativeProfileSha256 === digest(profile)
  let cmm: { target: string; outputSha256: string; values: number[] } | undefined
  if (profile) {
    const target = gray ? 'Gra_D65_Rel_Lin' : 'RGB_D65_SRG_Rel_Lin'
    const path = `${directory}/${id}-cmm.npy`
    execFileSync(native, [file, path, `--color_space=${target}`, '--num_threads=1'], {
      stdio: 'pipe',
      timeout: 120000,
    })
    const converted = await readFile(path)
    const beginning = 10 + converted.readUInt16LE(8)
    if (converted.length !== beginning + 4 * channels * 4)
      throw new Error('CMM channel relationship differs')
    const samples: number[] = []
    for (let i = 0; i < 4; i++)
      for (let c = 0; c < channels; c++) {
        const value = converted.readFloatLE(beginning + (i * channels + c) * 4)
        if (!Number.isFinite(value)) throw new Error('CMM produced nonfinite output')
        if (gray && c === 1 && Math.round(value * 65535) !== values[i])
          throw new Error('CMM changed alpha')
        samples.push(value)
      }
    cmm = { target, outputSha256: digest(converted), values: samples }
  }
  written.push({
    id,
    outputSha256: digest(encoded),
    nativeNpySha256: digest(npy),
    nativeProfileSha256,
    profileMatches,
    ...(cmm ? { cmm } : {}),
    differences,
    passed: profileMatches && differences === 0,
  })
}
const passed =
  layers.length === 2 &&
  layers.every((layer) => layer.channels.every((channel) => channel.passed)) &&
  written.every((result) => result.passed)
await writeFile(
  `${directory}/report.json`,
  `${JSON.stringify({ sourceSha256, nativeSha256, spot: { inputSha256: digest(input), outputSha256: outputDigest.digest('hex'), layers }, written, passed }, null, 2)}\n`,
)
console.log(JSON.stringify({ passed, spotLayers: layers.length, writtenCases: written.length }))
if (!passed) throw new Error('Native channel qualification failed')
