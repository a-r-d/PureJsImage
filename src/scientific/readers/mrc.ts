import { throwIfAborted } from '../../abort.ts'
import type { RasterBlock } from '../../raster.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificDataset,
  ScientificPlaneReadRequest,
} from '../dataset.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificMetadataObject,
  normalizeScientificPlaneReadRequest,
} from '../dataset.ts'
import { toScientificDataset } from '../dataset-adapters.ts'
import { openMrc, type MrcDataset } from '../formats/mrc.ts'
import type {
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
} from '../reader.ts'
import { descriptorWithFormatMetadata, resourceHasHint, singleDatasetDocument } from './shared.ts'

const mrcProbeOffset = 208
const mrcProbeBytes = 8

export const mrcReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/mrc',
  version: '1.0.0',
  format: 'MRC/CCP4',
  extensions: Object.freeze(['mrc', 'map', 'ccp4']),
  mediaTypes: Object.freeze(['application/x-mrc', 'application/x-ccp4']),
  capabilities: Object.freeze({ resources: 'single', datasets: 'single', axes: 'xyz' }),
})

const supportedMachineStamp = (bytes: Uint8Array): boolean =>
  bytes[6] === 0 &&
  bytes[7] === 0 &&
  ((bytes[4] === 0x44 && (bytes[5] === 0x44 || bytes[5] === 0x41)) ||
    (bytes[4] === 0x11 && bytes[5] === 0x11))

const fixedIndex = (
  request: ReturnType<typeof normalizeScientificPlaneReadRequest>,
  axisId: string,
): number => request.fixedIndices.find((entry) => entry.axisId === axisId)?.index ?? 0

class MrcScientificDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #source: MrcDataset

  constructor(source: MrcDataset) {
    this.#source = source
    const adapted = toScientificDataset(source, { semanticSingletonAxes: ['z'] })
    this.descriptor = normalizeScientificDatasetDescriptor({
      ...adapted.descriptor,
      capabilities: {
        regionReads: true,
        resolutionLevels: false,
        planeReads: {
          kind: 'ordered-axis-pairs',
          pairs: [
            ['x', 'y'],
            ['x', 'z'],
            ['y', 'z'],
          ],
        },
      },
    })
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    const normalized = normalizeScientificPlaneReadRequest(this.descriptor, request)
    const [horizontal, vertical] = normalized.displayAxes
    if (horizontal === 'x' && vertical === 'y') {
      yield* this.#source.readPlane({
        z: fixedIndex(normalized, 'z'),
        c: 0,
        t: 0,
        resolutionLevel: 0,
        x: normalized.x,
        y: normalized.y,
        width: normalized.width,
        height: normalized.height,
        ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
      })
      return
    }
    const fixed = fixedIndex(normalized, horizontal === 'x' ? 'y' : 'x')
    for (let localZ = 0; localZ < normalized.height; localZ += 1) {
      const z = normalized.y + localZ
      for await (const block of this.#source.readPlane({
        z,
        c: 0,
        t: 0,
        resolutionLevel: 0,
        x: horizontal === 'x' ? normalized.x : fixed,
        y: horizontal === 'x' ? fixed : normalized.x,
        width: horizontal === 'x' ? normalized.width : 1,
        height: horizontal === 'x' ? 1 : normalized.width,
        ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
      })) {
        yield horizontal === 'x'
          ? Object.freeze({ ...block, y: z })
          : Object.freeze({
              x: block.y,
              y: z,
              width: block.height,
              height: 1,
              stride: block.data.byteLength,
              format: block.format,
              data: block.data,
            })
      }
    }
  }
}

export const mrcReader: ScientificReader = Object.freeze({
  descriptor: mrcReaderDescriptor,
  async probe(context: Readonly<ScientificOpenContext>) {
    throwIfAborted(context.signal)
    const signature = await context.primary.source.read(mrcProbeOffset, mrcProbeBytes, {
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    })
    const matches =
      signature.byteLength === mrcProbeBytes &&
      signature[0] === 0x4d &&
      signature[1] === 0x41 &&
      signature[2] === 0x50 &&
      signature[3] === 0x20 &&
      supportedMachineStamp(signature)
    if (!matches) return Object.freeze({ confidence: 0, reason: 'MRC signature is absent' })
    const hinted = resourceHasHint(
      context.primary,
      mrcReaderDescriptor.extensions,
      mrcReaderDescriptor.mediaTypes,
    )
    return Object.freeze({
      confidence: hinted ? 1 : 0.99,
      reason: hinted ? 'MRC signature and resource hint match' : 'MRC signature matches',
    })
  },
  async open(context: Readonly<ScientificOpenContext>) {
    throwIfAborted(context.signal)
    const legacy = await openMrc(context.primary.source)
    throwIfAborted(context.signal)
    const formatMetadata = normalizeScientificMetadataObject({
      byteOrder: legacy.byteOrder,
      mode: legacy.mode,
      header: legacy.header,
    })
    const dataset = descriptorWithFormatMetadata(
      new MrcScientificDataset(legacy),
      'purejsimage:mrc',
      formatMetadata,
    )
    return singleDatasetDocument({
      context,
      reader: mrcReaderDescriptor,
      metadata: formatMetadata,
      dataset,
      datasetId: 'volume',
      datasetName: 'Volume',
    })
  },
})
