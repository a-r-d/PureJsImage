import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { jpegCodec } from '../../src/codecs/jpeg.ts'
import {
  assembleGainMapJpeg,
  inspectHdrJpeg,
  normalizeGainMapMetadata,
  type GainMapJpegMetadataMode,
  type GainMapMetadata,
} from '../../src/hdr/index.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

interface FixtureDefinition {
  readonly file: string
  readonly baseWidth: number
  readonly baseHeight: number
  readonly gainWidth: number
  readonly gainHeight: number
  readonly gainChannels: 1 | 3
  readonly metadataMode: GainMapJpegMetadataMode
  readonly progressive: boolean
}

const outputDirectory = 'benchmark/corpus/files'
const browserSample = 'docs-astro/public/demo-data/hdr-surgery-synthetic-dual.jpg'

const definitions: readonly FixtureDefinition[] = Object.freeze([
  {
    file: 'hdr-surgery-synthetic-dual.jpg',
    baseWidth: 320,
    baseHeight: 180,
    gainWidth: 80,
    gainHeight: 45,
    gainChannels: 1,
    metadataMode: 'dual',
    progressive: false,
  },
  {
    file: 'hdr-surgery-synthetic-xmp.jpg',
    baseWidth: 320,
    baseHeight: 180,
    gainWidth: 80,
    gainHeight: 45,
    gainChannels: 1,
    metadataMode: 'ultra-hdr',
    progressive: false,
  },
  {
    file: 'hdr-surgery-synthetic-iso.jpg',
    baseWidth: 320,
    baseHeight: 180,
    gainWidth: 80,
    gainHeight: 45,
    gainChannels: 1,
    metadataMode: 'iso',
    progressive: false,
  },
  {
    file: 'hdr-surgery-synthetic-rgb-progressive.jpg',
    baseWidth: 321,
    baseHeight: 183,
    gainWidth: 107,
    gainHeight: 61,
    gainChannels: 3,
    metadataMode: 'dual',
    progressive: true,
  },
  {
    file: 'hdr-surgery-synthetic-odd-scale.jpg',
    baseWidth: 319,
    baseHeight: 187,
    gainWidth: 87,
    gainHeight: 51,
    gainChannels: 1,
    metadataMode: 'dual',
    progressive: false,
  },
  {
    file: 'hdr-surgery-synthetic-12mp.jpg',
    baseWidth: 4000,
    baseHeight: 3000,
    gainWidth: 1000,
    gainHeight: 750,
    gainChannels: 1,
    metadataMode: 'dual',
    progressive: false,
  },
  {
    file: 'hdr-surgery-synthetic-24mp.jpg',
    baseWidth: 6000,
    baseHeight: 4000,
    gainWidth: 1500,
    gainHeight: 1000,
    gainChannels: 1,
    metadataMode: 'dual',
    progressive: false,
  },
])

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const encodeJpeg = async (
  width: number,
  height: number,
  format: 'gray8' | 'rgb8',
  data: Uint8Array,
  progressive: boolean,
): Promise<Uint8Array> => {
  if (!jpegCodec.createEncoder) throw new Error('JPEG encoder is unavailable')
  const sink = new Uint8ArraySink()
  const encoder = await jpegCodec.createEncoder(sink, {
    width,
    height,
    pixelFormat: format,
    options: { quality: 94, progressive, chromaSubsampling: format === 'gray8' ? '444' : '420' },
  })
  await encoder.write({
    x: 0,
    y: 0,
    width,
    height,
    stride: width * (format === 'gray8' ? 1 : 3),
    format,
    data,
  })
  await encoder.finish()
  return sink.toUint8Array()
}

const basePixels = (width: number, height: number): Uint8Array => {
  const output = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      output[offset] = Math.round((x * 255) / Math.max(1, width - 1))
      output[offset + 1] = Math.round((y * 255) / Math.max(1, height - 1))
      output[offset + 2] = ((x >>> 4) + (y >>> 4)) % 2 === 0 ? 48 : 208
    }
  }
  return output
}

const gainPixels = (width: number, height: number, channels: 1 | 3): Uint8Array => {
  const output = new Uint8Array(width * height * channels)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const horizontal = Math.round((x * 255) / Math.max(1, width - 1))
      const vertical = Math.round((y * 255) / Math.max(1, height - 1))
      const offset = (y * width + x) * channels
      output[offset] = horizontal
      if (channels === 3) {
        output[offset + 1] = vertical
        output[offset + 2] = 255 - horizontal
      }
    }
  }
  return output
}

const color = Object.freeze({
  family: 'rgb' as const,
  primaries: 'srgb' as const,
  transfer: Object.freeze({ kind: 'srgb' as const }),
  matrix: 'identity' as const,
  range: 'full' as const,
  alpha: 'none' as const,
  provenance: 'container-signaled' as const,
})

const metadata = (definition: FixtureDefinition): GainMapMetadata =>
  normalizeGainMapMetadata({
    baseRendition: 'sdr',
    channelCount: definition.gainChannels,
    baseDimensions: { width: definition.baseWidth, height: definition.baseHeight },
    gainMapDimensions: { width: definition.gainWidth, height: definition.gainHeight },
    minimum: definition.gainChannels === 1 ? [-1] : [-1, -0.5, 0],
    maximum: definition.gainChannels === 1 ? [3] : [2, 2.5, 3],
    gamma: definition.gainChannels === 1 ? [1.25] : [1, 1.25, 1.5],
    offsetSdr: definition.gainChannels === 1 ? [1 / 64] : [1 / 64, 1 / 128, 1 / 256],
    offsetHdr: definition.gainChannels === 1 ? [1 / 64] : [1 / 256, 1 / 128, 1 / 64],
    capacityMinimum: 0,
    capacityMaximum: 3,
    useBaseColorSpace: true,
    baseColor: color,
    alternateColor: Object.freeze({
      ...color,
      transfer: Object.freeze({ kind: 'linear' as const }),
    }),
    gainMapColor: Object.freeze({
      ...color,
      family: definition.gainChannels === 1 ? ('gray' as const) : ('rgb' as const),
      transfer: Object.freeze({ kind: 'linear' as const }),
    }),
    container: 'jpeg',
    representations:
      definition.metadataMode === 'dual'
        ? ['iso-21496-1', 'ultra-hdr-xmp']
        : [definition.metadataMode === 'iso' ? 'iso-21496-1' : 'ultra-hdr-xmp'],
    selectedRepresentation:
      definition.metadataMode === 'ultra-hdr' ? 'ultra-hdr-xmp' : 'iso-21496-1',
    metadataRanges: [],
    orientation: 1,
    warnings: [],
  })

for (const definition of definitions) {
  const base = await encodeJpeg(
    definition.baseWidth,
    definition.baseHeight,
    'rgb8',
    basePixels(definition.baseWidth, definition.baseHeight),
    definition.progressive,
  )
  const gain = await encodeJpeg(
    definition.gainWidth,
    definition.gainHeight,
    definition.gainChannels === 1 ? 'gray8' : 'rgb8',
    gainPixels(definition.gainWidth, definition.gainHeight, definition.gainChannels),
    false,
  )
  const output = await assembleGainMapJpeg(
    { baseJpeg: base, gainMapJpeg: gain, metadata: metadata(definition) },
    { metadataMode: definition.metadataMode },
  )
  const path = join(outputDirectory, definition.file)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, output)
  if (definition.file === 'hdr-surgery-synthetic-dual.jpg') {
    await mkdir(dirname(browserSample), { recursive: true })
    await writeFile(browserSample, output)
  }
  const inspection = await inspectHdrJpeg(new MemorySource(output))
  console.log(
    JSON.stringify({
      file: definition.file,
      bytes: output.byteLength,
      sha256: sha256(output),
      baseRange: inspection.primary,
      gainMapRange: inspection.gainMap,
      representations: inspection.representations,
      baseDimensions: inspection.primaryDimensions,
      gainMapDimensions: inspection.gainMapDimensions,
    }),
  )
}
