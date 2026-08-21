import type { AbortOptions } from '../../abort.ts'
import type {
  ScientificOpenContext,
  ScientificProbeResult,
  ScientificReaderDescriptor,
} from '../../scientific/reader.ts'
import type {
  GeoDiagnostic,
  GeoRasterDataset,
  GeoRasterDescriptor,
  GeoMetadataObject,
} from '../contracts.ts'

export interface GeoRasterDatasetSummary {
  readonly id: string
  readonly name?: string
  readonly descriptor: GeoRasterDescriptor
  readonly diagnostics: readonly GeoDiagnostic[]
}

export interface GeoRasterDocument {
  readonly reader: { readonly id: string; readonly version: string }
  readonly format: string
  readonly metadata: GeoMetadataObject
  readonly datasets: readonly GeoRasterDatasetSummary[]
  openDataset(id: string, options?: Readonly<AbortOptions>): Promise<GeoRasterDataset>
  close?(): void | Promise<void>
}

/** A format adapter over the existing lazy scientific dataset lifecycle and bounded tile engine. */
export interface GeoRasterReader {
  readonly descriptor: ScientificReaderDescriptor
  probe(context: Readonly<ScientificOpenContext>): Promise<ScientificProbeResult>
  open(context: Readonly<ScientificOpenContext>): Promise<GeoRasterDocument>
}
