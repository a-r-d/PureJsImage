import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput } from '../../errors.ts'
import { limitExceeded } from '../../errors.ts'
import { openTiffDocument } from '../../codecs/tiff.ts'
import type { ImageSource } from '../../source.ts'
import { toScientificDataset } from '../dataset-adapters.ts'
import { omeTiffImageCount, openOmeTiff } from '../ome-tiff.ts'
import type {
  ScientificDocument,
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
} from '../reader.ts'
import { createScientificDatasetIdentity, identifyScientificDataset } from '../reader.ts'
import { resourceHasHint } from './shared.ts'

const imageDescriptionTag = 270
const maximumProbeEntries = 4_096
const maximumProbeReadBytes = 16_384

export const omeTiffReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/ome-tiff',
  version: '1.0.0',
  format: 'OME-TIFF',
  extensions: Object.freeze(['tif', 'tiff']),
  mediaTypes: Object.freeze(['image/tiff', 'image/x-tiff']),
  capabilities: Object.freeze({ resources: 'single', datasets: 'multiple', axes: 'xyzct' }),
})

const isTiffPrefix = (bytes: Uint8Array): boolean =>
  bytes.byteLength >= 4 &&
  ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a) ||
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2b && bytes[3] === 0) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2b))

const containsOmeXml = (bytes: Uint8Array): boolean => {
  const text = new TextDecoder('utf-8').decode(bytes)
  return /<(?:(?:[A-Za-z_][\w.-]*):)?OME\b/u.test(text)
}

const probeRead = async (
  source: ImageSource,
  offset: number,
  length: number,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> => {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    offset > source.size ||
    length > source.size - offset
  ) {
    throw invalidInput(`OME-TIFF probe range ${offset}+${length} is outside the source`)
  }
  const bytes = await source.read(offset, length, {
    ...(signal === undefined ? {} : { signal }),
  })
  if (bytes.byteLength !== length) throw invalidInput('OME-TIFF probe source returned a short read')
  return bytes
}

const unsigned = (
  bytes: Uint8Array,
  offset: number,
  width: 2 | 4 | 8,
  littleEndian: boolean,
  label: string,
): number => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const value =
    width === 2
      ? BigInt(view.getUint16(offset, littleEndian))
      : width === 4
        ? BigInt(view.getUint32(offset, littleEndian))
        : view.getBigUint64(offset, littleEndian)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw limitExceeded(`OME-TIFF probe ${label} exceeds the safe integer range`)
  }
  return Number(value)
}

const firstIfdOmeXml = async (
  source: ImageSource,
  signal: AbortSignal | undefined,
): Promise<boolean> => {
  if (source.size < 8) return false
  const header = await probeRead(source, 0, Math.min(source.size, 16), signal)
  if (!isTiffPrefix(header)) return false
  const littleEndian = header[0] === 0x49
  const version = unsigned(header, 2, 2, littleEndian, 'version')
  const bigTiff = version === 43
  if (bigTiff) {
    if (
      header.byteLength < 16 ||
      unsigned(header, 4, 2, littleEndian, 'offset width') !== 8 ||
      unsigned(header, 6, 2, littleEndian, 'reserved field') !== 0
    ) {
      throw invalidInput('OME-TIFF probe found an invalid BigTIFF header')
    }
  }
  const firstIfdOffset = unsigned(
    header,
    bigTiff ? 8 : 4,
    bigTiff ? 8 : 4,
    littleEndian,
    'first IFD offset',
  )
  const minimumIfdOffset = bigTiff ? 16 : 8
  if (firstIfdOffset < minimumIfdOffset) {
    throw invalidInput('OME-TIFF probe found an invalid first IFD offset')
  }
  const countWidth = bigTiff ? 8 : 2
  const entryBytes = bigTiff ? 20 : 12
  const inlineBytes = bigTiff ? 8 : 4
  const countBytes = await probeRead(source, firstIfdOffset, countWidth, signal)
  const entryCount = unsigned(countBytes, 0, countWidth, littleEndian, 'IFD entry count')
  if (entryCount > maximumProbeEntries) {
    throw limitExceeded(`OME-TIFF probe IFD entry count exceeds ${maximumProbeEntries}`)
  }
  const entriesPerRead = Math.floor(maximumProbeReadBytes / entryBytes)
  for (let firstEntry = 0; firstEntry < entryCount; firstEntry += entriesPerRead) {
    const count = Math.min(entriesPerRead, entryCount - firstEntry)
    const entries = await probeRead(
      source,
      firstIfdOffset + countWidth + firstEntry * entryBytes,
      count * entryBytes,
      signal,
    )
    for (let index = 0; index < count; index += 1) {
      const position = index * entryBytes
      const tag = unsigned(entries, position, 2, littleEndian, 'tag')
      if (tag !== imageDescriptionTag) continue
      const fieldType = unsigned(entries, position + 2, 2, littleEndian, 'field type')
      if (fieldType !== 2) return false
      const valueBytes = unsigned(
        entries,
        position + 4,
        bigTiff ? 8 : 4,
        littleEndian,
        'ImageDescription length',
      )
      if (valueBytes < 1) return false
      const prefixBytes = Math.min(valueBytes, maximumProbeReadBytes)
      const valuePosition = position + (bigTiff ? 12 : 8)
      const value =
        valueBytes <= inlineBytes
          ? entries.slice(valuePosition, valuePosition + valueBytes)
          : await probeRead(
              source,
              unsigned(
                entries,
                valuePosition,
                bigTiff ? 8 : 4,
                littleEndian,
                'ImageDescription offset',
              ),
              prefixBytes,
              signal,
            )
      return containsOmeXml(value)
    }
  }
  return false
}

export const omeTiffReader: ScientificReader = Object.freeze({
  descriptor: omeTiffReaderDescriptor,
  async probe(context: Readonly<ScientificOpenContext>) {
    throwIfAborted(context.signal)
    if (!(await firstIfdOmeXml(context.primary.source, context.signal))) {
      return Object.freeze({ confidence: 0, reason: 'OME-TIFF signature/XML is absent' })
    }
    const hinted = resourceHasHint(
      context.primary,
      omeTiffReaderDescriptor.extensions,
      omeTiffReaderDescriptor.mediaTypes,
    )
    return Object.freeze({
      confidence: hinted ? 1 : 0.99,
      reason: hinted ? 'OME-TIFF bytes and resource hint match' : 'OME-TIFF bytes match',
    })
  },
  async open(context: Readonly<ScientificOpenContext>): Promise<ScientificDocument> {
    throwIfAborted(context.signal)
    const tiff = await openTiffDocument(context.primary.source, {
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    })
    const imageCount = await omeTiffImageCount(tiff)
    const entries = await Promise.all(
      Array.from({ length: imageCount }, async (_, index) => {
        const legacy = await openOmeTiff(tiff, index)
        const levels = legacy.resolutionLevels.map(({ level, width, height }) =>
          Object.freeze({
            level,
            axisLengths: Object.freeze([
              { axisId: 'x', length: width },
              { axisId: 'y', length: height },
              { axisId: 'z', length: legacy.sizeZ },
              { axisId: 'channel', length: legacy.channels.length },
              { axisId: 'time', length: legacy.sizeT },
            ]),
          }),
        )
        const id = `image-${index}`
        const identity = await createScientificDatasetIdentity({
          reader: omeTiffReaderDescriptor,
          datasetId: id,
          resources: [context.primary],
        })
        const dataset = identifyScientificDataset(
          toScientificDataset(legacy, {
            levels,
            semanticSingletonAxes: ['z', 'channel', 'time'],
            calibrationEvidence: {
              x: {
                kind: 'embedded',
                resourceId: context.primary.id,
                locator: `ome:Image/${index}/Pixels@PhysicalSizeX`,
              },
              y: {
                kind: 'embedded',
                resourceId: context.primary.id,
                locator: `ome:Image/${index}/Pixels@PhysicalSizeY`,
              },
              z: {
                kind: 'embedded',
                resourceId: context.primary.id,
                locator: `ome:Image/${index}/Pixels@PhysicalSizeZ`,
              },
            },
          }),
          identity,
        )
        return Object.freeze({ id, dataset, identity })
      }),
    )
    return Object.freeze({
      reader: Object.freeze({
        id: omeTiffReaderDescriptor.id,
        version: omeTiffReaderDescriptor.version,
      }),
      format: omeTiffReaderDescriptor.format,
      metadata: Object.freeze({ imageCount }),
      datasets: Object.freeze(
        entries.map(({ id, dataset, identity }, index) =>
          Object.freeze({
            id,
            name: `OME Image ${index}`,
            descriptor: dataset.descriptor,
            identity,
          }),
        ),
      ),
      async openDataset(id: string, options?: Readonly<AbortOptions>) {
        throwIfAborted(options?.signal ?? context.signal)
        const entry = entries.find((candidate) => candidate.id === id)
        if (entry === undefined) throw invalidInput(`Unknown OME-TIFF dataset ${id}`)
        return entry.dataset
      },
    })
  },
})
