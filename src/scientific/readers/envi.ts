import { throwIfAborted } from '../../abort.ts'
import { invalidInput } from '../../errors.ts'
import { normalizeScientificMetadataObject } from '../dataset-v2.ts'
import { toScientificDataset } from '../dataset-adapters.ts'
import { openEnvi } from '../formats/envi.ts'
import type {
  ScientificDocument,
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
} from '../reader.ts'
import { descriptorWithFormatMetadata, resourceHasHint, singleDatasetDocument } from './shared.ts'

const enviProbeBytes = 1_024

export const enviReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/envi',
  version: '1.0.0',
  format: 'ENVI',
  extensions: Object.freeze(['hdr', 'img', 'dat', 'raw']),
  mediaTypes: Object.freeze(['application/x-envi']),
  capabilities: Object.freeze({ resources: 'header-data-pair', datasets: 'single', axes: 'xyc' }),
})

const isEnviHeader = (bytes: Uint8Array): boolean => {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return false
  }
  return /^(?:\uFEFF)?\s*ENVI(?:\r?\n|\r)/u.test(text)
}

const stem = (name: string): string => {
  const slash = name.lastIndexOf('/')
  const directory = slash < 0 ? '' : name.slice(0, slash + 1)
  const leaf = slash < 0 ? name : name.slice(slash + 1)
  const dot = leaf.lastIndexOf('.')
  return `${directory}${dot > 0 ? leaf.slice(0, dot) : leaf}`
}

const resolvePair = async (context: Readonly<ScientificOpenContext>, primaryProbe?: Uint8Array) => {
  const probe =
    primaryProbe ??
    (await context.primary.source.read(0, Math.min(enviProbeBytes, context.primary.source.size), {
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    }))
  const headerPrimary = isEnviHeader(probe)
  const primaryName = context.primary.name
  if (context.companions === undefined) {
    throw invalidInput('ENVI requires a companion resolver for its header/data pair')
  }
  if (headerPrimary) {
    const data = await context.companions.resolve(
      {
        kind: 'role',
        role: 'data',
        ...(primaryName?.toLowerCase().endsWith('.hdr') === true
          ? { relativeName: primaryName.slice(0, -4) }
          : {}),
      },
      { ...(context.signal === undefined ? {} : { signal: context.signal }) },
    )
    if (data === undefined) throw invalidInput('ENVI binary companion is missing')
    return Object.freeze({ header: context.primary, data })
  }
  if (primaryName === undefined) {
    throw invalidInput('ENVI data-primary opening requires a primary resource name')
  }
  const header = await context.companions.resolve(
    { kind: 'role', role: 'header', relativeName: `${stem(primaryName)}.hdr` },
    { ...(context.signal === undefined ? {} : { signal: context.signal }) },
  )
  if (header === undefined) throw invalidInput('ENVI header companion is missing')
  const headerProbe = await header.source.read(0, Math.min(enviProbeBytes, header.source.size), {
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  })
  if (!isEnviHeader(headerProbe)) throw invalidInput('Resolved ENVI header companion is invalid')
  return Object.freeze({ header, data: context.primary })
}

const mapInfoMetadata = (raw: string | undefined): readonly (string | number)[] | undefined => {
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  const content = trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed.slice(1, -1) : trimmed
  return Object.freeze(
    content.split(',').map((entry) => {
      const value = entry.trim()
      const numeric = Number(value)
      return value.length > 0 && Number.isFinite(numeric) ? numeric : value
    }),
  )
}

export const enviReader: ScientificReader = Object.freeze({
  descriptor: enviReaderDescriptor,
  async probe(context: Readonly<ScientificOpenContext>) {
    throwIfAborted(context.signal)
    const primaryProbe = await context.primary.source.read(
      0,
      Math.min(enviProbeBytes, context.primary.source.size),
      { ...(context.signal === undefined ? {} : { signal: context.signal }) },
    )
    const headerPrimary = isEnviHeader(primaryProbe)
    if (context.companions === undefined) {
      if (headerPrimary) {
        throw invalidInput('ENVI header is missing its binary companion resolver')
      }
      return Object.freeze({ confidence: 0, reason: 'ENVI header/data pairing is unavailable' })
    }
    if (headerPrimary) {
      const dataName = context.primary.name?.toLowerCase().endsWith('.hdr')
        ? context.primary.name.slice(0, -4)
        : undefined
      const data = await context.companions.resolve(
        {
          kind: 'role',
          role: 'data',
          ...(dataName === undefined ? {} : { relativeName: dataName }),
        },
        { ...(context.signal === undefined ? {} : { signal: context.signal }) },
      )
      if (data === undefined) throw invalidInput('ENVI binary companion is missing')
    } else {
      const primaryName = context.primary.name
      if (primaryName === undefined) {
        return Object.freeze({ confidence: 0, reason: 'ENVI data primary has no resolvable name' })
      }
      const header = await context.companions.resolve(
        { kind: 'role', role: 'header', relativeName: `${stem(primaryName)}.hdr` },
        { ...(context.signal === undefined ? {} : { signal: context.signal }) },
      )
      if (header === undefined) {
        return Object.freeze({ confidence: 0, reason: 'ENVI header companion is absent' })
      }
      const headerProbe = await header.source.read(
        0,
        Math.min(enviProbeBytes, header.source.size),
        { ...(context.signal === undefined ? {} : { signal: context.signal }) },
      )
      if (!isEnviHeader(headerProbe)) {
        return Object.freeze({ confidence: 0, reason: 'Resolved companion is not an ENVI header' })
      }
    }
    const hinted = resourceHasHint(
      context.primary,
      enviReaderDescriptor.extensions,
      enviReaderDescriptor.mediaTypes,
    )
    return Object.freeze({
      confidence: hinted ? 1 : 0.99,
      reason: headerPrimary
        ? 'ENVI header and data companion match'
        : 'ENVI header companion matches',
    })
  },
  async open(context: Readonly<ScientificOpenContext>): Promise<ScientificDocument> {
    throwIfAborted(context.signal)
    const pair = await resolvePair(context)
    const legacy = await openEnvi({ header: pair.header.source, data: pair.data.source })
    const mapInfo = mapInfoMetadata(legacy.metadata['map info'])
    const formatMetadata = normalizeScientificMetadataObject({
      dataType: legacy.dataType,
      interleave: legacy.interleave,
      byteOrder: legacy.byteOrder,
      headerOffset: legacy.headerOffset,
      fileType: legacy.fileType,
      ...(legacy.description === undefined ? {} : { description: legacy.description }),
      ...(legacy.sensorType === undefined ? {} : { sensorType: legacy.sensorType }),
      ...(legacy.defaultBands === undefined ? {} : { defaultBands: legacy.defaultBands }),
      ...(legacy.classes === undefined ? {} : { classes: legacy.classes }),
      ...(mapInfo === undefined ? {} : { mapInfo }),
      fields: legacy.metadata,
    })
    const dataset = descriptorWithFormatMetadata(
      toScientificDataset(legacy),
      'purejsimage:envi',
      formatMetadata,
    )
    return singleDatasetDocument({
      context,
      reader: enviReaderDescriptor,
      metadata: formatMetadata,
      dataset,
      datasetId: 'raster',
      datasetName: legacy.description ?? 'ENVI raster',
    })
  },
})
