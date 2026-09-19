import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  convertJpegXlCmykLayerToRgba8,
  encodeJpegXlNative,
  inspectJpegXl,
  jpegXlNativeFloat32ColorPlanes,
  jpegXlNativeUnsignedPlanes,
  openJpegXlSequence,
} from '../../src/jpegxl.ts'
import { hashM8Sources } from './m8-output-digest.ts'
import profileMap from './production-program/m10-level-profile-map.json' with { type: 'json' }
import { reportRevision } from './report-provenance.ts'

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
const sha256 = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex')
const fixtures = 'tests/fixtures/jpegxl/m10-level10'
const initialSourceSha256 = await hashM8Sources()

if (
  profileMap.schemaVersion !== 1 ||
  profileMap.levels['5'].maximumDimension !== 262_144 ||
  profileMap.levels['10'].maximumDimension !== 1_073_741_824 ||
  profileMap.levels['10'].maximumExtraChannels !== 256 ||
  profileMap.remainingUnsupported.length === 0
)
  throw new Error('JPEG XL M10 level/profile map is incomplete')

const floatInput = new Uint8Array(await readFile(join(fixtures, 'lossless-pfm.jxl')))
const floatSequence = await openJpegXlSequence(floatInput)
let floatSamples = 0
let floatDigest = ''
try {
  for await (const layer of floatSequence.layers()) {
    const planes = jpegXlNativeUnsignedPlanes(layer)
    floatSamples += planes.reduce((sum, plane) => sum + plane.length, 0)
    const hash = createHash('sha256')
    const scratch = new Uint8Array(4)
    const view = new DataView(scratch.buffer)
    for (const plane of planes)
      for (const sample of plane) {
        view.setUint32(0, sample, false)
        hash.update(scratch)
      }
    floatDigest = hash.digest('hex')
    const numeric = jpegXlNativeFloat32ColorPlanes(layer)
    if (numeric.some((plane) => plane.some((sample) => !Number.isFinite(sample))))
      throw new Error('Official binary32 fixture unexpectedly contains non-finite samples')
  }
} finally {
  await floatSequence.close()
}
if (
  floatSamples !== 750_000 ||
  floatDigest !== 'b79a3696b462f6dfad2685f9201cb27abb375af3ca4efcdf145a35d361de3093'
)
  throw new Error('Official binary32 fixture did not decode exactly')

const cmykInput = new Uint8Array(await readFile(join(fixtures, 'cmyk-layers.jxl')))
const cmykSequence = await openJpegXlSequence(cmykInput)
let cmykLayers = 0
let cmykRows = 0
let cmykDisplaySha256 = ''
let cmykProfile: Uint8Array | undefined
try {
  for await (const layer of cmykSequence.layers()) {
    const display = convertJpegXlCmykLayerToRgba8(layer)
    cmykLayers++
    cmykRows += display.height
    cmykDisplaySha256 = sha256(display.data)
    cmykProfile ??= layer.header.iccProfile
  }
} finally {
  await cmykSequence.close()
}
if (cmykLayers !== 4 || cmykRows !== 775 || !cmykProfile)
  throw new Error('Official CMYK layers were not extracted and converted')

const binary32 = Uint32Array.of(0, 0x8000_0000, 1, 0x3f80_0000, 0xbf80_0000, 0x7f7f_ffff)
const encodedBinary32 = await encodeJpegXlNative({
  width: binary32.length,
  height: 1,
  color: [{ data: binary32, bitDepth: 32, sampleFormat: 'binary32' }],
})
const groupedBinary32 = new Uint32Array(1_025)
for (let index = 0; index < groupedBinary32.length; index++)
  groupedBinary32[index] = index % 5 === 0 ? 0x8000_0000 : (index * 2_654_435_761) >>> 0
const encodedGroupedBinary32 = await encodeJpegXlNative({
  width: groupedBinary32.length,
  height: 1,
  color: [{ data: groupedBinary32, bitDepth: 32, sampleFormat: 'binary32' }],
})
const encodedInteger31 = await encodeJpegXlNative({
  width: 4,
  height: 1,
  color: [{ data: Uint32Array.of(0, 1, 0x4000_0000, 0x7fff_ffff), bitDepth: 31 }],
})
const encodedCmyk = await encodeJpegXlNative({
  width: 2,
  height: 1,
  color: [
    { data: Uint8Array.of(255, 0), bitDepth: 8 },
    { data: Uint8Array.of(255, 0), bitDepth: 8 },
    { data: Uint8Array.of(255, 0), bitDepth: 8 },
  ],
  extraChannels: [{ type: 4, data: Uint8Array.of(255, 0), bitDepth: 8 }],
  iccProfile: cmykProfile,
})
const groupedCmyk = Uint8Array.from({ length: 1_025 }, (_, index) => index & 255)
const encodedGroupedCmyk = await encodeJpegXlNative({
  width: groupedCmyk.length,
  height: 1,
  color: [
    { data: groupedCmyk, bitDepth: 8 },
    { data: groupedCmyk.slice().reverse(), bitDepth: 8 },
    { data: groupedCmyk.slice(), bitDepth: 8 },
  ],
  extraChannels: [{ type: 4, data: groupedCmyk.slice().reverse(), bitDepth: 8 }],
  iccProfile: cmykProfile,
})
const levelFive = await encodeJpegXlNative({
  width: 1,
  height: 1,
  color: [{ data: Uint16Array.of(4095), bitDepth: 12 }],
})
const levelTen = await encodeJpegXlNative({
  width: 1,
  height: 1,
  color: [{ data: Uint16Array.of(8191), bitDepth: 13 }],
})
const inspections = await Promise.all(
  [
    encodedBinary32,
    encodedGroupedBinary32,
    encodedInteger31,
    encodedCmyk,
    encodedGroupedCmyk,
    levelFive,
    levelTen,
  ].map((bytes) => inspectJpegXl(bytes)),
)
if (
  inspections[0]?.level !== 10 ||
  inspections[1]?.level !== 10 ||
  inspections[2]?.level !== 10 ||
  inspections[3]?.level !== 10 ||
  inspections[4]?.level !== 10 ||
  inspections[5]?.kind !== 'raw-codestream' ||
  inspections[6]?.level !== 10
)
  throw new Error('JPEG XL minimum-level selection or signaling failed')

const djxl = argument('--djxl')
if (!djxl) throw new Error('M10 verification requires --djxl <pinned libjxl decoder>')
const work = await mkdtemp(join(tmpdir(), 'purejsimage-m10-'))
try {
  for (const [name, bytes, extension] of [
    ['binary32', encodedBinary32, 'pfm'],
    ['binary32-grouped', encodedGroupedBinary32, 'pfm'],
    ['integer31', encodedInteger31, 'pfm'],
    ['cmyk', encodedCmyk, 'png'],
    ['cmyk-grouped', encodedGroupedCmyk, 'png'],
  ] as const) {
    const input = join(work, `${name}.jxl`)
    const output = join(work, `${name}.${extension}`)
    await writeFile(input, bytes)
    execFileSync(djxl, [input, output], { stdio: 'pipe' })
    if ((await readFile(output)).length === 0) throw new Error(`djxl emitted empty ${name} output`)
  }
} finally {
  await rm(work, { recursive: true, force: true })
}

const finalSourceSha256 = await hashM8Sources()
if (finalSourceSha256 !== initialSourceSha256)
  throw new Error('JPEG XL source changed during M10 verification')
const report = Object.freeze({
  schemaVersion: 1,
  revision: reportRevision(),
  decoderSourceSha256: finalSourceSha256,
  profileMapSha256: sha256(
    new Uint8Array(
      await readFile('benchmark/jpegxl/production-program/m10-level-profile-map.json'),
    ),
  ),
  officialFixtures: Object.freeze({
    binary32: Object.freeze({
      inputSha256: sha256(floatInput),
      samples: floatSamples,
      floatDigest,
    }),
    cmyk: Object.freeze({
      inputSha256: sha256(cmykInput),
      layers: cmykLayers,
      rows: cmykRows,
      displaySha256: cmykDisplaySha256,
    }),
  }),
  writerCases: Object.freeze(
    inspections.map((inspection, index) =>
      Object.freeze({
        id: [
          'binary32',
          'binary32-grouped',
          'integer31',
          'cmyk',
          'cmyk-grouped',
          'integer12',
          'integer13',
        ][index],
        kind: inspection.kind,
        level: inspection.level ?? 5,
      }),
    ),
  ),
  independentDecoder: Object.freeze({ name: 'libjxl-djxl-v0.12.0', accepted: 5 }),
  remainingUnsupported: profileMap.remainingUnsupported,
  gates: Object.freeze({
    normativeMap: true,
    officialBinary32Exact: true,
    officialCmykNativeAndDisplay: true,
    minimumLevelSelection: true,
    level10ContainerSignaling: true,
    independentDecoderAcceptance: true,
  }),
})
const serialized = `${JSON.stringify(report, null, 2)}\n`
const output = argument('--output')
if (output) {
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, serialized)
} else process.stdout.write(serialized)
