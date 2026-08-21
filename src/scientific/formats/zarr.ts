import type { ScientificCompanionResolver } from '../reader.ts'
import {
  createZarrStore as createGenericZarrStore,
  type ZarrStore,
  type ZarrStoreLimits,
  type ZarrStoreOptions,
} from '../../zarr/core.ts'

export * from '../../zarr/core.ts'

/** Compatibility adapter from scientific companion resolution to the generic Zarr object store. */
export const createZarrStore = (
  resolver: ScientificCompanionResolver,
  primaryName: string | undefined,
  limits: Readonly<ZarrStoreLimits>,
  format: 2 | 3 = 3,
  options: Readonly<ZarrStoreOptions> = {},
): ZarrStore =>
  createGenericZarrStore(
    Object.freeze({
      async resolve(relative: string, signal?: AbortSignal) {
        return resolver.resolve(
          { kind: 'relative-name', name: relative },
          signal === undefined ? {} : { signal },
        )
      },
    }),
    primaryName,
    limits,
    format,
    options,
  )
