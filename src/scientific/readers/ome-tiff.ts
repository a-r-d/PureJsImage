import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput } from '../../errors.ts'
import { openTiffDocument } from '../../codecs/tiff.ts'
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

const tiffProbeBytes = 16_384

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

export const omeTiffReader: ScientificReader = Object.freeze({
  descriptor: omeTiffReaderDescriptor,
  async probe(context: Readonly<ScientificOpenContext>) {
    throwIfAborted(context.signal)
    const prefix = await context.primary.source.read(
      0,
      Math.min(tiffProbeBytes, context.primary.source.size),
      { ...(context.signal === undefined ? {} : { signal: context.signal }) },
    )
    if (!isTiffPrefix(prefix) || !containsOmeXml(prefix)) {
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
