import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import {
  invalidInput,
  limitExceeded,
  unsupportedFormat,
  unsupportedOperation,
} from '../../errors.ts'
import type { ScientificAxisCoordinates } from '../dataset.ts'
import {
  hdf5FloatAttributeValue,
  hdf5IntegerAttributeValue,
  hdf5StringAttributeValue,
  type Hdf5Attribute,
} from './hdf5-attributes.ts'
import type { Hdf5Datatype } from './hdf5-dataset.ts'
import type { Hdf5DatasetObject, Hdf5File, Hdf5GroupObject, Hdf5Object } from './hdf5-file.ts'

export interface NcemEmdInspectionLimits {
  readonly maxDepth?: number
  readonly maxObjects?: number
  readonly maxNumericGroups?: number
  readonly maxDimensionValues?: number
  readonly maxTotalDimensionValues?: number
  readonly maxMetadataEntries?: number
  readonly maxMetadataBytes?: number
}

export interface NcemEmdInspectionOptions extends AbortOptions, NcemEmdInspectionLimits {}

export interface NcemEmdNumericGroup {
  readonly path: string
  readonly dataPath: string
  readonly dimensionPaths: readonly string[]
  readonly dimensions: readonly NcemEmdDimension[]
  readonly shape: readonly number[]
}

export interface NcemEmdDimension {
  readonly path: string
  readonly name: string | undefined
  readonly unit: string | undefined
  readonly length: number
  readonly coordinates: ScientificAxisCoordinates
}

export interface NcemEmdInspection {
  readonly version: Readonly<{ readonly major: 0; readonly minor: 2 }>
  readonly numericGroups: readonly NcemEmdNumericGroup[]
  readonly metadata: NcemEmdAcquisitionMetadata
}

export type NcemEmdMetadataValue = string | number | readonly string[] | readonly number[]

export interface NcemEmdAcquisitionMetadata {
  readonly microscope?: Readonly<Record<string, NcemEmdMetadataValue>>
  readonly sample?: Readonly<Record<string, NcemEmdMetadataValue>>
  readonly user?: Readonly<Record<string, NcemEmdMetadataValue>>
  readonly comments?: Readonly<Record<string, NcemEmdMetadataValue>>
}

interface ResolvedLimits {
  readonly maxDepth: number
  readonly maxObjects: number
  readonly maxNumericGroups: number
  readonly maxDimensionValues: number
  readonly maxTotalDimensionValues: number
  readonly maxMetadataEntries: number
  readonly maxMetadataBytes: number
}

interface DimensionValueBudget {
  used: number
}

interface PendingGroup {
  readonly path: string
  readonly depth: number
  readonly object: Hdf5GroupObject
}

const positiveSafeInteger = (label: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return value
}

const resolveLimits = (options: Readonly<NcemEmdInspectionLimits>): ResolvedLimits =>
  Object.freeze({
    maxDepth: positiveSafeInteger('NCEM EMD maxDepth', options.maxDepth ?? 32),
    maxObjects: positiveSafeInteger('NCEM EMD maxObjects', options.maxObjects ?? 16_384),
    maxNumericGroups: positiveSafeInteger(
      'NCEM EMD maxNumericGroups',
      options.maxNumericGroups ?? 4_096,
    ),
    maxDimensionValues: positiveSafeInteger(
      'NCEM EMD maxDimensionValues',
      options.maxDimensionValues ?? 65_536,
    ),
    maxTotalDimensionValues: positiveSafeInteger(
      'NCEM EMD maxTotalDimensionValues',
      options.maxTotalDimensionValues ?? 1_048_576,
    ),
    maxMetadataEntries: positiveSafeInteger(
      'NCEM EMD maxMetadataEntries',
      options.maxMetadataEntries ?? 1_024,
    ),
    maxMetadataBytes: positiveSafeInteger(
      'NCEM EMD maxMetadataBytes',
      options.maxMetadataBytes ?? 1_048_576,
    ),
  })

const attribute = (
  attributes: readonly Hdf5Attribute[] | undefined,
  name: string,
): Hdf5Attribute | undefined => attributes?.find((candidate) => candidate.name === name)

export const ncemEmdVersionPart = (
  attributeValue: Hdf5Attribute | undefined,
  name: string,
): number => {
  if (attributeValue === undefined) {
    throw unsupportedFormat(`HDF5 root does not declare the NCEM EMD ${name} attribute`)
  }
  const value =
    attributeValue.datatype.kind === 'integer'
      ? hdf5IntegerAttributeValue(attributeValue)
      : (() => {
          if (
            attributeValue.datatype.kind !== 'fixed-string' &&
            attributeValue.datatype.kind !== 'variable-string'
          ) {
            throw invalidInput(`NCEM EMD ${name} is not an integer or decimal string`)
          }
          const text = hdf5StringAttributeValue(attributeValue)
          if (!/^\d+$/.test(text)) {
            throw invalidInput(`NCEM EMD ${name} is not a decimal integer`)
          }
          return BigInt(text)
        })()
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw invalidInput(`NCEM EMD ${name} is outside the safe integer range`)
  }
  return Number(value)
}

const childPath = (parent: string, name: string): string =>
  parent === '/' ? `/${name}` : `${parent}/${name}`

const numericDataset = (object: Hdf5Object | undefined): object is Hdf5DatasetObject =>
  object?.kind === 'dataset' &&
  (object.metadata.datatype.kind === 'integer' || object.metadata.datatype.kind === 'float')

const dimensionIndex = (name: string): number | undefined => {
  const match = /^dim([1-9]\d*)$/.exec(name)
  if (match === null) return undefined
  const value = Number(match[1])
  return Number.isSafeInteger(value) ? value : undefined
}

const halfFloat = (bits: number): number => {
  const sign = (bits & 0x8000) === 0 ? 1 : -1
  const exponent = (bits >>> 10) & 0x1f
  const fraction = bits & 0x03ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 0x1f) return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

const unsignedInteger = (
  bytes: Uint8Array,
  offset: number,
  byteLength: number,
  littleEndian: boolean,
): bigint => {
  let value = 0n
  if (littleEndian) {
    for (let index = byteLength - 1; index >= 0; index -= 1) {
      value = (value << 8n) | BigInt(bytes[offset + index] ?? 0)
    }
    return value
  }
  for (let index = 0; index < byteLength; index += 1) {
    value = (value << 8n) | BigInt(bytes[offset + index] ?? 0)
  }
  return value
}

const numericValue = (bytes: Uint8Array, offset: number, datatype: Hdf5Datatype): number => {
  if (datatype.kind === 'integer') {
    if (
      datatype.bitOffset !== 0 ||
      datatype.bitPrecision !== datatype.byteLength * 8 ||
      datatype.lowPadding !== 0 ||
      datatype.highPadding !== 0
    ) {
      throw unsupportedOperation('NCEM EMD dimension uses a packed integer datatype')
    }
    const unsigned = unsignedInteger(
      bytes,
      offset,
      datatype.byteLength,
      datatype.byteOrder === 'little-endian',
    )
    const signBit = 1n << BigInt(datatype.bitPrecision - 1)
    const value =
      datatype.signed && (unsigned & signBit) !== 0n
        ? unsigned - (1n << BigInt(datatype.bitPrecision))
        : unsigned
    if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw unsupportedOperation('NCEM EMD dimension integer exceeds exact JavaScript coordinates')
    }
    return Number(value)
  }
  if (datatype.kind !== 'float') {
    throw invalidInput('NCEM EMD dimension is not numeric')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const littleEndian = datatype.byteOrder === 'little-endian'
  if (datatype.format === 'binary16') return halfFloat(view.getUint16(offset, littleEndian))
  if (datatype.format === 'binary32') return view.getFloat32(offset, littleEndian)
  return view.getFloat64(offset, littleEndian)
}

const readDimensionValues = async (
  file: Hdf5File,
  dimension: Hdf5DatasetObject,
  path: string,
  maximumValues: number,
  signal: AbortSignal | undefined,
): Promise<readonly number[]> => {
  const count = dimension.metadata.dataspace.dimensions[0]
  if (count === undefined)
    throw invalidInput(`NCEM EMD dimension ${JSON.stringify(path)} is scalar`)
  if (count > maximumValues) {
    throw limitExceeded(
      `NCEM EMD dimension ${JSON.stringify(path)} has ${count} values; limit is ${maximumValues}`,
    )
  }
  const values = new Array<number>(count).fill(Number.NaN)
  for await (const block of file.readDataset(
    path,
    { start: [0], shape: [count] },
    signal === undefined ? {} : { signal },
  )) {
    const start = block.start[0]
    const blockValues = block.shape[0]
    if (start === undefined || blockValues === undefined) {
      throw invalidInput(`NCEM EMD dimension ${JSON.stringify(path)} returned a non-vector block`)
    }
    const expectedBytes = blockValues * dimension.metadata.datatype.byteLength
    if (block.data.byteLength !== expectedBytes) {
      throw invalidInput(`NCEM EMD dimension ${JSON.stringify(path)} returned invalid block bytes`)
    }
    for (let index = 0; index < blockValues; index += 1) {
      const value = numericValue(
        block.data,
        index * dimension.metadata.datatype.byteLength,
        dimension.metadata.datatype,
      )
      if (!Number.isFinite(value)) {
        throw invalidInput(`NCEM EMD dimension ${JSON.stringify(path)} contains a non-finite value`)
      }
      values[start + index] = value
    }
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw invalidInput(`NCEM EMD dimension ${JSON.stringify(path)} is incomplete`)
  }
  return Object.freeze(values)
}

const dimensionCoordinates = (
  values: readonly number[],
  extent: number,
  path: string,
): ScientificAxisCoordinates => {
  if (values.length === 2 && values.length !== extent) {
    const origin = values[0]
    const step = values[1]
    if (origin === undefined || step === undefined || step === 0) {
      throw invalidInput(
        `NCEM EMD regular dimension ${JSON.stringify(path)} has invalid calibration`,
      )
    }
    return Object.freeze({ type: 'linear', origin, step })
  }
  if (values.length < 2) return Object.freeze({ type: 'lookup', values })
  const origin = values[0]
  const second = values[1]
  if (origin === undefined || second === undefined) {
    throw invalidInput(`NCEM EMD dimension ${JSON.stringify(path)} is incomplete`)
  }
  const step = second - origin
  if (step !== 0 && values.every((value, index) => value === origin + index * step)) {
    return Object.freeze({ type: 'linear', origin, step })
  }
  return Object.freeze({ type: 'lookup', values })
}

const stringAttribute = (
  attributes: readonly Hdf5Attribute[] | undefined,
  name: string,
): string | undefined => {
  const value = attribute(attributes, name)
  if (value === undefined) return undefined
  const decoded = hdf5StringAttributeValue(value)
  return decoded.length === 0 ? undefined : decoded
}

const numericMetadataValues = (value: Readonly<Hdf5Attribute>): readonly number[] => {
  if (value.datatype.kind !== 'integer' && value.datatype.kind !== 'float') {
    throw invalidInput(`NCEM EMD metadata attribute ${JSON.stringify(value.name)} is not numeric`)
  }
  const output: number[] = []
  for (let index = 0; index < value.dataspace.elementCount; index += 1) {
    const decoded = numericValue(value.data, index * value.datatype.byteLength, value.datatype)
    if (!Number.isFinite(decoded)) {
      throw invalidInput(`NCEM EMD metadata attribute ${JSON.stringify(value.name)} is non-finite`)
    }
    output.push(decoded)
  }
  return Object.freeze(output)
}

const fixedStringMetadataValues = (value: Readonly<Hdf5Attribute>): readonly string[] => {
  if (value.datatype.kind !== 'fixed-string') {
    throw invalidInput(
      `NCEM EMD metadata attribute ${JSON.stringify(value.name)} is not a fixed string array`,
    )
  }
  const output: string[] = []
  const scalarDimensions: readonly [] = Object.freeze([])
  for (let index = 0; index < value.dataspace.elementCount; index += 1) {
    const start = index * value.datatype.byteLength
    output.push(
      hdf5StringAttributeValue(
        Object.freeze({
          ...value,
          dataspace: Object.freeze({
            kind: 'scalar',
            version: value.dataspace.version,
            rank: 0,
            dimensions: scalarDimensions,
            maximumDimensions: scalarDimensions,
            elementCount: 1,
          }),
          data: value.data.slice(start, start + value.datatype.byteLength),
        }),
      ),
    )
  }
  return Object.freeze(output)
}

const metadataValue = (value: Readonly<Hdf5Attribute>): NcemEmdMetadataValue => {
  if (value.dataspace.elementCount !== 1) {
    if (value.datatype.kind === 'integer' || value.datatype.kind === 'float') {
      return numericMetadataValues(value)
    }
    if (value.datatype.kind === 'fixed-string') return fixedStringMetadataValues(value)
    throw unsupportedOperation(
      `NCEM EMD metadata attribute ${JSON.stringify(value.name)} uses an unsupported non-scalar datatype`,
    )
  }
  if (value.datatype.kind === 'integer') {
    const integer = hdf5IntegerAttributeValue(value)
    if (integer < BigInt(Number.MIN_SAFE_INTEGER) || integer > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw unsupportedOperation(
        `NCEM EMD metadata attribute ${JSON.stringify(value.name)} exceeds the exact integer range`,
      )
    }
    return Number(integer)
  }
  if (value.datatype.kind === 'float') {
    const float = hdf5FloatAttributeValue(value)
    if (!Number.isFinite(float)) {
      throw invalidInput(`NCEM EMD metadata attribute ${JSON.stringify(value.name)} is non-finite`)
    }
    return float
  }
  if (value.datatype.kind === 'fixed-string' || value.datatype.kind === 'variable-string') {
    return hdf5StringAttributeValue(value)
  }
  throw unsupportedOperation(
    `NCEM EMD metadata attribute ${JSON.stringify(value.name)} is not a scalar number or string`,
  )
}

const metadataSequenceBytes = (value: readonly string[] | readonly number[]): number => {
  let bytes = 0
  for (const entry of value) {
    bytes += typeof entry === 'string' ? new TextEncoder().encode(entry).byteLength : 8
  }
  return bytes
}

const metadataValueBytes = (name: string, value: NcemEmdMetadataValue): number =>
  new TextEncoder().encode(name).byteLength +
  (typeof value === 'string'
    ? new TextEncoder().encode(value).byteLength
    : typeof value === 'number'
      ? 8
      : metadataSequenceBytes(value))

const acquisitionMetadata = async (
  file: Hdf5File,
  limits: ResolvedLimits,
  signal: AbortSignal | undefined,
): Promise<NcemEmdAcquisitionMetadata> => {
  const groups = ['microscope', 'sample', 'user', 'comments'] as const
  const output: Partial<
    Record<(typeof groups)[number], Readonly<Record<string, NcemEmdMetadataValue>>>
  > = {}
  let entries = 0
  let bytes = 0
  for (const group of groups) {
    throwIfAborted(signal)
    const path = `/${group}`
    const object = await file.get(path, signal === undefined ? {} : { signal })
    if (object === undefined) continue
    if (object.kind !== 'group') {
      throw invalidInput(`NCEM EMD metadata object ${JSON.stringify(path)} is not a group`)
    }
    const attributes = await file.attributes(
      path,
      undefined,
      signal === undefined ? {} : { signal },
    )
    if (attributes === undefined) continue
    const values: Array<readonly [string, NcemEmdMetadataValue]> = []
    for (const metadataAttribute of attributes) {
      entries += 1
      if (entries > limits.maxMetadataEntries) {
        throw limitExceeded(`NCEM EMD metadata exceeds ${limits.maxMetadataEntries} entries`)
      }
      const value = metadataValue(metadataAttribute)
      bytes += metadataValueBytes(metadataAttribute.name, value)
      if (bytes > limits.maxMetadataBytes) {
        throw limitExceeded(`NCEM EMD metadata exceeds ${limits.maxMetadataBytes} bytes`)
      }
      values.push(Object.freeze([metadataAttribute.name, value]))
    }
    output[group] = Object.freeze(Object.fromEntries(values))
  }
  return Object.freeze(output)
}

const inspectNumericGroup = async (
  file: Hdf5File,
  path: string,
  children: ReadonlyMap<string, Hdf5Object>,
  maximumDimensionValues: number,
  totalDimensionValues: number,
  dimensionValueBudget: DimensionValueBudget,
  signal: AbortSignal | undefined,
): Promise<NcemEmdNumericGroup> => {
  const data = children.get('data')
  if (!numericDataset(data)) {
    throw invalidInput(`NCEM EMD numeric group ${JSON.stringify(path)} has no numeric data dataset`)
  }
  const rank = data.metadata.dataspace.rank
  if (rank < 1)
    throw unsupportedOperation(`NCEM EMD numeric group ${JSON.stringify(path)} is scalar`)
  const dimensions = [...children.entries()]
    .map(([name, object]) => ({ index: dimensionIndex(name), name, object }))
    .filter(
      (entry): entry is Readonly<{ index: number; name: string; object: Hdf5Object }> =>
        entry.index !== undefined,
    )
    .sort((left, right) => left.index - right.index)
  if (dimensions.length !== rank) {
    throw invalidInput(
      `NCEM EMD numeric group ${JSON.stringify(path)} has ${dimensions.length} dimensions for rank ${rank}`,
    )
  }
  const dimensionPaths: string[] = []
  const inspectedDimensions: NcemEmdDimension[] = []
  for (let axis = 0; axis < rank; axis += 1) {
    const dimension = dimensions[axis]
    const expectedIndex = axis + 1
    if (dimension === undefined || dimension.index !== expectedIndex) {
      throw invalidInput(
        `NCEM EMD numeric group ${JSON.stringify(path)} is missing dim${expectedIndex}`,
      )
    }
    if (!numericDataset(dimension.object)) {
      throw invalidInput(
        `NCEM EMD dimension ${JSON.stringify(childPath(path, dimension.name))} is not numeric`,
      )
    }
    const dataspace = dimension.object.metadata.dataspace
    const extent = data.metadata.dataspace.dimensions[axis]
    if (
      extent === undefined ||
      dataspace.rank !== 1 ||
      dataspace.dimensions[0] === undefined ||
      (dataspace.dimensions[0] !== 2 && dataspace.dimensions[0] !== extent)
    ) {
      throw invalidInput(
        `NCEM EMD dimension ${JSON.stringify(childPath(path, dimension.name))} has invalid extent`,
      )
    }
    const pathValue = childPath(path, dimension.name)
    const dimensionValueCount = dataspace.dimensions[0]
    if (dimensionValueCount === undefined) {
      throw invalidInput(`NCEM EMD dimension ${JSON.stringify(pathValue)} has no extent`)
    }
    if (dimensionValueBudget.used > totalDimensionValues - dimensionValueCount) {
      throw limitExceeded(`NCEM EMD dimension values exceed the file limit ${totalDimensionValues}`)
    }
    dimensionValueBudget.used += dimensionValueCount
    const attributes = await file.attributes(
      pathValue,
      ['name', 'units'],
      signal === undefined ? {} : { signal },
    )
    const values = await readDimensionValues(
      file,
      dimension.object,
      pathValue,
      maximumDimensionValues,
      signal,
    )
    dimensionPaths.push(pathValue)
    inspectedDimensions.push(
      Object.freeze({
        path: pathValue,
        name: stringAttribute(attributes, 'name'),
        unit: stringAttribute(attributes, 'units'),
        length: extent,
        coordinates: dimensionCoordinates(values, extent, pathValue),
      }),
    )
  }
  return Object.freeze({
    path,
    dataPath: childPath(path, 'data'),
    dimensionPaths: Object.freeze(dimensionPaths),
    dimensions: Object.freeze(inspectedDimensions),
    shape: data.metadata.dataspace.dimensions,
  })
}

export const inspectNcemEmd = async (
  file: Hdf5File,
  options: Readonly<NcemEmdInspectionOptions> = {},
): Promise<NcemEmdInspection> => {
  throwIfAborted(options.signal)
  const limits = resolveLimits(options)
  const rootAttributes = await file.attributes(
    '/',
    ['version_major', 'version_minor'],
    options.signal === undefined ? {} : { signal: options.signal },
  )
  const major = ncemEmdVersionPart(attribute(rootAttributes, 'version_major'), 'version_major')
  const minor = ncemEmdVersionPart(attribute(rootAttributes, 'version_minor'), 'version_minor')
  if (major !== 0 || minor !== 2) {
    throw unsupportedOperation(`NCEM EMD version ${major}.${minor} is not supported by E1 yet`)
  }
  const roots: PendingGroup[] = []
  for (const path of ['/data', '/signals']) {
    const root = await file.get(
      path,
      options.signal === undefined ? {} : { signal: options.signal },
    )
    if (root?.kind === 'group') roots.push({ path, depth: 0, object: root })
  }
  if (roots.length === 0) {
    throw invalidInput('NCEM EMD version 0.2 must contain a /data or /signals group')
  }

  const pending: PendingGroup[] = [...roots]
  const visited = new Set<bigint>()
  const numericGroups: NcemEmdNumericGroup[] = []
  const dimensionValueBudget: DimensionValueBudget = { used: 0 }
  let objects = 0
  while (pending.length > 0) {
    throwIfAborted(options.signal)
    const current = pending.shift()
    if (current === undefined || visited.has(current.object.address)) continue
    visited.add(current.object.address)
    const links = await file.list(
      current.path,
      options.signal === undefined ? {} : { signal: options.signal },
    )
    const children = new Map<string, Hdf5Object>()
    for (const link of links) {
      throwIfAborted(options.signal)
      if (link.kind !== 'hard') continue
      if (link.name.includes('/')) {
        throw invalidInput(`NCEM EMD link ${JSON.stringify(link.name)} contains a path separator`)
      }
      objects += 1
      if (objects > limits.maxObjects) {
        throw limitExceeded(`NCEM EMD traversal exceeds ${limits.maxObjects} objects`)
      }
      const path = childPath(current.path, link.name)
      const object = await file.get(
        path,
        options.signal === undefined ? {} : { signal: options.signal },
      )
      if (object === undefined)
        throw invalidInput(`NCEM EMD hard link ${JSON.stringify(path)} is missing`)
      children.set(link.name, object)
      if (object.kind === 'group' && !visited.has(object.address)) {
        const depth = current.depth + 1
        if (depth > limits.maxDepth) {
          throw limitExceeded(`NCEM EMD traversal exceeds depth ${limits.maxDepth}`)
        }
        pending.push({ path, depth, object })
      }
    }
    const attributes = await file.attributes(
      current.path,
      ['emd_group_type'],
      options.signal === undefined ? {} : { signal: options.signal },
    )
    const groupType = attribute(attributes, 'emd_group_type')
    if (groupType === undefined) continue
    if (hdf5IntegerAttributeValue(groupType) !== 1n) continue
    if (numericGroups.length >= limits.maxNumericGroups) {
      throw limitExceeded(`NCEM EMD file exceeds ${limits.maxNumericGroups} numeric groups`)
    }
    numericGroups.push(
      await inspectNumericGroup(
        file,
        current.path,
        children,
        limits.maxDimensionValues,
        limits.maxTotalDimensionValues,
        dimensionValueBudget,
        options.signal,
      ),
    )
  }
  if (numericGroups.length === 0) {
    throw invalidInput('NCEM EMD version 0.2 contains no numeric groups')
  }
  numericGroups.sort((left, right) => left.path.localeCompare(right.path))
  const metadata = await acquisitionMetadata(file, limits, options.signal)
  return Object.freeze({
    version: Object.freeze({ major: 0, minor: 2 }),
    numericGroups: Object.freeze(numericGroups),
    metadata,
  })
}
