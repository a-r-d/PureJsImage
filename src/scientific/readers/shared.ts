import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput } from '../../errors.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificDataset,
  ScientificMetadataObject,
  ScientificPlaneReadRequest,
} from '../dataset-v2.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificMetadataObject,
} from '../dataset-v2.ts'
import type {
  ScientificDocument,
  ScientificOpenContext,
  ScientificReaderDescriptor,
  ScientificResource,
} from '../reader.ts'
import { createScientificDatasetIdentity, identifyScientificDataset } from '../reader.ts'

export const resourceHasHint = (
  resource: Readonly<ScientificResource>,
  extensions: readonly string[],
  mediaTypes: readonly string[],
): boolean => {
  const name = resource.name?.toLowerCase()
  const extension = name === undefined ? undefined : name.match(/\.([a-z0-9+_-]+)$/u)?.[1]
  return (
    (extension !== undefined && extensions.includes(extension)) ||
    (resource.mediaType !== undefined && mediaTypes.includes(resource.mediaType.toLowerCase()))
  )
}

export const descriptorWithFormatMetadata = (
  dataset: ScientificDataset,
  key: string,
  formatMetadata: ScientificMetadataObject,
): ScientificDataset => {
  const metadata = normalizeScientificMetadataObject({
    ...(dataset.descriptor.metadata ?? {}),
    [key]: formatMetadata,
  })
  const descriptor: NormalizedScientificDatasetDescriptor = normalizeScientificDatasetDescriptor({
    ...dataset.descriptor,
    metadata,
  })
  return Object.freeze({
    descriptor,
    readPlane(request: Readonly<ScientificPlaneReadRequest>) {
      return dataset.readPlane(request)
    },
  })
}

interface SingleDatasetDocumentOptions {
  readonly context: Readonly<ScientificOpenContext>
  readonly reader: ScientificReaderDescriptor
  readonly metadata: ScientificMetadataObject
  readonly dataset: ScientificDataset
  readonly datasetId: string
  readonly datasetName?: string
  readonly resources?: readonly Pick<ScientificResource, 'id' | 'source'>[]
}

export const singleDatasetDocument = async (
  options: Readonly<SingleDatasetDocumentOptions>,
): Promise<ScientificDocument> => {
  const metadata = normalizeScientificMetadataObject(options.metadata)
  const identity = await createScientificDatasetIdentity({
    reader: options.reader,
    datasetId: options.datasetId,
    resources: options.resources ?? [options.context.primary],
  })
  const dataset = identifyScientificDataset(options.dataset, identity)
  const summary = Object.freeze({
    id: options.datasetId,
    ...(options.datasetName === undefined ? {} : { name: options.datasetName }),
    descriptor: dataset.descriptor,
    identity,
  })
  return Object.freeze({
    reader: Object.freeze({ id: options.reader.id, version: options.reader.version }),
    format: options.reader.format,
    metadata,
    datasets: Object.freeze([summary]),
    async openDataset(id: string, openOptions?: Readonly<AbortOptions>) {
      const signal = openOptions?.signal ?? options.context.signal
      throwIfAborted(signal)
      if (id !== options.datasetId) {
        throw invalidInput(`Unknown ${options.reader.format} dataset ${id}`)
      }
      return dataset
    },
  })
}
