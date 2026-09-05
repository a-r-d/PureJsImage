import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { inspectJpegXl } from '../../src/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

const tools = process.argv[2] ?? '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const directory = 'tests/fixtures/jpegxl/m4-color'
const temporary = '.tmp/jpegxl-m4-color'
const run = (tool: string, args: readonly string[]): void => {
  const result = spawnSync(join(tools, tool), args, { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
}
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const cases = []
for (const [color, description] of [
  ['srgb', 'RGB_D65_SRG_Rel_SRG'],
  ['linear', 'RGB_D65_SRG_Rel_Lin'],
  ['p3', 'DisplayP3'],
  ['rec2020', 'RGB_D65_202_Rel_Lin'],
  ['pq', 'RGB_D65_202_Rel_PeQ'],
  ['hlg', 'RGB_D65_202_Rel_HLG'],
] as const) {
  for (const depth of [10, 12, 16]) {
    const id = `vardct-${color}-${depth}`
    const path = join(directory, `${id}.jxl`)
    run('cjxl', [
      join(temporary, `${color}-${depth}.ppm`),
      path,
      '-d',
      '1',
      '-e',
      '1',
      '--num_threads=1',
      '-x',
      `color_space=${description}`,
    ])
    const encoded = await readFile(path)
    const metadata = await inspectJpegXl(encoded)
    const referencePath = join(temporary, `${id}.npy`)
    run('djxl', [
      path,
      referencePath,
      '--num_threads=1',
      `--color_space=RGB_D65_SRG_Rel_${color === 'srgb' ? 'SRG' : 'Lin'}`,
    ])
    const npy = await readFile(referencePath)
    const start = 10 + npy.readUInt16LE(8)
    const hdr = color === 'pq' || color === 'hlg'
    const scale = hdr ? metadata.toneMapping.intensityTarget / 203 : 1
    const expected = new Uint8Array(7 * 5 * 3 * 4)
    const referenceView = new DataView(expected.buffer)
    for (let sample = 0; sample < 7 * 5 * 3; sample += 1)
      referenceView.setFloat32(sample * 4, npy.readFloatLE(start + sample * 4) * scale, false)
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
    if (!decoder) throw new Error('JPEG XL decoder unavailable')
    let maximumError = 0
    let squared = 0
    let samples = 0
    for await (const block of decoder.decode()) {
      try {
        const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
        for (let sample = 0; sample < block.width * 3; sample += 1) {
          const actual =
            block.format === 'rgb16'
              ? view.getUint16(sample * 2, false) / (2 ** depth - 1)
              : view.getFloat32(sample * 4, false)
          const reference = referenceView.getFloat32(
            (block.y * block.width * 3 + sample) * 4,
            false,
          )
          const error =
            Math.abs(
              actual - (color === 'srgb' ? Math.max(0, Math.min(1, reference)) : reference),
            ) / scale
          maximumError = Math.max(maximumError, error)
          squared += error * error
          samples += 1
        }
      } finally {
        block.release?.()
      }
    }
    const rmse = Math.sqrt(squared / samples)
    if (maximumError > 1 / 255 || rmse > 0.55 / 255)
      throw new Error(`${id}: output differs: ${maximumError}, ${rmse}`)
    await writeFile(join(directory, `${id}.bin`), expected)
    cases.push({
      id,
      depth,
      width: 7,
      height: 5,
      format: decoder.pixelFormat,
      colorSemantics: decoder.colorSemantics,
      sourcePeak: scale,
      clipReference: color === 'srgb',
      sha256: hash(encoded),
      pixelsSha256: hash(expected),
      maximumNormalizedError: maximumError,
      normalizedRmse: rmse,
    })
  }
}
await writeFile(
  join(directory, 'vardct-manifest.json'),
  `${JSON.stringify({ schemaVersion: 1, libjxlRevision: 'a7a9c787341cf703dede03c2009fa460cae5e5df', comparison: 'Pinned djxl float output in matching sRGB transfer, HDR scaled to 203 nit reference white; M3 normalized rounding thresholds retained', cases }, null, 2)}\n`,
)
console.log(`${cases.length} VarDCT color fixtures match djxl`)
