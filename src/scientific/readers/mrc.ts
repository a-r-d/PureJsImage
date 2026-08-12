import { throwIfAborted } from '../../abort.ts'
import { normalizeScientificMetadataObject } from '../dataset-v2.ts'
import { toScientificDataset } from '../dataset-adapters.ts'
import { openMrc } from '../formats/mrc.ts'
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
      toScientificDataset(legacy),
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
