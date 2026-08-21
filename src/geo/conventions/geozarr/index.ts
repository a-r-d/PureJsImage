import type { GeoSpatialReference } from '../../contracts.ts'
import type { GeoZarrConventionMode, GeoZarrDiagnostic } from './diagnostics.ts'
import { geoZarrDiagnostic, rejectGeoZarrErrors } from './diagnostics.ts'
import { inheritGeoZarrAttributes } from './inheritance.ts'
import type { GeoZarrMultiscaleLayout, GeoZarrMultiscalesMetadata } from './multiscales.ts'
import { parseGeoZarrMultiscalesMetadata } from './multiscales.ts'
import type { GeoZarrProjMetadata } from './proj.ts'
import { parseGeoZarrProjMetadata } from './proj.ts'
import type { GeoZarrConventionRegistration } from './registry.ts'
import { hasKnownGeoZarrConvention, parseGeoZarrConventionRegistrations } from './registry.ts'
import type { GeoZarrSpatialMetadata } from './spatial.ts'
import { parseGeoZarrSpatialMetadata } from './spatial.ts'
import type {
  GeoZarrConventionLimits,
  GeoZarrJsonObject,
  ResolvedGeoZarrConventionLimits,
} from './validation.ts'
import {
  isGeoZarrRecord,
  normalizeGeoZarrJsonObject,
  resolveGeoZarrConventionLimits,
} from './validation.ts'

export type {
  GeoZarrConventionMode,
  GeoZarrDiagnostic,
  GeoZarrDiagnosticCode,
} from './diagnostics.ts'
export { GeoZarrConventionError } from './diagnostics.ts'
export type {
  GeoZarrMultiscaleLayout,
  GeoZarrMultiscalesMetadata,
  GeoZarrMultiscaleTransform,
} from './multiscales.ts'
export type { GeoZarrProjMetadata } from './proj.ts'
export type {
  GeoZarrConventionDefinition,
  GeoZarrConventionRegistration,
  GeoZarrConventionVersionEvidence,
  GeoZarrConventionVersionStatus,
  GeoZarrKnownConventionName,
} from './registry.ts'
export {
  geoZarrConventionRegistry,
  geoZarrMultiscalesConvention,
  geoZarrProjConvention,
  geoZarrSpatialConvention,
} from './registry.ts'
export type { GeoZarrSpatialMetadata } from './spatial.ts'
export type {
  GeoZarrConventionLimits,
  GeoZarrJsonObject,
  GeoZarrJsonPrimitive,
  GeoZarrJsonValue,
  ResolvedGeoZarrConventionLimits,
} from './validation.ts'
export { defaultGeoZarrConventionLimits, resolveGeoZarrConventionLimits } from './validation.ts'

export interface GeoZarrConventionNodeSource {
  readonly zarrFormat: 2 | 3
  readonly nodeType: 'group' | 'array'
  readonly path: string
  /** v2 `.zattrs` content, or the complete v3 `zarr.json` object. */
  readonly metadata: unknown
  /** Required for array shape validation when it is not in the supplied v3 metadata. */
  readonly shape?: readonly number[]
  /** v2 callers may supply the extracted dimension names explicitly. */
  readonly dimensionNames?: readonly (string | null)[]
}

export interface GeoZarrConventionNode {
  readonly zarrFormat: 2 | 3
  readonly nodeType: 'group' | 'array'
  readonly path: string
  readonly attributes: GeoZarrJsonObject
  readonly shape?: readonly number[]
  readonly dimensionNames?: readonly (string | null)[]
}

export interface GeoZarrConventionParseOptions {
  readonly mode?: GeoZarrConventionMode
  readonly limits?: Readonly<GeoZarrConventionLimits>
}

export interface GeoZarrConventionMetadataInput {
  readonly group: GeoZarrConventionNodeSource
  readonly children?: readonly GeoZarrConventionNodeSource[]
  /** Optional hierarchy paths when layout assets include groups that are not otherwise parsed. */
  readonly availablePaths?: readonly string[]
}

export interface GeoZarrNormalizedNodeMetadata {
  readonly node: GeoZarrConventionNode
  readonly registrations: readonly GeoZarrConventionRegistration[]
  readonly proj?: GeoZarrProjMetadata
  readonly spatial?: GeoZarrSpatialMetadata
}

export interface GeoZarrNormalizedLevel {
  readonly order: number
  readonly asset: string
  readonly derivedFrom?: string
  readonly relativeScale?: readonly number[]
  readonly relativeTranslation?: readonly number[]
  readonly resamplingMethod?: string
  readonly node?: GeoZarrConventionNode
  readonly proj?: GeoZarrProjMetadata
  readonly spatial?: GeoZarrSpatialMetadata
  readonly layout: GeoZarrMultiscaleLayout
}

export interface GeoZarrConventionMetadata {
  readonly schemaVersion: 1
  readonly mode: GeoZarrConventionMode
  readonly group: GeoZarrNormalizedNodeMetadata
  readonly children: readonly GeoZarrNormalizedNodeMetadata[]
  readonly registrations: readonly GeoZarrConventionRegistration[]
  readonly multiscales?: GeoZarrMultiscalesMetadata
  readonly levels: readonly GeoZarrNormalizedLevel[]
  readonly crs?: GeoSpatialReference
  readonly unresolvedConflicts: readonly GeoZarrDiagnostic[]
  readonly diagnostics: readonly GeoZarrDiagnostic[]
}

const dimensionNamesFrom = (value: unknown): readonly (string | null)[] | undefined => {
  if (!Array.isArray(value)) return undefined
  if (
    !value.every((entry): entry is string | null => entry === null || typeof entry === 'string')
  ) {
    return undefined
  }
  return Object.freeze([...value])
}

const shapeFrom = (value: unknown): readonly number[] | undefined => {
  if (!Array.isArray(value)) return undefined
  if (!value.every((entry): entry is number => Number.isSafeInteger(entry) && entry > 0))
    return undefined
  return Object.freeze([...value])
}

export const extractGeoZarrConventionNode = (
  source: Readonly<GeoZarrConventionNodeSource>,
  limits: ResolvedGeoZarrConventionLimits = resolveGeoZarrConventionLimits(),
): GeoZarrConventionNode => {
  if (!isGeoZarrRecord(source.metadata)) {
    throw new TypeError(`GeoZarr metadata at ${source.path} must be a JSON object`)
  }
  let attributesValue: unknown
  let shape = source.shape
  let dimensionNames = source.dimensionNames
  if (source.zarrFormat === 3) {
    if (source.metadata.zarr_format !== 3 || source.metadata.node_type !== source.nodeType) {
      throw new TypeError(`GeoZarr v3 metadata at ${source.path} has inconsistent node identity`)
    }
    attributesValue = source.metadata.attributes
    shape ??= shapeFrom(source.metadata.shape)
    dimensionNames ??= dimensionNamesFrom(source.metadata.dimension_names)
  } else {
    const { _ARRAY_DIMENSIONS: _dimensionNames, ...v2Attributes } = source.metadata
    attributesValue = v2Attributes
    dimensionNames ??= dimensionNamesFrom(source.metadata._ARRAY_DIMENSIONS)
  }
  const attributes = normalizeGeoZarrJsonObject(
    attributesValue,
    `${source.path || '<root>'}.attributes`,
    limits,
  )
  if (source.nodeType === 'array') {
    if (
      shape !== undefined &&
      dimensionNames !== undefined &&
      shape.length !== dimensionNames.length
    ) {
      throw new TypeError(`GeoZarr array shape and dimension names disagree at ${source.path}`)
    }
  } else if (shape !== undefined || dimensionNames !== undefined) {
    throw new TypeError(`GeoZarr group ${source.path} must not declare array shape or dimensions`)
  }
  return Object.freeze({
    zarrFormat: source.zarrFormat,
    nodeType: source.nodeType,
    path: source.path,
    attributes,
    ...(shape === undefined ? {} : { shape: Object.freeze([...shape]) }),
    ...(dimensionNames === undefined ? {} : { dimensionNames: Object.freeze([...dimensionNames]) }),
  })
}

const metadataForNode = (
  node: GeoZarrConventionNode,
  inheritedProj: Readonly<Record<string, unknown>>,
  inheritedSpatial: Readonly<Record<string, unknown>>,
  mode: GeoZarrConventionMode,
  limits: ResolvedGeoZarrConventionLimits,
  diagnostics: GeoZarrDiagnostic[],
): GeoZarrNormalizedNodeMetadata => {
  const registration = parseGeoZarrConventionRegistrations(
    node.attributes,
    mode,
    limits,
    `${node.path || '<root>'}.attributes.zarr_conventions`,
  )
  diagnostics.push(...registration.diagnostics)
  const proj = parseGeoZarrProjMetadata(
    inheritedProj,
    mode,
    limits,
    `${node.path || '<root>'}.attributes`,
  )
  const spatial = parseGeoZarrSpatialMetadata(
    inheritedSpatial,
    {
      path: `${node.path || '<root>'}.attributes`,
      nodeType: node.nodeType,
      ...(node.shape === undefined ? {} : { shape: node.shape }),
      ...(node.dimensionNames === undefined ? {} : { dimensionNames: node.dimensionNames }),
    },
    mode,
    limits,
  )
  diagnostics.push(...proj.diagnostics, ...spatial.diagnostics)
  return Object.freeze({
    node,
    registrations: registration.registrations,
    ...(proj.value === undefined ? {} : { proj: proj.value }),
    ...(spatial.value === undefined ? {} : { spatial: spatial.value }),
  })
}

const layoutSpatialAttributes = (
  layout: GeoZarrMultiscaleLayout,
): Readonly<Record<string, unknown>> =>
  Object.freeze({
    ...(layout.spatialShape === undefined ? {} : { 'spatial:shape': layout.spatialShape }),
    ...(layout.spatialTransform === undefined
      ? {}
      : { 'spatial:transform': layout.spatialTransform }),
  })

export const parseGeoZarrConventionMetadata = (
  input: Readonly<GeoZarrConventionMetadataInput>,
  options: Readonly<GeoZarrConventionParseOptions> = {},
): GeoZarrConventionMetadata => {
  const mode = options.mode ?? 'strict'
  const limits = resolveGeoZarrConventionLimits(options.limits)
  const diagnostics: GeoZarrDiagnostic[] = []
  const group = extractGeoZarrConventionNode(input.group, limits)
  if (group.nodeType !== 'group')
    throw new TypeError('GeoZarr convention composition requires a group root')
  const children = Object.freeze(
    (input.children ?? []).map((source) => extractGeoZarrConventionNode(source, limits)),
  )
  const pathSet = new Set([...(input.availablePaths ?? []), ...children.map((entry) => entry.path)])
  const groupRegistrations = parseGeoZarrConventionRegistrations(
    group.attributes,
    mode,
    limits,
    `${group.path || '<root>'}.attributes.zarr_conventions`,
  )
  diagnostics.push(...groupRegistrations.diagnostics)
  const groupProj = parseGeoZarrProjMetadata(
    group.attributes,
    mode,
    limits,
    `${group.path || '<root>'}.attributes`,
  )
  const groupSpatial = parseGeoZarrSpatialMetadata(
    group.attributes,
    { path: `${group.path || '<root>'}.attributes`, nodeType: 'group' },
    mode,
    limits,
  )
  const multiscales = parseGeoZarrMultiscalesMetadata(
    group.attributes,
    mode,
    limits,
    `${group.path || '<root>'}.attributes`,
    pathSet,
  )
  diagnostics.push(
    ...groupProj.diagnostics,
    ...groupSpatial.diagnostics,
    ...multiscales.diagnostics,
  )
  for (const name of ['proj', 'spatial', 'multiscales'] as const) {
    const fieldPresent =
      name === 'multiscales'
        ? group.attributes.multiscales !== undefined
        : Object.keys(group.attributes).some((key) => key.startsWith(`${name}:`))
    if (fieldPresent && !hasKnownGeoZarrConvention(groupRegistrations.registrations, name)) {
      diagnostics.push(
        geoZarrDiagnostic(
          mode === 'strict' ? 'error' : 'warning',
          'malformed-registration',
          `${name} metadata is present without its known UUID registration`,
          `${group.path || '<root>'}.attributes`,
        ),
      )
    }
  }
  const groupMetadata: GeoZarrNormalizedNodeMetadata = Object.freeze({
    node: group,
    registrations: groupRegistrations.registrations,
    ...(groupProj.value === undefined ? {} : { proj: groupProj.value }),
    ...(groupSpatial.value === undefined ? {} : { spatial: groupSpatial.value }),
  })
  const layoutByAsset = new Map(
    (multiscales.value?.layout ?? []).map((entry) => [entry.asset, entry]),
  )
  const childMetadata: GeoZarrNormalizedNodeMetadata[] = []
  for (const child of children) {
    const childLayout = layoutByAsset.get(child.path)
    const inherited = inheritGeoZarrAttributes(
      group.attributes,
      child.attributes,
      child.path,
      mode,
      childLayout === undefined ? {} : layoutSpatialAttributes(childLayout),
    )
    diagnostics.push(...inherited.diagnostics)
    childMetadata.push(
      metadataForNode(child, inherited.proj, inherited.spatial, mode, limits, diagnostics),
    )
  }
  const childByPath = new Map(childMetadata.map((entry) => [entry.node.path, entry]))
  const levels: GeoZarrNormalizedLevel[] = []
  for (const layout of multiscales.value?.layout ?? []) {
    const child = childByPath.get(layout.asset)
    let proj = child?.proj ?? groupMetadata.proj
    let spatial = child?.spatial
    if (child !== undefined) {
      const inherited = inheritGeoZarrAttributes(
        group.attributes,
        child.node.attributes,
        child.node.path,
        mode,
        layoutSpatialAttributes(layout),
      )
      diagnostics.push(...inherited.diagnostics)
      const levelProj = parseGeoZarrProjMetadata(
        inherited.proj,
        mode,
        limits,
        `${layout.asset}.attributes`,
      )
      const levelSpatial = parseGeoZarrSpatialMetadata(
        inherited.spatial,
        {
          path: `${layout.asset}.attributes`,
          nodeType: child.node.nodeType,
          ...(child.node.shape === undefined ? {} : { shape: child.node.shape }),
          ...(child.node.dimensionNames === undefined
            ? {}
            : { dimensionNames: child.node.dimensionNames }),
        },
        mode,
        limits,
      )
      diagnostics.push(...levelProj.diagnostics, ...levelSpatial.diagnostics)
      proj = levelProj.value ?? proj
      spatial = levelSpatial.value ?? spatial
    }
    const resamplingMethod = layout.resamplingMethod ?? multiscales.value?.resamplingMethod
    levels.push(
      Object.freeze({
        order: layout.order,
        asset: layout.asset,
        ...(layout.derivedFrom === undefined ? {} : { derivedFrom: layout.derivedFrom }),
        ...(layout.transform?.scale === undefined ? {} : { relativeScale: layout.transform.scale }),
        ...(layout.transform?.translation === undefined
          ? {}
          : { relativeTranslation: layout.transform.translation }),
        ...(resamplingMethod === undefined ? {} : { resamplingMethod }),
        ...(child === undefined ? {} : { node: child.node }),
        ...(proj === undefined ? {} : { proj }),
        ...(spatial === undefined ? {} : { spatial }),
        layout,
      }),
    )
  }
  const registrations = Object.freeze([
    ...groupMetadata.registrations,
    ...childMetadata.flatMap((entry) => entry.registrations),
  ])
  const frozenDiagnostics = Object.freeze(diagnostics)
  rejectGeoZarrErrors(mode, frozenDiagnostics)
  return Object.freeze({
    schemaVersion: 1,
    mode,
    group: groupMetadata,
    children: Object.freeze(childMetadata),
    registrations,
    ...(multiscales.value === undefined ? {} : { multiscales: multiscales.value }),
    levels: Object.freeze(levels),
    ...(groupMetadata.proj?.spatialReference === undefined
      ? {}
      : { crs: groupMetadata.proj.spatialReference }),
    unresolvedConflicts: Object.freeze(
      diagnostics.filter((entry) =>
        [
          'conflicting-registration',
          'conflicting-version-evidence',
          'conflicting-crs-representations',
          'ambiguous-inheritance',
        ].includes(entry.code),
      ),
    ),
    diagnostics: frozenDiagnostics,
  })
}
