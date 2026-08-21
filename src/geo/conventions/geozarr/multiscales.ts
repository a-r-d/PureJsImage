import type { GeoAffineTransform } from '../../contracts.ts'
import type { GeoZarrConventionMode, GeoZarrDiagnostic } from './diagnostics.ts'
import { geoZarrDiagnostic } from './diagnostics.ts'
import { geoZarrMultiscalesConvention } from './registry.ts'
import type { GeoZarrJsonObject, ResolvedGeoZarrConventionLimits } from './validation.ts'
import {
  geoZarrAffine,
  geoZarrFiniteArray,
  geoZarrModeSeverity,
  geoZarrPositiveIntegerPair,
  geoZarrString,
  geoZarrUnknownFields,
  isGeoZarrRecord,
  isSafeGeoZarrPath,
} from './validation.ts'

export interface GeoZarrMultiscaleTransform {
  readonly scale?: readonly number[]
  readonly translation?: readonly number[]
  readonly additional: GeoZarrJsonObject
}

export interface GeoZarrMultiscaleLayout {
  readonly order: number
  readonly asset: string
  readonly derivedFrom?: string
  readonly transform?: GeoZarrMultiscaleTransform
  readonly resamplingMethod?: string
  readonly spatialShape?: readonly [height: number, width: number]
  readonly spatialTransform?: GeoAffineTransform
  readonly additional: GeoZarrJsonObject
}

export interface GeoZarrMultiscalesMetadata {
  readonly layout: readonly GeoZarrMultiscaleLayout[]
  readonly resamplingMethod?: string
  readonly additional: GeoZarrJsonObject
}

export interface GeoZarrMultiscalesParseResult {
  readonly value?: GeoZarrMultiscalesMetadata
  readonly diagnostics: readonly GeoZarrDiagnostic[]
}

const multiscalesKeys = new Set(['layout', 'resampling_method'])
const layoutKeys = new Set([
  'asset',
  'derived_from',
  'transform',
  'resampling_method',
  'spatial:shape',
  'spatial:transform',
])
const transformKeys = new Set(['scale', 'translation'])

export const parseGeoZarrMultiscalesMetadata = (
  attributes: Readonly<Record<string, unknown>>,
  mode: GeoZarrConventionMode,
  limits: ResolvedGeoZarrConventionLimits,
  path: string,
  availablePaths: ReadonlySet<string> = new Set(),
): GeoZarrMultiscalesParseResult => {
  const diagnostics: GeoZarrDiagnostic[] = []
  const raw = attributes.multiscales
  if (raw === undefined) return Object.freeze({ diagnostics: Object.freeze([]) })
  if (!isGeoZarrRecord(raw) || !Array.isArray(raw.layout) || raw.layout.length === 0) {
    diagnostics.push(
      geoZarrDiagnostic(
        'error',
        'invalid-multiscales-metadata',
        'multiscales must be an object with a non-empty layout array',
        `${path}.multiscales`,
        geoZarrMultiscalesConvention.uuid,
      ),
    )
    return Object.freeze({ diagnostics: Object.freeze(diagnostics) })
  }
  if (raw.layout.length > limits.maxLevels) {
    diagnostics.push(
      geoZarrDiagnostic(
        'error',
        'metadata-limit-exceeded',
        'multiscales.layout exceeds maxLevels',
        `${path}.multiscales.layout`,
        geoZarrMultiscalesConvention.uuid,
      ),
    )
  }
  const layout: GeoZarrMultiscaleLayout[] = []
  const assets = new Set<string>()
  for (let index = 0; index < Math.min(raw.layout.length, limits.maxLevels); index += 1) {
    const entry = raw.layout[index]
    const entryPath = `${path}.multiscales.layout[${index}]`
    if (!isGeoZarrRecord(entry)) {
      diagnostics.push(
        geoZarrDiagnostic(
          'error',
          'invalid-multiscales-metadata',
          'Layout entry must be an object',
          entryPath,
          geoZarrMultiscalesConvention.uuid,
        ),
      )
      continue
    }
    const asset = geoZarrString(entry.asset)
    if (asset === undefined || !isSafeGeoZarrPath(asset)) {
      diagnostics.push(
        geoZarrDiagnostic(
          'error',
          'invalid-multiscales-metadata',
          'Layout asset must be a safe relative Zarr path',
          `${entryPath}.asset`,
          geoZarrMultiscalesConvention.uuid,
        ),
      )
      continue
    }
    if (assets.has(asset)) {
      diagnostics.push(
        geoZarrDiagnostic(
          'error',
          'duplicate-multiscale-path',
          `Layout asset ${asset} is duplicated`,
          `${entryPath}.asset`,
          geoZarrMultiscalesConvention.uuid,
        ),
      )
    }
    assets.add(asset)
    if (availablePaths.size > 0 && !availablePaths.has(asset)) {
      diagnostics.push(
        geoZarrDiagnostic(
          geoZarrModeSeverity(mode),
          'missing-multiscale-path',
          `Layout asset ${asset} is not present in the supplied hierarchy`,
          `${entryPath}.asset`,
          geoZarrMultiscalesConvention.uuid,
        ),
      )
    }
    const derivedFrom = geoZarrString(entry.derived_from)
    if (
      entry.derived_from !== undefined &&
      (derivedFrom === undefined || !isSafeGeoZarrPath(derivedFrom))
    ) {
      diagnostics.push(
        geoZarrDiagnostic(
          'error',
          'invalid-multiscales-metadata',
          'derived_from must be a safe relative Zarr path',
          `${entryPath}.derived_from`,
          geoZarrMultiscalesConvention.uuid,
        ),
      )
    }
    let transform: GeoZarrMultiscaleTransform | undefined
    if (entry.transform !== undefined) {
      if (!isGeoZarrRecord(entry.transform)) {
        diagnostics.push(
          geoZarrDiagnostic(
            'error',
            'invalid-multiscales-metadata',
            'Layout transform must be an object',
            `${entryPath}.transform`,
            geoZarrMultiscalesConvention.uuid,
          ),
        )
      } else {
        const scale =
          entry.transform.scale === undefined
            ? undefined
            : geoZarrFiniteArray(entry.transform.scale)
        const translation =
          entry.transform.translation === undefined
            ? undefined
            : geoZarrFiniteArray(entry.transform.translation)
        if (entry.transform.scale !== undefined && scale === undefined) {
          diagnostics.push(
            geoZarrDiagnostic(
              'error',
              'invalid-multiscales-metadata',
              'Relative scale must be a finite number array',
              `${entryPath}.transform.scale`,
              geoZarrMultiscalesConvention.uuid,
            ),
          )
        }
        if (entry.transform.translation !== undefined && translation === undefined) {
          diagnostics.push(
            geoZarrDiagnostic(
              'error',
              'invalid-multiscales-metadata',
              'Relative translation must be a finite number array',
              `${entryPath}.transform.translation`,
              geoZarrMultiscalesConvention.uuid,
            ),
          )
        }
        if (
          scale !== undefined &&
          translation !== undefined &&
          scale.length !== translation.length
        ) {
          diagnostics.push(
            geoZarrDiagnostic(
              'error',
              'invalid-multiscales-metadata',
              'Relative scale and translation lengths must agree',
              `${entryPath}.transform`,
              geoZarrMultiscalesConvention.uuid,
            ),
          )
        }
        let transformAdditional: GeoZarrJsonObject
        try {
          transformAdditional = geoZarrUnknownFields(
            entry.transform,
            transformKeys,
            `${entryPath}.transform.additional`,
            limits,
          )
        } catch (error) {
          transformAdditional = Object.freeze({})
          diagnostics.push(
            geoZarrDiagnostic(
              'error',
              'metadata-limit-exceeded',
              error instanceof Error ? error.message : 'Transform metadata exceeds limits',
              `${entryPath}.transform`,
              geoZarrMultiscalesConvention.uuid,
            ),
          )
        }
        transform = Object.freeze({
          ...(scale === undefined ? {} : { scale }),
          ...(translation === undefined ? {} : { translation }),
          additional: transformAdditional,
        })
      }
    }
    if (derivedFrom !== undefined && transform === undefined) {
      diagnostics.push(
        geoZarrDiagnostic(
          'error',
          'invalid-multiscales-metadata',
          'A derived layout level requires transform',
          entryPath,
          geoZarrMultiscalesConvention.uuid,
        ),
      )
    }
    const spatialShape = geoZarrPositiveIntegerPair(entry['spatial:shape'])
    if (entry['spatial:shape'] !== undefined && spatialShape === undefined) {
      diagnostics.push(
        geoZarrDiagnostic(
          'error',
          'invalid-multiscales-metadata',
          'Per-level spatial:shape must contain two positive integers',
          `${entryPath}.spatial:shape`,
          geoZarrMultiscalesConvention.uuid,
        ),
      )
    }
    const spatialTransform = geoZarrAffine(entry['spatial:transform'])
    if (entry['spatial:transform'] !== undefined && spatialTransform === undefined) {
      diagnostics.push(
        geoZarrDiagnostic(
          'error',
          'invalid-multiscales-metadata',
          'Per-level spatial:transform must contain six finite numbers',
          `${entryPath}.spatial:transform`,
          geoZarrMultiscalesConvention.uuid,
        ),
      )
    }
    let additional: GeoZarrJsonObject
    try {
      additional = geoZarrUnknownFields(entry, layoutKeys, `${entryPath}.additional`, limits)
    } catch (error) {
      additional = Object.freeze({})
      diagnostics.push(
        geoZarrDiagnostic(
          'error',
          'metadata-limit-exceeded',
          error instanceof Error ? error.message : 'Layout metadata exceeds limits',
          entryPath,
          geoZarrMultiscalesConvention.uuid,
        ),
      )
    }
    const resamplingMethod = geoZarrString(entry.resampling_method)
    if (entry.resampling_method !== undefined && resamplingMethod === undefined) {
      diagnostics.push(
        geoZarrDiagnostic(
          'error',
          'invalid-multiscales-metadata',
          'resampling_method must be a non-empty string',
          `${entryPath}.resampling_method`,
          geoZarrMultiscalesConvention.uuid,
        ),
      )
    }
    layout.push(
      Object.freeze({
        order: index,
        asset,
        ...(derivedFrom === undefined ? {} : { derivedFrom }),
        ...(transform === undefined ? {} : { transform }),
        ...(resamplingMethod === undefined ? {} : { resamplingMethod }),
        ...(spatialShape === undefined ? {} : { spatialShape }),
        ...(spatialTransform === undefined ? {} : { spatialTransform }),
        additional,
      }),
    )
  }
  for (const entry of layout) {
    if (entry.derivedFrom !== undefined && !assets.has(entry.derivedFrom)) {
      diagnostics.push(
        geoZarrDiagnostic(
          geoZarrModeSeverity(mode),
          'missing-derived-level',
          `Layout source ${entry.derivedFrom} is not another declared level`,
          `${path}.multiscales.layout[${entry.order}].derived_from`,
          geoZarrMultiscalesConvention.uuid,
        ),
      )
    }
  }
  const resamplingMethod = geoZarrString(raw.resampling_method)
  if (raw.resampling_method !== undefined && resamplingMethod === undefined) {
    diagnostics.push(
      geoZarrDiagnostic(
        'error',
        'invalid-multiscales-metadata',
        'multiscales.resampling_method must be a non-empty string',
        `${path}.multiscales.resampling_method`,
        geoZarrMultiscalesConvention.uuid,
      ),
    )
  }
  let additional: GeoZarrJsonObject
  try {
    additional = geoZarrUnknownFields(
      raw,
      multiscalesKeys,
      `${path}.multiscales.additional`,
      limits,
    )
  } catch (error) {
    additional = Object.freeze({})
    diagnostics.push(
      geoZarrDiagnostic(
        'error',
        'metadata-limit-exceeded',
        error instanceof Error ? error.message : 'Multiscales metadata exceeds limits',
        `${path}.multiscales`,
        geoZarrMultiscalesConvention.uuid,
      ),
    )
  }
  return Object.freeze({
    value: Object.freeze({
      layout: Object.freeze(layout),
      ...(resamplingMethod === undefined ? {} : { resamplingMethod }),
      additional,
    }),
    diagnostics: Object.freeze(diagnostics),
  })
}
