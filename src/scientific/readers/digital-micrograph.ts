import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import type { RasterBlock, RasterSampleType } from '../../raster.ts'
import { rasterSampleBytes } from '../../raster.ts'
import { type ImageSource, readExactly } from '../../source.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificAxisDescriptor,
  ScientificComponentDescriptor,
  ScientificDataset,
  ScientificMetadataValue,
  ScientificPlaneReadRequest,
} from '../dataset.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificMetadataObject,
  normalizeScientificPlaneReadRequest,
} from '../dataset.ts'
import type {
  DigitalMicrographGroupNode,
  DigitalMicrographIndex,
  DigitalMicrographMetadataEntry,
  DigitalMicrographPathSegment,
  DigitalMicrographValueNode,
} from '../formats/digital-micrograph.ts'
import { indexDigitalMicrograph } from '../formats/digital-micrograph.ts'
import type {
  ScientificDocument,
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
} from '../reader.ts'
import { createScientificDatasetIdentity, identifyScientificDataset } from '../reader.ts'
import { resourceHasHint } from './shared.ts'

export const digitalMicrographReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/digital-micrograph',
  version: '1.0.0',
  format: 'Gatan DigitalMicrograph',
  extensions: Object.freeze(['dm3', 'dm4']),
  mediaTypes: Object.freeze([
    'application/x-gatan-dm3',
    'application/x-gatan-dm4',
    'application/x-digital-micrograph',
  ]),
  capabilities: Object.freeze({
    resources: 'single',
    datasets: 'multiple',
    axes: 'ranked',
    nativePrecision: true,
    rangeReads: true,
  }),
})

export interface DigitalMicrographReaderLimits {
  readonly maxSourceBytes: number
  readonly maxDatasets: number
  readonly maxDimensionLength: number
  readonly maxDatasetBytes: number
  readonly maxRegionBytes: number
}

export interface DigitalMicrographReaderOptions {
  readonly limits?: Partial<DigitalMicrographReaderLimits>
}

const defaultReaderLimits: Readonly<DigitalMicrographReaderLimits> = Object.freeze({
  maxSourceBytes: 8_589_934_592,
  maxDatasets: 4_096,
  maxDimensionLength: 10_000_000,
  maxDatasetBytes: 8_589_934_592,
  maxRegionBytes: 67_108_864,
})

const positiveLimit = (value: number | undefined, fallback: number, label: string): number => {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return resolved
}

const resolveReaderLimits = (
  limits: Readonly<Partial<DigitalMicrographReaderLimits>> = {},
): Readonly<DigitalMicrographReaderLimits> =>
  Object.freeze({
    maxSourceBytes: positiveLimit(
      limits.maxSourceBytes,
      defaultReaderLimits.maxSourceBytes,
      'DigitalMicrograph maxSourceBytes',
    ),
    maxDatasets: positiveLimit(
      limits.maxDatasets,
      defaultReaderLimits.maxDatasets,
      'DigitalMicrograph maxDatasets',
    ),
    maxDimensionLength: positiveLimit(
      limits.maxDimensionLength,
      defaultReaderLimits.maxDimensionLength,
      'DigitalMicrograph maxDimensionLength',
    ),
    maxDatasetBytes: positiveLimit(
      limits.maxDatasetBytes,
      defaultReaderLimits.maxDatasetBytes,
      'DigitalMicrograph maxDatasetBytes',
    ),
    maxRegionBytes: positiveLimit(
      limits.maxRegionBytes,
      defaultReaderLimits.maxRegionBytes,
      'DigitalMicrograph maxRegionBytes',
    ),
  })

interface DigitalMicrographImageLayout {
  readonly index: number
  readonly title: string
  readonly dimensions: readonly number[]
  readonly dataType: number
  readonly sampleType: RasterSampleType
  readonly components: readonly ScientificComponentDescriptor[]
  readonly data: DigitalMicrographValueNode
  readonly axes: readonly ScientificAxisDescriptor[]
  readonly storageAxisIds: readonly string[]
  readonly displayAxes: readonly [horizontal: string, vertical: string]
  readonly axisSemantics: DigitalMicrographAxisSemantics
  readonly metadata: readonly DigitalMicrographMetadataEntry[]
  readonly calibrationWarnings: readonly Readonly<{
    readonly code: 'incomplete-axis-calibration'
    readonly axisId: string
    readonly message: string
  }>[]
}

type DigitalMicrographAxisSemanticKind =
  | 'image'
  | 'volume'
  | 'eels-spectrum-image'
  | '4d-stem'
  | 'neutral'

interface DigitalMicrographAxisSemantics {
  readonly kind: DigitalMicrographAxisSemanticKind
  readonly evidence: readonly string[]
}

interface DigitalMicrographAxisRole {
  readonly dimension: number
  readonly id: string
  readonly name: string
  readonly kind: ScientificAxisDescriptor['kind']
}

interface DigitalMicrographAxisMapping {
  readonly semantics: DigitalMicrographAxisSemantics
  readonly storageRoles: readonly DigitalMicrographAxisRole[]
  readonly descriptorRoles: readonly DigitalMicrographAxisRole[]
}

interface DigitalMicrographImageRejection {
  readonly index: number
  readonly reason: string
}

interface DigitalMicrographImageDiscovery {
  readonly layouts: readonly DigitalMicrographImageLayout[]
  readonly rejections: readonly DigitalMicrographImageRejection[]
}

const pathKey = (path: readonly DigitalMicrographPathSegment[]): string =>
  path.map(({ name, occurrence }) => `${name.length}:${name}:${occurrence}`).join('/')

const startsWithPath = (
  path: readonly DigitalMicrographPathSegment[],
  prefix: readonly DigitalMicrographPathSegment[],
): boolean =>
  prefix.length <= path.length &&
  prefix.every(
    (segment, index) =>
      segment.name === path[index]?.name && segment.occurrence === path[index]?.occurrence,
  )

const child = (
  group: Readonly<{
    readonly children: readonly (DigitalMicrographGroupNode | DigitalMicrographValueNode)[]
  }>,
  name: string,
): DigitalMicrographGroupNode | DigitalMicrographValueNode | undefined =>
  group.children.find((node) => node.name === name)

const groupChild = (group: DigitalMicrographGroupNode, name: string) => {
  const node = child(group, name)
  return node?.kind === 'group' ? node : undefined
}

const valueChild = (group: DigitalMicrographGroupNode, name: string) => {
  const node = child(group, name)
  return node?.kind === 'value' ? node : undefined
}

const nestedGroup = (
  group: DigitalMicrographGroupNode | undefined,
  names: readonly string[],
): DigitalMicrographGroupNode | undefined => {
  let current = group
  for (const name of names) {
    if (current === undefined) return undefined
    current = groupChild(current, name)
  }
  return current
}

const nestedValue = (
  group: DigitalMicrographGroupNode | undefined,
  groupNames: readonly string[],
  name: string,
): DigitalMicrographValueNode | undefined => {
  const parent = nestedGroup(group, groupNames)
  return parent === undefined ? undefined : valueChild(parent, name)
}

const metadataMap = (index: DigitalMicrographIndex): ReadonlyMap<string, ScientificMetadataValue> =>
  new Map(index.metadata.map((entry) => [pathKey(entry.path), entry.value]))

const metadataValue = (
  values: ReadonlyMap<string, ScientificMetadataValue>,
  node: DigitalMicrographValueNode | undefined,
): ScientificMetadataValue | undefined =>
  node === undefined ? undefined : values.get(pathKey(node.path))

const finiteMetadataNumber = (value: ScientificMetadataValue | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const positiveDimension = (value: ScientificMetadataValue | undefined): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined

const dmText = (value: ScientificMetadataValue | undefined): string | undefined => {
  if (typeof value === 'string') return value.length === 0 ? undefined : value
  if (!Array.isArray(value)) return undefined
  let text = ''
  for (const code of value) {
    if (typeof code !== 'number' || !Number.isSafeInteger(code) || code < 0 || code > 0xffff) {
      return undefined
    }
    if (code !== 0) text += String.fromCharCode(code)
  }
  return text.length === 0 ? undefined : text
}

const axisRole = (
  dimension: number,
  id: string,
  name: string,
  kind: ScientificAxisDescriptor['kind'],
): DigitalMicrographAxisRole => Object.freeze({ dimension, id, name, kind })

const requiredAxisRole = (
  roles: readonly DigitalMicrographAxisRole[],
  index: number,
): DigitalMicrographAxisRole => {
  const role = roles[index]
  if (role === undefined) throw invalidInput('DigitalMicrograph axis mapping is incomplete')
  return role
}

const requiredDimensionLength = (dimensions: readonly number[], dimension: number): number => {
  const length = dimensions[dimension]
  if (length === undefined) throw invalidInput('DigitalMicrograph axis dimension is missing')
  return length
}

const axisPair = (horizontal: string, vertical: string): readonly [string, string] =>
  Object.freeze([horizontal, vertical])

const axisMapping = (
  image: DigitalMicrographGroupNode,
  dimensions: readonly number[],
  calibrationDimensions: DigitalMicrographGroupNode | undefined,
  values: ReadonlyMap<string, ScientificMetadataValue>,
): DigitalMicrographAxisMapping => {
  if (dimensions.length === 2) {
    const roles = Object.freeze([axisRole(0, 'x', 'X', 'space'), axisRole(1, 'y', 'Y', 'space')])
    return Object.freeze({
      semantics: Object.freeze({ kind: 'image', evidence: Object.freeze(['rank-2']) }),
      storageRoles: roles,
      descriptorRoles: roles,
    })
  }

  const imageTags = groupChild(image, 'ImageTags')
  const format = dmText(metadataValue(values, nestedValue(imageTags, ['Meta Data'], 'Format')))
  const signal = dmText(metadataValue(values, nestedValue(imageTags, ['Meta Data'], 'Signal')))

  if (dimensions.length === 3) {
    const energyCalibration = calibrationDimensions?.children.filter(
      (node): node is DigitalMicrographGroupNode => node.kind === 'group',
    )[2]
    const energyUnit = dmText(
      metadataValue(
        values,
        energyCalibration === undefined ? undefined : valueChild(energyCalibration, 'Units'),
      ),
    )
    if (format === 'Spectrum image' && signal === 'EELS' && energyUnit === 'eV') {
      const roles = Object.freeze([
        axisRole(0, 'x', 'X', 'space'),
        axisRole(1, 'y', 'Y', 'space'),
        axisRole(2, 'energy', 'Energy loss', 'spectral'),
      ])
      return Object.freeze({
        semantics: Object.freeze({
          kind: 'eels-spectrum-image',
          evidence: Object.freeze([
            'dm:ImageTags/Meta Data/Format',
            'dm:ImageTags/Meta Data/Signal',
            'dm:ImageData/Calibrations/Dimension/2/Units',
          ]),
        }),
        storageRoles: roles,
        descriptorRoles: roles,
      })
    }
    if (format === 'Spectrum image') {
      const roles = Object.freeze(
        dimensions.map((_length, dimension) =>
          axisRole(dimension, `dimension-${dimension}`, `Dimension ${dimension}`, 'other'),
        ),
      )
      return Object.freeze({
        semantics: Object.freeze({ kind: 'neutral', evidence: Object.freeze([]) }),
        storageRoles: roles,
        descriptorRoles: roles,
      })
    }
    const roles = Object.freeze([
      axisRole(0, 'x', 'X', 'space'),
      axisRole(1, 'y', 'Y', 'space'),
      axisRole(2, 'z', 'Z', 'space'),
    ])
    return Object.freeze({
      semantics: Object.freeze({ kind: 'volume', evidence: Object.freeze(['rank-3']) }),
      storageRoles: roles,
      descriptorRoles: roles,
    })
  }

  const dataOrderSwapped = metadataValue(
    values,
    nestedValue(imageTags, ['Meta Data'], 'Data Order Swapped'),
  )
  const applicationMode = dmText(
    metadataValue(
      values,
      nestedValue(imageTags, ['SI', 'Acquisition', 'SI Application Mode'], 'Name'),
    ),
  )
  const scanWidth = positiveDimension(
    metadataValue(
      values,
      nestedValue(imageTags, ['SI', 'Acquisition', 'Spatial Sampling'], 'Width (pixels)'),
    ),
  )
  const scanHeight = positiveDimension(
    metadataValue(
      values,
      nestedValue(imageTags, ['SI', 'Acquisition', 'Spatial Sampling'], 'Height (pixels)'),
    ),
  )
  if (
    format === 'Diffraction image' &&
    dataOrderSwapped === true &&
    applicationMode === '2D Array' &&
    scanWidth === dimensions[2] &&
    scanHeight === dimensions[3]
  ) {
    const kx = axisRole(0, 'kx', 'Diffraction X', 'reciprocal-space')
    const ky = axisRole(1, 'ky', 'Diffraction Y', 'reciprocal-space')
    const scanX = axisRole(2, 'scanX', 'Scan X', 'space')
    const scanY = axisRole(3, 'scanY', 'Scan Y', 'space')
    return Object.freeze({
      semantics: Object.freeze({
        kind: '4d-stem',
        evidence: Object.freeze([
          'dm:ImageTags/Meta Data/Format',
          'dm:ImageTags/Meta Data/Data Order Swapped',
          'dm:ImageTags/SI/Acquisition/SI Application Mode/Name',
          'dm:ImageTags/SI/Acquisition/Spatial Sampling',
        ]),
      }),
      storageRoles: Object.freeze([kx, ky, scanX, scanY]),
      descriptorRoles: Object.freeze([scanX, scanY, kx, ky]),
    })
  }
  const roles = Object.freeze(
    dimensions.map((_length, dimension) =>
      axisRole(dimension, `dimension-${dimension}`, `Dimension ${dimension}`, 'other'),
    ),
  )
  return Object.freeze({
    semantics: Object.freeze({ kind: 'neutral', evidence: Object.freeze([]) }),
    storageRoles: roles,
    descriptorRoles: roles,
  })
}

const scalarType = (
  dataType: number,
  data: DigitalMicrographValueNode,
): { readonly sampleType: RasterSampleType; readonly channels: 1 | 4 } | undefined => {
  if (data.descriptor.kind !== 'array' || data.descriptor.element.kind !== 'scalar')
    return undefined
  const expected = new Map<number, readonly [RasterSampleType, string]>([
    [1, ['int16', 'int16']],
    [2, ['float32', 'float32']],
    [6, ['uint8', 'uint8']],
    [7, ['int32', 'int32']],
    [9, ['int8', 'int8']],
    [10, ['uint16', 'uint16']],
    [11, ['uint32', 'uint32']],
    [12, ['float64', 'float64']],
  ])
  const scalar = expected.get(dataType)
  if (scalar !== undefined && data.descriptor.element.type === scalar[1]) {
    return Object.freeze({ sampleType: scalar[0], channels: 1 })
  }
  if ((dataType === 8 || dataType === 23) && data.descriptor.element.type === 'int32') {
    return Object.freeze({ sampleType: 'uint8', channels: 4 })
  }
  return undefined
}

const unsupportedDataTypeReason = (dataType: number): string => {
  if ([3, 4, 5, 13, 27, 28].includes(dataType)) {
    return `uses unsupported complex or packed-complex DataType ${dataType}`
  }
  if (dataType === 14) return 'uses unsupported binary DataType 14'
  return `uses unsupported or undocumented packed DataType ${dataType}`
}

const supportedDataTypes: ReadonlySet<number> = new Set([1, 2, 6, 7, 8, 9, 10, 11, 12, 23])

const externalOrEncryptedReason = (imageData: DigitalMicrographGroupNode): string | undefined => {
  const names = imageData.children.map(({ name }) => name.toLowerCase())
  if (names.some((name) => name.includes('encrypt'))) {
    return 'uses unsupported encrypted image content'
  }
  if (names.some((name) => name.includes('external') || name.includes('reference'))) {
    return 'uses unsupported externally referenced image content'
  }
  return undefined
}

const checkedProduct = (values: readonly number[], label: string): number => {
  let product = 1n
  for (const value of values) product *= BigInt(value)
  if (product > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw limitExceeded(`DigitalMicrograph ${label} exceeds the safe address range`)
  }
  return Number(product)
}

const calibrationAxis = (
  dimensionsGroup: DigitalMicrographGroupNode | undefined,
  imageIndex: number,
  role: DigitalMicrographAxisRole,
  length: number,
  values: ReadonlyMap<string, ScientificMetadataValue>,
  resourceId: string,
): ScientificAxisDescriptor => {
  const dimension = role.dimension
  const calibration = dimensionsGroup?.children.filter(
    (node): node is DigitalMicrographGroupNode => node.kind === 'group',
  )[dimension]
  const scale = finiteMetadataNumber(
    metadataValue(values, calibration === undefined ? undefined : valueChild(calibration, 'Scale')),
  )
  const sourceOrigin = finiteMetadataNumber(
    metadataValue(
      values,
      calibration === undefined ? undefined : valueChild(calibration, 'Origin'),
    ),
  )
  const unit = dmText(
    metadataValue(values, calibration === undefined ? undefined : valueChild(calibration, 'Units')),
  )
  const calibrated = scale !== undefined && scale !== 0 && sourceOrigin !== undefined
  return Object.freeze({
    id: role.id,
    name: role.name,
    kind: role.kind,
    length,
    coordinates: calibrated
      ? Object.freeze({ type: 'linear' as const, origin: -sourceOrigin * scale, step: scale })
      : Object.freeze({ type: 'index' as const }),
    ...(calibrated && unit !== undefined ? { unit } : {}),
    ...(calibrated
      ? {
          calibration: {
            kind: 'derived' as const,
            resourceId,
            locator: `dm:ImageList/${imageIndex}/ImageData/Calibrations/Dimension/${dimension}`,
            formula: 'digital-micrograph-origin-times-scale-v1',
          },
        }
      : {}),
  })
}

const imageLayouts = (
  index: DigitalMicrographIndex,
  resourceId: string,
  limits: Readonly<DigitalMicrographReaderLimits>,
): DigitalMicrographImageDiscovery => {
  const imageList = index.root.children.find(
    (node): node is DigitalMicrographGroupNode =>
      node.kind === 'group' && node.name === 'ImageList',
  )
  if (imageList === undefined) throw invalidInput('DigitalMicrograph ImageList is missing')
  const values = metadataMap(index)
  const layouts: DigitalMicrographImageLayout[] = []
  const rejections: DigitalMicrographImageRejection[] = []
  const candidates = imageList.children.filter(
    (node): node is DigitalMicrographGroupNode => node.kind === 'group',
  )
  if (candidates.length > limits.maxDatasets) {
    throw limitExceeded(
      `DigitalMicrograph has ${candidates.length} ImageList entries; maxDatasets is ${limits.maxDatasets}`,
    )
  }
  for (let imageIndex = 0; imageIndex < candidates.length; imageIndex += 1) {
    const image = candidates[imageIndex]
    if (image === undefined) continue
    const imageData = groupChild(image, 'ImageData')
    if (imageData === undefined) continue
    const externalReason = externalOrEncryptedReason(imageData)
    if (externalReason !== undefined) {
      rejections.push(Object.freeze({ index: imageIndex, reason: externalReason }))
      continue
    }
    const data = valueChild(imageData, 'Data')
    const rawDataType = finiteMetadataNumber(
      metadataValue(values, valueChild(imageData, 'DataType')),
    )
    const dimensionsGroup = groupChild(imageData, 'Dimensions')
    if (data === undefined) {
      rejections.push(
        Object.freeze({
          index: imageIndex,
          reason: 'does not contain an inline image Data array',
        }),
      )
      continue
    }
    if (
      rawDataType === undefined ||
      !Number.isSafeInteger(rawDataType) ||
      dimensionsGroup === undefined
    ) {
      throw invalidInput(
        `DigitalMicrograph ImageList entry ${imageIndex} is missing DataType or Dimensions`,
      )
    }
    if (
      dimensionsGroup.children.length === 0 ||
      dimensionsGroup.children.some((node) => node.kind !== 'value')
    ) {
      throw invalidInput(`DigitalMicrograph ImageList entry ${imageIndex} has invalid dimensions`)
    }
    const dimensions = dimensionsGroup.children.map((node) =>
      node.kind === 'value' ? positiveDimension(metadataValue(values, node)) : undefined,
    )
    if (dimensions.some((value) => value === undefined)) {
      throw invalidInput(`DigitalMicrograph ImageList entry ${imageIndex} has invalid dimensions`)
    }
    const resolvedDimensions = dimensions.filter((value): value is number => value !== undefined)
    const oversizedDimension = resolvedDimensions.find(
      (length) => length > limits.maxDimensionLength,
    )
    if (oversizedDimension !== undefined) {
      throw limitExceeded(
        `DigitalMicrograph ImageList entry ${imageIndex} dimension ${oversizedDimension} exceeds maxDimensionLength ${limits.maxDimensionLength}`,
      )
    }
    if (resolvedDimensions.length === 1) {
      rejections.push(Object.freeze({ index: imageIndex, reason: 'is a one-dimensional signal' }))
      continue
    }
    if (resolvedDimensions.length < 2 || resolvedDimensions.length > 4) {
      rejections.push(
        Object.freeze({
          index: imageIndex,
          reason: `has unsupported rank ${resolvedDimensions.length}; expected rank 2 through 4`,
        }),
      )
      continue
    }
    if ((rawDataType === 8 || rawDataType === 23) && data.payload.byteOrder !== 'little-endian') {
      rejections.push(
        Object.freeze({
          index: imageIndex,
          reason: `uses unsupported big-endian packed color DataType ${rawDataType}`,
        }),
      )
      continue
    }
    const storage = scalarType(rawDataType, data)
    if (storage === undefined) {
      if (supportedDataTypes.has(rawDataType)) {
        throw invalidInput(
          `DigitalMicrograph ImageList entry ${imageIndex} has a malformed Data descriptor for DataType ${rawDataType}`,
        )
      }
      rejections.push(
        Object.freeze({ index: imageIndex, reason: unsupportedDataTypeReason(rawDataType) }),
      )
      continue
    }
    const expectedBytes = checkedProduct(
      [...resolvedDimensions, rasterSampleBytes(storage.sampleType), storage.channels],
      'payload byte count',
    )
    if (expectedBytes > limits.maxDatasetBytes) {
      throw limitExceeded(
        `DigitalMicrograph ImageList entry ${imageIndex} has ${expectedBytes} payload bytes; maxDatasetBytes is ${limits.maxDatasetBytes}`,
      )
    }
    if (data.payload.byteLength !== expectedBytes) {
      throw invalidInput(
        `DigitalMicrograph ImageList entry ${imageIndex} has inconsistent data size`,
      )
    }
    const calibration = groupChild(imageData, 'Calibrations')
    const calibrationDimensions =
      calibration === undefined ? undefined : groupChild(calibration, 'Dimension')
    const mapping = axisMapping(image, resolvedDimensions, calibrationDimensions, values)
    const brightness = calibration === undefined ? undefined : groupChild(calibration, 'Brightness')
    const intensityUnit = dmText(
      metadataValue(values, brightness === undefined ? undefined : valueChild(brightness, 'Units')),
    )
    const components: readonly ScientificComponentDescriptor[] =
      storage.channels === 4
        ? Object.freeze([
            Object.freeze({ id: 'red', name: 'Red', kind: 'red' as const }),
            Object.freeze({ id: 'green', name: 'Green', kind: 'green' as const }),
            Object.freeze({ id: 'blue', name: 'Blue', kind: 'blue' as const }),
            Object.freeze({ id: 'alpha', name: 'Alpha', kind: 'alpha' as const }),
          ])
        : Object.freeze([
            Object.freeze({
              id: 'intensity',
              name: 'Intensity',
              kind: 'intensity' as const,
              ...(intensityUnit === undefined ? {} : { unit: intensityUnit }),
            }),
          ])
    const title = dmText(metadataValue(values, valueChild(image, 'Name'))) ?? `Image ${imageIndex}`
    const horizontalRole = requiredAxisRole(mapping.storageRoles, 0)
    const verticalRole = requiredAxisRole(mapping.storageRoles, 1)
    const axes = mapping.descriptorRoles.map((role) =>
      calibrationAxis(
        calibrationDimensions,
        imageIndex,
        role,
        requiredDimensionLength(resolvedDimensions, role.dimension),
        values,
        resourceId,
      ),
    )
    const calibrationGroups =
      calibrationDimensions?.children.filter(
        (node): node is DigitalMicrographGroupNode => node.kind === 'group',
      ) ?? []
    const calibrationWarnings = mapping.descriptorRoles.flatMap((role, axisIndex) => {
      const axis = axes[axisIndex]
      if (axis?.coordinates.type !== 'index' || calibrationGroups[role.dimension] === undefined) {
        return []
      }
      return [
        Object.freeze({
          code: 'incomplete-axis-calibration' as const,
          axisId: axis.id,
          message:
            'Raw DigitalMicrograph calibration tags are preserved, but unit and calibration evidence were omitted because origin or non-zero scale is incomplete.',
        }),
      ]
    })
    layouts.push(
      Object.freeze({
        index: imageIndex,
        title,
        dimensions: Object.freeze(resolvedDimensions),
        dataType: rawDataType,
        sampleType: storage.sampleType,
        components,
        data,
        axes: Object.freeze(axes),
        storageAxisIds: Object.freeze(mapping.storageRoles.map(({ id }) => id)),
        displayAxes: axisPair(horizontalRole.id, verticalRole.id),
        axisSemantics: mapping.semantics,
        metadata: Object.freeze(
          index.metadata.filter((entry) => startsWithPath(entry.path, image.path)),
        ),
        calibrationWarnings: Object.freeze(calibrationWarnings),
      }),
    )
  }
  return Object.freeze({
    layouts: Object.freeze(layouts),
    rejections: Object.freeze(rejections),
  })
}

const swapSamplesToBigEndian = (data: Uint8Array, bytesPerSample: number): void => {
  if (bytesPerSample === 1) return
  for (let offset = 0; offset < data.byteLength; offset += bytesPerSample) {
    for (let left = 0; left < bytesPerSample / 2; left += 1) {
      const right = bytesPerSample - left - 1
      const value = data[offset + left] ?? 0
      data[offset + left] = data[offset + right] ?? 0
      data[offset + right] = value
    }
  }
}

class DigitalMicrographScientificDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #source: ImageSource
  readonly #layout: DigitalMicrographImageLayout
  readonly #limits: Readonly<DigitalMicrographReaderLimits>

  constructor(
    source: ImageSource,
    layout: DigitalMicrographImageLayout,
    index: DigitalMicrographIndex,
    limits: Readonly<DigitalMicrographReaderLimits>,
  ) {
    this.#source = source
    this.#layout = layout
    this.#limits = limits
    this.descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      axes: layout.axes,
      sampleType: layout.sampleType,
      components: layout.components,
      metadata: normalizeScientificMetadataObject({
        'purejsimage:gatan': {
          imageIndex: layout.index,
          dataType: layout.dataType,
          payloadOffset: layout.data.payload.offset,
          payloadBytes: layout.data.payload.byteLength,
          axisSemantics: {
            kind: layout.axisSemantics.kind,
            evidence: layout.axisSemantics.evidence,
          },
          tags: layout.metadata.map((entry) => ({
            path: entry.path.map(({ name, occurrence }) => ({ name, occurrence })),
            value: entry.value,
          })),
          intensityCalibration: (() => {
            const imageData = layout.data.path.slice(0, -1)
            const brightness = index.metadata.filter(
              (entry) =>
                startsWithPath(entry.path, imageData) &&
                entry.path.some(({ name }) => name === 'Brightness'),
            )
            return brightness.map((entry) => ({
              path: entry.path.map(({ name }) => name).join('/'),
              value: entry.value,
            }))
          })(),
          warnings: layout.calibrationWarnings,
        },
      }),
      capabilities: {
        regionReads: true,
        resolutionLevels: false,
        planeReads: {
          kind: 'ordered-axis-pairs',
          pairs: [layout.displayAxes],
        },
      },
    })
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    const normalized = normalizeScientificPlaneReadRequest(this.descriptor, request)
    const [horizontalAxis, verticalAxis] = this.#layout.displayAxes
    if (
      normalized.displayAxes[0] !== horizontalAxis ||
      normalized.displayAxes[1] !== verticalAxis
    ) {
      throw unsupportedOperation(
        `DigitalMicrograph currently displays only ${horizontalAxis}/${verticalAxis} planes`,
      )
    }
    const bytesPerSample = rasterSampleBytes(this.#layout.sampleType)
    const channels = this.#layout.components.length
    const pixelBytes = bytesPerSample * channels
    const regionBytes = checkedProduct(
      [normalized.width, normalized.height, pixelBytes],
      'selected-region byte count',
    )
    if (regionBytes > this.#limits.maxRegionBytes) {
      throw limitExceeded(
        `DigitalMicrograph selected region requires ${regionBytes} bytes; maxRegionBytes is ${this.#limits.maxRegionBytes}`,
      )
    }
    let fixedOffset = 0
    let stride = (this.#layout.dimensions[0] ?? 0) * (this.#layout.dimensions[1] ?? 0)
    for (let dimension = 2; dimension < this.#layout.dimensions.length; dimension += 1) {
      const axisId = this.#layout.storageAxisIds[dimension] ?? `dimension-${dimension}`
      const index = normalized.fixedIndices.find((entry) => entry.axisId === axisId)?.index ?? 0
      fixedOffset += index * stride
      stride *= this.#layout.dimensions[dimension] ?? 0
    }
    const width = this.#layout.dimensions[0] ?? 0
    const selectedRowBytes = normalized.width * pixelBytes
    const storageRowBytes = width * pixelBytes
    const maximumBatchRows = Math.max(
      1,
      Math.min(
        normalized.height,
        1 +
          Math.floor(
            (Math.min(this.#limits.maxRegionBytes, dmMaximumCoalescedReadBytes) -
              selectedRowBytes) /
              storageRowBytes,
          ),
      ),
    )
    for (let row = 0; row < normalized.height; row += maximumBatchRows) {
      throwIfAborted(normalized.signal)
      const batchRows = Math.min(maximumBatchRows, normalized.height - row)
      const sampleOffset = fixedOffset + (normalized.y + row) * width + normalized.x
      const sourceOffset = this.#layout.data.payload.offset + sampleOffset * pixelBytes
      const source = await readExactly(
        this.#source,
        sourceOffset,
        selectedRowBytes + (batchRows - 1) * storageRowBytes,
        {
          ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
        },
      )
      for (let batchRow = 0; batchRow < batchRows; batchRow += 1) {
        throwIfAborted(normalized.signal)
        const sourceRow = source.subarray(
          batchRow * storageRowBytes,
          batchRow * storageRowBytes + selectedRowBytes,
        )
        let data: Uint8Array
        if (channels === 4) {
          data = new Uint8Array(sourceRow.byteLength)
          for (let pixel = 0; pixel < normalized.width; pixel += 1) {
            const offset = pixel * 4
            data[offset] = sourceRow[offset + 2] ?? 0
            data[offset + 1] = sourceRow[offset + 1] ?? 0
            data[offset + 2] = sourceRow[offset] ?? 0
            data[offset + 3] = sourceRow[offset + 3] ?? 0
          }
        } else {
          data = sourceRow.slice()
          if (bytesPerSample > 1 && this.#layout.data.payload.byteOrder === 'little-endian') {
            swapSamplesToBigEndian(data, bytesPerSample)
          }
        }
        yield Object.freeze({
          x: normalized.x,
          y: normalized.y + row + batchRow,
          width: normalized.width,
          height: 1,
          stride: selectedRowBytes,
          format: Object.freeze({
            sampleType: this.#layout.sampleType,
            channels,
            planar: false,
          }),
          data,
        })
      }
    }
  }
}

const dmProbeBytes = 16
const dmMaximumCoalescedReadBytes = 1024 * 1024

export const createDigitalMicrographReader = (
  options: Readonly<DigitalMicrographReaderOptions> = {},
): ScientificReader => {
  const limits = resolveReaderLimits(options.limits)
  return Object.freeze({
    descriptor: digitalMicrographReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      throwIfAborted(context.signal)
      const bytes = await context.primary.source.read(0, dmProbeBytes, {
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      })
      if (bytes.byteLength < 12) {
        return Object.freeze({ confidence: 0, reason: 'DigitalMicrograph header is absent' })
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const version = view.getUint32(0, false)
      if (version === 4 && bytes.byteLength < dmProbeBytes) {
        return Object.freeze({ confidence: 0, reason: 'DigitalMicrograph DM4 header is truncated' })
      }
      const byteOrderOffset = version === 4 ? 12 : 8
      const byteOrder = version === 3 || version === 4 ? view.getUint32(byteOrderOffset, false) : -1
      if ((version !== 3 && version !== 4) || (byteOrder !== 0 && byteOrder !== 1)) {
        return Object.freeze({ confidence: 0, reason: 'DigitalMicrograph header is absent' })
      }
      const hinted = resourceHasHint(
        context.primary,
        digitalMicrographReaderDescriptor.extensions,
        digitalMicrographReaderDescriptor.mediaTypes,
      )
      return Object.freeze({
        confidence: hinted ? 1 : 0.98,
        reason: hinted
          ? `DM${version} header and resource hint match`
          : `DM${version} header matches`,
      })
    },
    async open(context: Readonly<ScientificOpenContext>): Promise<ScientificDocument> {
      if (context.primary.source.size > limits.maxSourceBytes) {
        throw limitExceeded(
          `DigitalMicrograph source has ${context.primary.source.size} bytes; maxSourceBytes is ${limits.maxSourceBytes}`,
        )
      }
      const index = await indexDigitalMicrograph(context.primary.source, {
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      })
      const discovery = imageLayouts(index, context.primary.id, limits)
      if (discovery.layouts.length === 0) {
        const first = discovery.rejections[0]
        throw unsupportedOperation(
          first === undefined
            ? 'DigitalMicrograph contains no image datasets'
            : `DigitalMicrograph ImageList entry ${first.index} ${first.reason}`,
        )
      }
      const entries = await Promise.all(
        discovery.layouts.map(async (layout) => {
          const id = `image-${layout.index}`
          const identity = await createScientificDatasetIdentity({
            reader: digitalMicrographReaderDescriptor,
            datasetId: id,
            resources: [context.primary],
          })
          const dataset = identifyScientificDataset(
            new DigitalMicrographScientificDataset(context.primary.source, layout, index, limits),
            identity,
          )
          return Object.freeze({ id, name: layout.title, identity, dataset })
        }),
      )
      return Object.freeze({
        reader: Object.freeze({
          id: digitalMicrographReaderDescriptor.id,
          version: digitalMicrographReaderDescriptor.version,
        }),
        format: digitalMicrographReaderDescriptor.format,
        metadata: normalizeScientificMetadataObject({
          version: index.version,
          payloadByteOrder: index.byteOrder,
          tagCount: index.tagCount,
          indexedBytesRead: index.sourceBytesRead,
          omittedMetadataValues: index.metadataOmissions.length,
          unsupportedDatasets: discovery.rejections.map(({ index: imageIndex, reason }) => ({
            imageIndex,
            reason,
          })),
        }),
        datasets: Object.freeze(
          entries.map(({ id, name, identity, dataset }) =>
            Object.freeze({ id, name, identity, descriptor: dataset.descriptor }),
          ),
        ),
        async openDataset(id: string, options?: Readonly<AbortOptions>) {
          throwIfAborted(options?.signal ?? context.signal)
          const entry = entries.find((candidate) => candidate.id === id)
          if (entry === undefined) throw invalidInput(`Unknown DigitalMicrograph dataset ${id}`)
          return entry.dataset
        },
      })
    },
  })
}

export const digitalMicrographReader: ScientificReader = createDigitalMicrographReader()
