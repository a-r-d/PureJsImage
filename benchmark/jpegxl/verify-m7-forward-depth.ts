import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { inspectJpegXl } from '../../src/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'

const progressive = process.argv.includes('--progressive')
if (process.argv.includes('--effort7') && process.argv.includes('--effort1'))
  throw new Error('Conflicting effort flags')
const effort = process.argv.includes('--effort7') ? 7 : process.argv.includes('--effort1') ? 1 : 3
const distance = process.argv.includes('--distance3') ? 3 : 0.25
const directory = `.tmp/jpegxl-m7/forward-depth-verified-mode-e${effort}${progressive ? '-progressive' : ''}${distance === 3 ? '-d3' : ''}-oracle`
await mkdir(directory, { recursive: true })
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const results: object[] = []
let failures = 0
for (const depth of [8, 10, 12, 16]) {
  for (const family of ['gray', 'rgb', 'rgba'] as const) {
    for (const alphaDepth of family === 'rgba' && depth !== 16 ? [depth, 16] : [depth]) {
      for (const [width, height] of [
        [17, 13],
        [513, 257],
      ]) {
        if (!width || !height) throw new Error('Missing dimensions')
        const id: string = `${family}-${depth}${alphaDepth === depth ? '' : `-alpha${alphaDepth}`}-${width}x${height}`
        try {
          const channels = family === 'gray' ? 1 : family === 'rgb' ? 3 : 4
          const sampleBytes = Math.max(depth, alphaDepth) === 8 ? 1 : 2,
            maximum = 2 ** depth - 1,
            alphaMaximum = 2 ** alphaDepth - 1
          const format =
            family === 'gray'
              ? sampleBytes === 1
                ? 'gray8'
                : 'gray16'
              : family === 'rgb'
                ? sampleBytes === 1
                  ? 'rgb8'
                  : 'rgb16'
                : sampleBytes === 1
                  ? 'rgba8'
                  : 'rgba16'
          const input = new Uint8Array(width * height * channels * sampleBytes)
          const inputView = new DataView(input.buffer)
          for (let pixel = 0; pixel < width * height; pixel++) {
            for (let channel = 0; channel < channels; channel++) {
              const value =
                channel === 3
                  ? (pixel * 37) % (alphaMaximum + 1)
                  : Math.round(
                      (channel === 1
                        ? Math.floor(pixel / width) / (height - 1)
                        : (pixel % width) / (width - 1)) * maximum,
                    )
              const offset = (pixel * channels + channel) * sampleBytes
              if (sampleBytes === 1) input[offset] = value
              else inputView.setUint16(offset, value, false)
            }
          }
          const sink = new Uint8ArraySink()
          const encoder = await jpegxlCodec.createEncoder?.(sink, {
            width,
            height,
            pixelFormat: format,
            colorSemantics: {
              family: family === 'gray' ? 'gray' : 'rgb',
              primaries: 'srgb',
              transfer: { kind: 'srgb' },
              matrix: 'identity',
              range: 'full',
              alpha: family === 'rgba' ? 'straight' : 'none',
              provenance: 'assumed-default',
              renderingIntent: 'relative',
            },
            options: {
              mode: 'lossy',
              distance,
              effort,
              sampleBitDepth: depth,
              progressive,
              ...(family === 'rgba' ? { alphaBitDepth: alphaDepth } : {}),
            },
            limits: defaultImageLimits,
          })
          if (!encoder) throw new Error('Missing encoder')
          await encoder.write({
            x: 0,
            y: 0,
            width,
            height,
            stride: width * channels * sampleBytes,
            format,
            data: input,
          })
          await encoder.finish()
          const bytes = sink.toUint8Array(),
            path = `${directory}/${id}.jxl`
          const inspection = await inspectJpegXl(bytes)
          if (inspection.progressivePasses !== (progressive ? 2 : 1))
            throw new Error('Requested progressive mode was not encoded')
          await writeFile(path, bytes)
          const oracles: object[] = []
          let reference: Uint16Array | undefined
          for (const oracle of ['libjxl', 'jxl-rs']) {
            const output = `${directory}/${id}-${oracle}.png`
            const decoded = spawnSync(
              oracle === 'libjxl'
                ? '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/djxl'
                : '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli',
              oracle === 'libjxl'
                ? [path, output, '--num_threads=1', '--bits_per_sample=16']
                : [path, output, '--num-threads', '1', '--data-type', 'u16'],
              { encoding: 'utf8', timeout: 120_000 },
            )
            if (decoded.status !== 0)
              throw new Error(`${oracle}: ${decoded.stderr}; ${decoded.error ?? ''}`)
            const { data, info } = await sharp(await readFile(output))
              .toColourspace('rgb16')
              .ensureAlpha()
              .raw({ depth: 'ushort' })
              .toBuffer({ resolveWithObject: true })
            if (
              info.width !== width ||
              info.height !== height ||
              info.channels !== 4 ||
              data.length !== width * height * 8
            )
              throw new Error(`${oracle}: unexpected decoded extent`)
            const samples = new Uint16Array(data.buffer, data.byteOffset, data.length / 2)
            let maximumDifference = 0,
              maximumAlphaDifference = 0
            for (let pixel = 0; pixel < width * height; pixel++) {
              if (family === 'rgba') {
                const offset = (pixel * 4 + 3) * sampleBytes
                const expected =
                  sampleBytes === 1 ? (input[offset] ?? 0) : inputView.getUint16(offset, false)
                maximumAlphaDifference = Math.max(
                  maximumAlphaDifference,
                  Math.abs(
                    (samples[pixel * 4 + 3] ?? -1) - Math.round((expected * 65535) / alphaMaximum),
                  ),
                )
              }
              if (reference)
                for (let channel = 0; channel < 3; channel++)
                  maximumDifference = Math.max(
                    maximumDifference,
                    Math.abs(
                      (samples[pixel * 4 + channel] ?? 0) - (reference[pixel * 4 + channel] ?? 0),
                    ),
                  )
            }
            // Oracle PNG conversion rounds native alpha to the 16-bit output grid.
            if (maximumAlphaDifference > 1)
              throw new Error(`${oracle}: alpha differs by ${maximumAlphaDifference}`)
            if (maximumDifference > 514)
              throw new Error(`${oracle}: RGB differs by ${maximumDifference}/65535`)
            reference ??= samples
            oracles.push({
              oracle,
              maximumDifference,
              maximumAlphaDifference,
              decodedSha256: hash(data),
            })
          }
          results.push({
            id,
            status: 'verified',
            bytes: bytes.length,
            sourceSha256: hash(input),
            encodedSha256: hash(bytes),
            oracles,
          })
          console.log(`${id}: verified`)
        } catch (error) {
          failures++
          results.push({
            id,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          })
          console.log(`${id}: failed`)
        }
      }
    }
  }
}
await writeFile(`${directory}/report.json`, `${JSON.stringify({ failures, results }, null, 2)}\n`)
if (failures) process.exitCode = 1
