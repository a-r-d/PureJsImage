import { throwIfAborted } from '../../abort.ts'
import { normalizeScientificMetadataObject } from '../dataset-v2.ts'
import { toScientificDataset } from '../dataset-adapters.ts'
import { openGsf } from '../formats/gsf.ts'
import type {
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
} from '../reader.ts'
import { descriptorWithFormatMetadata, resourceHasHint, singleDatasetDocument } from './shared.ts'

const gsfMagic = new TextEncoder().encode('Gwyddion Simple Field 1.0\n')

export const gsfReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/gsf',
  version: '1.0.0',
  format: 'Gwyddion Simple Field',
  extensions: Object.freeze(['gsf']),
  mediaTypes: Object.freeze(['application/x-gwyddion-spm']),
  capabilities: Object.freeze({ resources: 'single', datasets: 'single', axes: 'xy' }),
})

export const gsfReader: ScientificReader = Object.freeze({
  descriptor: gsfReaderDescriptor,
  async probe(context: Readonly<ScientificOpenContext>) {
    throwIfAborted(context.signal)
    const prefix = await context.primary.source.read(0, gsfMagic.byteLength, {
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    })
    if (
      prefix.byteLength !== gsfMagic.byteLength ||
      prefix.some((byte, index) => byte !== gsfMagic[index])
    ) {
      return Object.freeze({ confidence: 0, reason: 'GSF magic line is absent' })
    }
    const hinted = resourceHasHint(
      context.primary,
      gsfReaderDescriptor.extensions,
      gsfReaderDescriptor.mediaTypes,
    )
    return Object.freeze({
      confidence: hinted ? 1 : 0.99,
      reason: hinted ? 'GSF magic line and resource hint match' : 'GSF magic line matches',
    })
  },
  async open(context: Readonly<ScientificOpenContext>) {
    throwIfAborted(context.signal)
    const legacy = await openGsf(context.primary.source)
    throwIfAborted(context.signal)
    const formatMetadata = normalizeScientificMetadataObject({
      dataOffset: legacy.dataOffset,
      width: legacy.sizeX,
      height: legacy.sizeY,
      fields: legacy.metadata,
    })
    const dataset = descriptorWithFormatMetadata(
      toScientificDataset(legacy),
      'purejsimage:gsf',
      formatMetadata,
    )
    return singleDatasetDocument({
      context,
      reader: gsfReaderDescriptor,
      metadata: formatMetadata,
      dataset,
      datasetId: 'surface',
      datasetName: legacy.channels[0]?.name ?? 'Surface',
    })
  },
})
