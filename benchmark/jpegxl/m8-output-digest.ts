import type { Hash } from 'node:crypto'
import type { JpegXlNativeLayer, JpegXlSequenceFrame } from '../../src/jpegxl.ts'

const planes = (hash: Hash, values: readonly (Int32Array | Float64Array)[]): void => {
  const scratch = new Uint8Array(8192)
  const view = new DataView(scratch.buffer)
  for (const plane of values) {
    hash.update(JSON.stringify({ samples: plane.length }))
    for (let start = 0; start < plane.length; start += 1024) {
      const count = Math.min(1024, plane.length - start)
      for (let i = 0; i < count; i++) view.setFloat64(i * 8, plane[start + i] ?? 0, false)
      hash.update(scratch.subarray(0, count * 8))
    }
  }
}

export const hashM8PortablePlanes = (
  hash: Hash,
  values: readonly (Int32Array | Float64Array)[],
): void => {
  const scratch = new Uint8Array(8192)
  const view = new DataView(scratch.buffer)
  for (const plane of values) {
    hash.update(JSON.stringify({ samples: plane.length }))
    for (let start = 0; start < plane.length; start += 1024) {
      const count = Math.min(1024, plane.length - start)
      for (let i = 0; i < count; i++) {
        const sample = plane[start + i] ?? 0
        const portable =
          plane instanceof Int32Array ? sample : Math.round(sample * 1_048_576) / 1_048_576
        view.setFloat64(i * 8, portable, false)
      }
      hash.update(scratch.subarray(0, count * 8))
    }
  }
}

const frameMetadata = (frame: Readonly<JpegXlSequenceFrame>): string =>
  JSON.stringify({
    index: frame.index,
    internalFrameIndex: frame.internalFrameIndex,
    startTicks: frame.startTicks,
    durationTicks: frame.durationTicks,
    timecode: frame.header.timecode,
    animation: frame.header.animation,
    width: frame.width,
    height: frame.height,
    colorChannels: frame.header.colorChannels,
    extraChannels: frame.header.extraChannels,
    colorSemantics: frame.colorSemantics,
  })

export const hashM8Frame = (hash: Hash, frame: Readonly<JpegXlSequenceFrame>): void => {
  hash.update(frameMetadata(frame))
  planes(hash, frame.planes)
}

/** Stable across supported V8 versions while remaining much stricter than display tolerances. */
export const hashM8FramePortable = (hash: Hash, frame: Readonly<JpegXlSequenceFrame>): void => {
  hash.update(frameMetadata(frame))
  hashM8PortablePlanes(hash, frame.planes)
}

export const hashM8Layer = (hash: Hash, layer: Readonly<JpegXlNativeLayer>): void => {
  hash.update(
    JSON.stringify({
      internalFrameIndex: layer.internalFrameIndex,
      domain: layer.domain,
      layouts: layer.layouts,
      colorChannels: layer.header.colorChannels,
      extraChannels: layer.header.extraChannels,
      bitDepth: layer.header.bitDepth,
      exponentBits: layer.header.exponentBits,
      sampleFormat: layer.header.sampleFormat,
    }),
  )
  planes(hash, layer.planes)
}

/** Include the entire first-party codec implementation, not only the header parser. */
export const hashM8Sources = async (): Promise<string> => {
  const { createHash } = await import('node:crypto')
  const { readFile, readdir } = await import('node:fs/promises')
  const files = (await readdir('src/codecs'))
    .filter((name) => name.startsWith('jpegxl') && name.endsWith('.ts'))
    .map((name) => `src/codecs/${name}`)
  files.push('src/color.ts', 'src/codecs/icc.ts', 'src/jpegxl.ts')
  const hash = createHash('sha256')
  for (const file of files.sort()) {
    hash.update(`${file}\0`)
    hash.update(await readFile(file))
  }
  return hash.digest('hex')
}
