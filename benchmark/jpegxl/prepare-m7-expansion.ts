import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { hdrCodec } from '../../src/codecs/hdr.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'
import {
  m7CompositeSample,
  m7DisplaySample,
  m7PqFromRelativeLight,
  m7RelativeLightFromPq,
} from './m7-hdr-mapping.ts'
import downloads from './production-program/m7-expansion-downloads.json' with { type: 'json' }

sharp.concurrency(1)
const directory = '.tmp/jpegxl-m7/expansion-inputs'
await mkdir(directory, { recursive: true })
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const protocol = await readFile('benchmark/jpegxl/production-program/m7-hdr-alpha-protocol.json')
const protocolSha256 = hash(protocol)
const mappingSha256 = hash(await readFile('benchmark/jpegxl/m7-hdr-mapping.ts'))
const results: object[] = []
let failures = 0
for (const entry of downloads.cases) {
  try {
    if (entry.status !== 'verified') throw new Error('Frozen source is not verified')
    const bytes = await readFile(`.tmp/jpegxl-m7/sources/${entry.id}.${entry.format}`)
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sourceSha256)
      throw new Error('Frozen source changed')
    const output = `${directory}/${entry.id}`
    await mkdir(output, { recursive: true })
    const artifacts: object[] = []
    const save = async (name: string, data: Uint8Array): Promise<void> => {
      await writeFile(`${output}/${name}`, data)
      artifacts.push({ name, bytes: data.length, sha256: hash(data) })
    }
    const ppm = async (
      name: string,
      width: number,
      height: number,
      pixels: Uint8Array,
      high = false,
    ) => {
      await save(
        name,
        Buffer.concat([Buffer.from(`P6\n${width} ${height}\n${high ? 65535 : 255}\n`), pixels]),
      )
    }
    if (entry.format === 'png') {
      const { data, info } = await sharp(bytes)
        .toColourspace('srgb')
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      if (info.channels !== 4) throw new Error('Expected straight RGBA8')
      await save('input.rgba8', data)
      let transparent = 0,
        partial = 0
      for (let index = 3; index < data.length; index += 4) {
        transparent += data[index] === 0 ? 1 : 0
        partial += data[index] !== 0 && data[index] !== 255 ? 1 : 0
      }
      for (const background of [0, 1] as const) {
        const composite = new Uint8Array(info.width * info.height * 3)
        for (let pixel = 0; pixel < info.width * info.height; pixel++)
          for (let channel = 0; channel < 3; channel++)
            composite[pixel * 3 + channel] = m7CompositeSample(
              data[pixel * 4 + channel] ?? 0,
              data[pixel * 4 + 3] ?? 0,
              background,
            )
        await ppm(
          `background-${background === 0 ? 'black' : 'white'}.ppm`,
          info.width,
          info.height,
          composite,
        )
      }
      const result = {
        id: entry.id,
        split: entry.split,
        sourceSha256: entry.sourceSha256,
        status: 'prepared',
        width: info.width,
        height: info.height,
        format: 'rgba8',
        transparent,
        partial,
        artifacts,
        protocolSha256,
        mappingSha256,
      }
      await writeFile(`${output}/input.json`, JSON.stringify(result, null, 2) + '\n')
      results.push(result)
    } else {
      const decoder = await hdrCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
      if (!decoder) throw new Error('Missing HDR decoder')
      const { width, height } = decoder
      const count = width * height * 3
      const original = new Uint8Array(count * 4),
        originalView = new DataView(original.buffer)
      const pq = new Uint8Array(count * 2),
        pqView = new DataView(pq.buffer)
      const reference = new Uint8Array(count * 4),
        referenceView = new DataView(reference.buffer)
      let visited = 0,
        clipped = 0,
        squaredQuantizationError = 0,
        maximumQuantizationError = 0
      for await (const block of decoder.decode()) {
        try {
          if (block.format !== 'rgbf32') throw new Error('Unexpected HDR sample format')
          const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
          for (let y = 0; y < block.height; y++)
            for (let x = 0; x < block.width; x++)
              for (let channel = 0; channel < 3; channel++) {
                const light = view.getFloat32(y * block.stride + x * 12 + channel * 4, false)
                const index = ((block.y + y) * width + block.x + x) * 3 + channel
                const value = Math.round(m7PqFromRelativeLight(light) * 65535)
                const decoded = m7RelativeLightFromPq(value / 65535)
                originalView.setFloat32(index * 4, light, false)
                pqView.setUint16(index * 2, value, false)
                referenceView.setFloat32(index * 4, decoded, false)
                clipped += light > 10000 / 203 ? 1 : 0
                const error = Math.abs(decoded - Math.min(light, 10000 / 203))
                squaredQuantizationError += error * error
                maximumQuantizationError = Math.max(maximumQuantizationError, error)
                visited++
              }
        } finally {
          block.release?.()
        }
      }
      if (visited !== count) throw new Error('Incomplete HDR sample extent')
      await save('original.rgbf32be', original)
      await save('reference.rgbf32be', reference)
      await ppm('input-pq16.ppm', width, height, pq, true)
      for (const headroom of [1, 2, 4] as const) {
        const display = new Uint8Array(count)
        for (let index = 0; index < count; index++)
          display[index] = m7DisplaySample(referenceView.getFloat32(index * 4, false), headroom)
        await ppm(`headroom-${headroom}.ppm`, width, height, display)
      }
      const result = {
        id: entry.id,
        split: entry.split,
        sourceSha256: entry.sourceSha256,
        status: 'prepared',
        width,
        height,
        format: 'rgb16-pq-srgb',
        samples: count,
        clipped,
        maximumQuantizationError,
        quantizationRmse: Math.sqrt(squaredQuantizationError / count),
        artifacts,
        protocolSha256,
        mappingSha256,
      }
      await writeFile(`${output}/input.json`, JSON.stringify(result, null, 2) + '\n')
      results.push(result)
    }
  } catch (error) {
    failures++
    results.push({ id: entry.id, split: entry.split, status: 'failed', error: String(error) })
  }
}
await writeFile(
  `${directory}/report.json`,
  JSON.stringify({ protocolSha256, mappingSha256, failures, results }, null, 2) + '\n',
)
console.log(JSON.stringify({ prepared: results.length - failures, failures, directory }))
if (failures) process.exitCode = 1
