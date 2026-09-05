import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

const tools = process.argv[2] ?? '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const directory = 'tests/fixtures/jpegxl/m4-color'
const temporary = '.tmp/jpegxl-m4-color'
await mkdir(temporary, { recursive: true })
const hash = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')
const cases = []
for (const transfer of ['srgb', 'linear', 'pq', 'hlg'] as const) {
  for (const alpha of ['straight', 'premultiplied'] as const) {
    for (const [colorDepth, alphaDepth] of [
      [8, 8],
      [8, 16],
      [12, 8],
      [12, 16],
      [16, 10],
    ] as const) {
      const id = `${transfer}-${alpha}-${colorDepth}-${alphaDepth}`
      const wide = Math.max(colorDepth, alphaDepth) > 8
      const bytes = wide ? 2 : 1
      const pixelFormat = wide ? 'rgba16' : 'rgba8'
      const maximum = 2 ** colorDepth - 1
      const alphaMaximum = 2 ** alphaDepth - 1
      const pixels = new Uint8Array(5 * 4 * bytes)
      for (let x = 0; x < 5; x += 1) {
        for (let c = 0; c < 4; c += 1) {
          const value =
            c === 3
              ? Math.round((x * alphaMaximum) / 4)
              : Math.round(
                  ((((x + c) % 5) * maximum) / 4) * (alpha === 'premultiplied' ? x / 4 : 1),
                )
          const offset = (x * 4 + c) * bytes
          if (wide) {
            pixels[offset] = value >>> 8
            pixels[offset + 1] = value & 255
          } else pixels[offset] = value
        }
      }
      const colorSemantics = {
        family: 'rgb',
        primaries: transfer === 'pq' || transfer === 'hlg' ? 'rec2020' : 'srgb',
        transfer: { kind: transfer },
        matrix: 'identity',
        range: 'full',
        alpha,
        provenance: 'container-signaled',
        renderingIntent: 'relative',
      } as const
      const sink = new Uint8ArraySink()
      const encoder = await jpegxlCodec.createEncoder?.(sink, {
        width: 5,
        height: 1,
        pixelFormat,
        colorSemantics,
        options: {
          mode: 'lossless',
          effort: 1,
          sampleBitDepth: colorDepth,
          alphaBitDepth: alphaDepth,
        },
        limits: defaultImageLimits,
      })
      if (!encoder) throw new Error('Encoder unavailable')
      await encoder.write({
        x: 0,
        y: 0,
        width: 5,
        height: 1,
        stride: pixels.length,
        format: pixelFormat,
        data: pixels,
      })
      await encoder.finish()
      const encoded = sink.toUint8Array()
      const path = join(directory, `${id}.jxl`)
      await writeFile(path, encoded)
      await writeFile(join(directory, `${id}.bin`), pixels)
      const reference = join(temporary, `${id}.npy`)
      const result = spawnSync(join(tools, 'djxl'), [path, reference, '--num_threads=1'], {
        encoding: 'utf8',
      })
      if (result.status !== 0) throw new Error(result.stderr)
      const npy = await readFile(reference)
      const start = 10 + npy.readUInt16LE(8)
      let maximumError = 0
      for (let sample = 0; sample < 20; sample += 1) {
        const expected =
          (wide
            ? (pixels[sample * 2] ?? 0) * 256 + (pixels[sample * 2 + 1] ?? 0)
            : (pixels[sample] ?? 0)) / (sample % 4 === 3 ? alphaMaximum : maximum)
        maximumError = Math.max(
          maximumError,
          Math.abs(npy.readFloatLE(start + sample * 4) - expected),
        )
      }
      if (maximumError > 1e-6) throw new Error(`${id}: djxl error ${maximumError}`)
      const decoder = await jpegxlCodec.createDecoder?.(
        new MemorySource(encoded),
        defaultImageLimits,
      )
      if (!decoder) throw new Error('Decoder unavailable')
      for await (const block of decoder.decode()) {
        try {
          if (!Buffer.from(block.data).equals(pixels))
            throw new Error(`${id}: native samples differ`)
        } finally {
          block.release?.()
        }
      }
      cases.push({
        id,
        pixelFormat,
        colorDepth,
        alphaDepth,
        colorSemantics: decoder.colorSemantics,
        sha256: hash(encoded),
        pixelsSha256: hash(pixels),
        maximumNormalizedOracleError: maximumError,
      })
    }
  }
}
await writeFile(
  join(directory, 'alpha-manifest.json'),
  `${JSON.stringify({ schemaVersion: 1, libjxlRevision: 'a7a9c787341cf703dede03c2009fa460cae5e5df', cases }, null, 2)}\n`,
)
console.log(`${cases.length} alpha cases match djxl and native samples`)
