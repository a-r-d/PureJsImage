import { throwIfAborted } from '../../abort.ts'
import { normalizeScientificMetadataObject } from '../dataset-v2.ts'
import { toScientificDataset } from '../dataset-adapters.ts'
import { openCbf } from '../formats/cbf.ts'
import type {
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
} from '../reader.ts'
import { descriptorWithFormatMetadata, resourceHasHint, singleDatasetDocument } from './shared.ts'

const cbfProbeBytes = 64

export const cbfReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/cbf',
  version: '1.0.0',
  format: 'CBF/imgCIF',
  extensions: Object.freeze(['cbf']),
  mediaTypes: Object.freeze(['application/x-cbf']),
  capabilities: Object.freeze({ resources: 'single', datasets: 'single', axes: 'xy' }),
})

const hasCbfIdentification = (bytes: Uint8Array): boolean => {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return false
  }
  return /^\uFEFF?###CBF:/u.test(text.trimStart())
}

export const cbfReader: ScientificReader = Object.freeze({
  descriptor: cbfReaderDescriptor,
  async probe(context: Readonly<ScientificOpenContext>) {
    throwIfAborted(context.signal)
    const prefix = await context.primary.source.read(
      0,
      Math.min(cbfProbeBytes, context.primary.source.size),
      { ...(context.signal === undefined ? {} : { signal: context.signal }) },
    )
    if (!hasCbfIdentification(prefix)) {
      return Object.freeze({ confidence: 0, reason: 'CBF identification line is absent' })
    }
    const hinted = resourceHasHint(
      context.primary,
      cbfReaderDescriptor.extensions,
      cbfReaderDescriptor.mediaTypes,
    )
    return Object.freeze({
      confidence: hinted ? 1 : 0.99,
      reason: hinted ? 'CBF identification and resource hint match' : 'CBF identification matches',
    })
  },
  async open(context: Readonly<ScientificOpenContext>) {
    throwIfAborted(context.signal)
    const legacy = await openCbf(context.primary.source)
    throwIfAborted(context.signal)
    const formatMetadata = normalizeScientificMetadataObject({
      encoding: legacy.encoding,
      elementType: legacy.elementType,
      binarySectionOffset: legacy.binarySectionOffset,
      binarySectionBytes: legacy.binarySectionBytes,
      detector: legacy.detector,
      cif: legacy.metadata,
    })
    const dataset = descriptorWithFormatMetadata(
      toScientificDataset(legacy),
      'purejsimage:cbf',
      formatMetadata,
    )
    return singleDatasetDocument({
      context,
      reader: cbfReaderDescriptor,
      metadata: formatMetadata,
      dataset,
      datasetId: 'detector-frame',
      datasetName: 'Detector frame',
    })
  },
})
