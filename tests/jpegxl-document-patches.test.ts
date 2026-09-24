import { describe, expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import { encodeJpegXlDocumentPatchCandidate } from '../src/codecs/jpegxl-modular-encode.ts'
import { readJpegXlSourceFrameStructures } from '../src/codecs/jpegxl-decode.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'

const colorSemantics = {
  family: 'rgb',
  primaries: 'srgb',
  transfer: { kind: 'srgb' },
  matrix: 'identity',
  range: 'full',
  alpha: 'none',
  provenance: 'assumed-default',
  renderingIntent: 'relative',
} as const
const options = {
  mode: 'lossy',
  effort: 7,
  distance: 3,
  progressive: false,
  container: false,
  codestreamLevel: 5,
  sampleBitDepth: 8,
  orientation: 1,
  colorSemantics,
  toneMapping: {
    intensityTarget: 255,
    minNits: 0,
    relativeToMaxDisplay: false,
    linearBelow: 0,
  },
} as const

const patternedPage = (): Uint8Array => {
  const width = 256,
    height = 256,
    pixels = new Uint8Array(width * height * 3)
  pixels.fill(255)
  for (let cellY = 0; cellY < 25; cellY++) {
    for (let cellX = 0; cellX < 25; cellX++) {
      for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 6; x++) {
          const offset = ((cellY * 10 + y) * width + cellX * 10 + x) * 3
          pixels[offset] = 18
          pixels[offset + 1] = 24
          pixels[offset + 2] = 30
        }
      }
    }
  }
  return pixels
}

const encodeCandidate = async (pixels: Uint8Array) => {
  const memory = new JpegXlEncoderMemory(268_435_456)
  try {
    return await encodeJpegXlDocumentPatchCandidate(
      pixels,
      256,
      256,
      options,
      memory,
      async () => {},
    )
  } finally {
    memory.close()
  }
}

describe('JPEG XL document reference patches', () => {
  it('encodes repeated components as a reference frame and restores RGB pixels', async () => {
    const pixels = patternedPage()
    const candidate = await encodeCandidate(pixels)
    expect(candidate).toBeDefined()
    if (!candidate) return
    const encoded = new Uint8Array(candidate.byteLength)
    encoded.set(candidate.header)
    let offset = candidate.header.length
    for (const section of candidate.sections) {
      encoded.set(section, offset)
      offset += section.length
    }
    const frames = await readJpegXlSourceFrameStructures(
      new MemorySource(encoded),
      defaultImageLimits,
    )
    expect(frames.map((frame) => [frame.frameType, frame.encoding, frame.frameFlags])).toEqual([
      ['reference', 'modular', 0],
      ['regular', 'modular', 2],
    ])
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
    expect(decoder).toBeDefined()
    if (!decoder) return
    let row = 0
    for await (const block of decoder.decode()) {
      expect(block.format).toBe('rgb8')
      for (let y = 0; y < block.height; y++) {
        const actual = block.data.subarray(y * block.stride, y * block.stride + 256 * 3)
        const expected = pixels.subarray((row + y) * 256 * 3, (row + y + 1) * 256 * 3)
        expect(actual).toEqual(expected)
      }
      row += block.height
      block.release?.()
    }
    expect(row).toBe(256)
  })

  it('does not build a reference frame without repeated foreground', async () => {
    const pixels = new Uint8Array(256 * 256 * 3)
    pixels.fill(255)
    expect(await encodeCandidate(pixels)).toBeUndefined()
  })
})
