import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { hdrCodec } from '../../src/codecs/hdr.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'
import downloads from './production-program/m7-expansion-downloads.json' with { type: 'json' }

const results: object[] = []
let failures = 0
for (const entry of downloads.cases) {
  try {
    if (entry.status !== 'verified') throw new Error('Source download failed')
    const bytes = await readFile(`.tmp/jpegxl-m7/sources/${entry.id}.${entry.format}`)
    if (
      bytes.length !== entry.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== entry.sourceSha256
    )
      throw new Error('Frozen source changed')
    if (entry.format === 'png') {
      const metadata = await sharp(bytes).metadata()
      const stats = await sharp(bytes).stats()
      const alpha = stats.channels[3]
      if (
        metadata.width !== 512 ||
        metadata.height !== 512 ||
        !metadata.hasAlpha ||
        !alpha ||
        alpha.min !== 0 ||
        alpha.max !== 255
      )
        throw new Error('Expected actual transparent and opaque pixels')
      results.push({
        id: entry.id,
        split: entry.split,
        status: 'inspected',
        width: metadata.width,
        height: metadata.height,
        format: 'rgba8',
        alphaMinimum: alpha.min,
        alphaMaximum: alpha.max,
        sourceSha256: entry.sourceSha256,
      })
    } else {
      const decoder = await hdrCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
      if (!decoder) throw new Error('Missing HDR decoder')
      let minimum = Infinity,
        maximum = -Infinity,
        nonzero = 0,
        aboveOne = 0,
        samples = 0
      for await (const block of decoder.decode()) {
        if (block.format !== 'rgbf32') throw new Error('Unexpected HDR output format')
        const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
        for (let y = 0; y < block.height; y++) {
          for (let x = 0; x < block.width * 3; x++) {
            const value = view.getFloat32(y * block.stride + x * 4, false)
            if (!Number.isFinite(value) || value < 0) throw new Error('Invalid HDR radiance')
            minimum = Math.min(minimum, value)
            maximum = Math.max(maximum, value)
            nonzero += value > 0 ? 1 : 0
            aboveOne += value > 1 ? 1 : 0
            samples++
          }
        }
        block.release?.()
      }
      if (samples !== decoder.width * decoder.height * 3 || maximum <= 1)
        throw new Error('Missing HDR sample extent or highlight range')
      const headerEnd = bytes.indexOf(Buffer.from('\n\n'))
      results.push({
        id: entry.id,
        split: entry.split,
        status: 'inspected',
        width: decoder.width,
        height: decoder.height,
        format: 'Radiance RGBE decoded to rgbf32',
        minimum,
        maximum,
        nonzero,
        aboveOne,
        samples,
        sourceSha256: entry.sourceSha256,
        radianceHeader: headerEnd < 0 ? null : bytes.subarray(0, headerEnd).toString('ascii'),
      })
    }
  } catch (error) {
    failures++
    results.push({ id: entry.id, split: entry.split, status: 'failed', error: String(error) })
  }
}
await writeFile(
  '.tmp/jpegxl-m7/expansion-inventory.json',
  JSON.stringify(
    {
      schemaVersion: 1,
      failures,
      scope: 'Source properties only; no evaluated encoder or holdout quality results.',
      results,
    },
    null,
    2,
  ) + '\n',
)
if (failures) process.exitCode = 1
