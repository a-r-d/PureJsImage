import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { readJpegXlSourceFrameStructures } from '../../src/codecs/jpegxl-decode.ts'
import { JpegXlEncoderMemory } from '../../src/codecs/jpegxl-encoder-memory.ts'
import { encodeJpegXlDocumentPatchCandidate } from '../../src/codecs/jpegxl-modular-encode.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'
import { losslessPatchFixture } from './jpegxl-lossless-patches.ts'

export const verifySmallGroupPatch = async (format: 'rgb8' | 'rgba8') => {
  const tile = losslessPatchFixture(format, 'flat'),
    width = 2049,
    height = 129,
    channels = tile.channels
  const pixels = new Uint8Array(width * height * channels)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const source = ((y % tile.height) * tile.width + (x % tile.width)) * channels,
        target = (y * width + x) * channels
      for (let channel = 0; channel < channels; channel++)
        pixels[target + channel] = tile.pixels[source + channel] ?? 0
    }
  const original = Uint8Array.from(pixels),
    memory = new JpegXlEncoderMemory(134_217_728)
  let encoded: Uint8Array | undefined
  try {
    const result = await encodeJpegXlDocumentPatchCandidate(
      pixels,
      width,
      height,
      {
        mode: 'lossless',
        effort: 7,
        distance: 0,
        progressive: false,
        container: false,
        codestreamLevel: 5,
        sampleBitDepth: 8,
        orientation: 1,
        colorSemantics: {
          family: 'rgb',
          primaries: 'srgb',
          transfer: { kind: 'srgb' },
          matrix: 'identity',
          range: 'full',
          alpha: channels === 4 ? 'straight' : 'none',
          provenance: 'assumed-default',
          renderingIntent: 'relative',
        },
        toneMapping: {
          intensityTarget: 255,
          minNits: 0,
          relativeToMaxDisplay: false,
          linearBelow: 0,
        },
      },
      memory,
      async () => {},
      format,
      'flat',
      true,
    )
    if (!result) throw new Error('Missing small-group patch fixture')
    encoded = new Uint8Array(result.byteLength)
    encoded.set(result.header)
    let offset = result.header.length
    for (const section of result.sections) {
      encoded.set(section, offset)
      offset += section.length
    }
    if (offset !== encoded.length) throw new Error('Wrong candidate extent')
  } finally {
    memory.close()
  }
  if (!encoded || memory.liveBytes !== 0 || memory.liveAllocations !== 0)
    throw new Error('Small-group fixture ownership did not close')
  const frames = await readJpegXlSourceFrameStructures(
      new MemorySource(encoded),
      defaultImageLimits,
    ),
    display = frames.at(-1)
  if (
    frames.length !== 2 ||
    !display ||
    display.groupDimension !== 256 ||
    display.groupsAcross !== 9 ||
    display.groupsDown !== 1 ||
    display.dcGroupCount !== 2
  )
    throw new Error('Small-group/DC edge was not selected')
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (!decoder) throw new Error('Missing fixture decoder')
  const coverage = new Uint8Array(width * height)
  let samples = 0
  for await (const block of decoder.decode()) {
    try {
      if (
        block.format !== format ||
        block.x < 0 ||
        block.y < 0 ||
        block.x + block.width > width ||
        block.y + block.height > height
      )
        throw new Error('Wrong fixture sample layout')
      for (let y = 0; y < block.height; y++)
        for (let x = 0; x < block.width; x++) {
          const pixel = (block.y + y) * width + block.x + x
          if (coverage[pixel] !== 0) throw new Error('Duplicate fixture pixel')
          coverage[pixel] = 1
          for (let channel = 0; channel < channels; channel++) {
            if (
              block.data[y * block.stride + x * channels + channel] !==
              pixels[pixel * channels + channel]
            )
              throw new Error('Small-group sample changed')
            samples++
          }
        }
    } finally {
      block.release?.()
    }
  }
  if (
    samples !== pixels.length ||
    coverage.some((value) => value !== 1) ||
    pixels.some((value, index) => value !== original[index])
  )
    throw new Error('Incomplete output or mutated fixture')
  let checksum = 0x811c9dc5
  for (const byte of encoded) checksum = Math.imul(checksum ^ byte, 0x01000193) >>> 0
  return {
    format,
    bytes: encoded.length,
    checksum,
    samples,
    groups: 9,
    dcGroups: 2,
    ownedLive: memory.liveBytes,
    ownedAllocations: memory.liveAllocations,
  }
}
