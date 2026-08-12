import type {
  ScientificDocument,
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
} from './reader.ts'
import { ScientificReaderRegistry } from './reader.ts'

export interface ScientificResourcePattern {
  readonly readerId: string
  readonly readerVersion: string
  readonly extensions: readonly string[]
  readonly mediaTypes: readonly string[]
}

export interface ScientificLibraryCapabilities {
  readonly readers: readonly ScientificReaderDescriptor[]
  readonly resourcePatterns: readonly ScientificResourcePattern[]
}

export interface ScientificLibrary {
  open(context: Readonly<ScientificOpenContext>): Promise<ScientificDocument>
  capabilities(): ScientificLibraryCapabilities
}

export interface ScientificLibraryOptions {
  readonly readers: Iterable<ScientificReader>
}

/** Build an isolated scientific library from an explicit iterable of trusted readers. */
export const createScientificLibrary = (
  options: Readonly<ScientificLibraryOptions>,
): ScientificLibrary => {
  const registry = new ScientificReaderRegistry(options.readers)
  const capabilities: ScientificLibraryCapabilities = Object.freeze({
    readers: registry.descriptors,
    resourcePatterns: Object.freeze(
      registry.descriptors.map((descriptor) =>
        Object.freeze({
          readerId: descriptor.id,
          readerVersion: descriptor.version,
          extensions: descriptor.extensions,
          mediaTypes: descriptor.mediaTypes,
        }),
      ),
    ),
  })
  return Object.freeze({
    open: (context: Readonly<ScientificOpenContext>) => registry.open(context),
    capabilities: () => capabilities,
  })
}
