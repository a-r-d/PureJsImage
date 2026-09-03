import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { JpegCoefficientComponent, JpegCoefficientImage } from './jpeg-coefficients.ts'
import type { JpegXlLimits } from './jpegxl-limits.ts'
import {
  JpegXlBitWriter,
  type AnsEncoding,
  hybridTokenForEncoding,
  packSigned,
  type PrefixEncoding,
  writeAnsCode,
  writeAnsValues,
  writeHybridUint,
  writeModularHeader,
  writeModularTree,
  writePrefixCode,
  writeU32,
} from './jpegxl-modular-encode.ts'

interface Plane {
  readonly width: number
  readonly height: number
  readonly values: Int32Array
}

interface JpegDerivedGeometry {
  readonly colorTransform: 'none' | 'ycbcr'
  readonly chromaSubsampling: readonly [number, number, number]
  readonly shifts: readonly (readonly [number, number])[]
  readonly fullBlockWidth: number
  readonly fullBlockHeight: number
  readonly groupsAcross: number
  readonly groupsDown: number
  readonly dcGroupsAcross: number
  readonly dcGroupsDown: number
  readonly internalComponents: readonly JpegCoefficientComponent[]
  readonly dcPlaneComponents: readonly JpegCoefficientComponent[]
  readonly quantization: readonly Int32Array[]
}

const tokenFor = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 131_071) {
    throw invalidInput('JPEG-derived JPEG XL entropy value is outside the supported range')
  }
  return value < 256 ? value : 256 + Math.floor(Math.log2(value)) - 8
}

const addFrequency = (frequencies: Uint32Array, value: number): void => {
  const token = tokenFor(value)
  frequencies[token] = (frequencies[token] ?? 0) + 1
}

const visitPlaneResiduals = (plane: Readonly<Plane>, visit: (value: number) => void): void => {
  for (let y = 0; y < plane.height; y += 1) {
    for (let x = 0; x < plane.width; x += 1) {
      const index = y * plane.width + x
      const sample = plane.values[index]
      if (sample === undefined) throw invalidInput('JPEG-derived JPEG XL plane is incomplete')
      const left =
        x > 0
          ? (plane.values[index - 1] ?? 0)
          : y > 0
            ? (plane.values[index - plane.width] ?? 0)
            : 0
      const top = y > 0 ? (plane.values[index - plane.width] ?? 0) : left
      visit(packSigned(sample - Math.trunc((left + top) / 2)))
    }
  }
}

const writePlanes = (
  writer: JpegXlBitWriter,
  planes: readonly Plane[],
  encoding: Readonly<ModularEncoding>,
): void => {
  writeModularHeader(writer, true)
  if (encoding.kind === 'prefix') {
    for (const plane of planes) {
      visitPlaneResiduals(plane, (value) => writeHybridUint(writer, value, encoding.encoding))
    }
    return
  }
  const count = planes.reduce((total, plane) => total + plane.values.length, 0)
  const values = new Uint32Array(count)
  const contexts = new Uint16Array(count)
  let offset = 0
  for (const plane of planes) {
    visitPlaneResiduals(plane, (value) => {
      values[offset] = value
      offset += 1
    })
  }
  writeAnsValues(writer, values, contexts, count, encoding.encoding)
}

const collectPlanes = (frequencies: Uint32Array, planes: readonly Plane[], ans = false): void => {
  for (const plane of planes)
    visitPlaneResiduals(plane, (value) => {
      if (ans) {
        const token = hybridTokenForEncoding(value, acHybridConfig)
        frequencies[token] = (frequencies[token] ?? 0) + 1
      } else {
        addFrequency(frequencies, value)
      }
    })
}

const transpose = (table: Int32Array): Int32Array => {
  if (table.length !== 64)
    throw unsupportedOperation('Exact JPEG transcode requires 8x8 quantization tables')
  const output = new Int32Array(64)
  for (let position = 0; position < 64; position += 1) {
    output[position] = table[(position & 7) * 8 + (position >>> 3)] ?? 0
  }
  return output
}

const samplingExponent = (maximum: number, value: number): number => {
  if (value < 1 || maximum < value || maximum % value !== 0) {
    throw unsupportedOperation('Exact JPEG transcode requires regular chroma sampling factors')
  }
  const ratio = maximum / value
  const exponent = Math.log2(ratio)
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 1) {
    throw unsupportedOperation(
      'Exact JPEG transcode initially supports 4:4:4, 4:2:2, or 4:2:0 sampling',
    )
  }
  return exponent
}

const subsamplingMode = (horizontal: number, vertical: number): number => {
  if (horizontal === 0 && vertical === 0) return 0
  if (horizontal === 1 && vertical === 1) return 1
  if (horizontal === 1 && vertical === 0) return 2
  if (horizontal === 0 && vertical === 1) return 3
  throw unsupportedOperation('Exact JPEG transcode chroma sampling mode is unsupported')
}

const geometryFor = (image: JpegCoefficientImage): JpegDerivedGeometry => {
  if (
    image.components.length !== 3 ||
    (image.colorTransform !== 'ycbcr' && image.colorTransform !== 'rgb')
  ) {
    throw unsupportedOperation(
      'Exact JPEG transcode initially requires RGB or YCbCr three-component JPEG',
    )
  }
  const colorTransform = image.colorTransform === 'ycbcr' ? 'ycbcr' : 'none'
  const componentShifts = image.components.map((component) =>
    Object.freeze([
      samplingExponent(image.maximumHorizontalSampling, component.horizontalSampling),
      samplingExponent(image.maximumVerticalSampling, component.verticalSampling),
    ] as const),
  )
  const maximumShiftX = Math.max(...componentShifts.map(([horizontal]) => horizontal))
  const maximumShiftY = Math.max(...componentShifts.map(([, vertical]) => vertical))
  const rawForComponent = componentShifts.map(([horizontal, vertical]) =>
    Object.freeze([maximumShiftX - horizontal, maximumShiftY - vertical] as const),
  )
  const componentForInternal = colorTransform === 'ycbcr' ? [1, 0, 2] : [0, 1, 2]
  const internalComponents = componentForInternal.map((index) => image.components[index])
  if (internalComponents.some((component) => component === undefined)) {
    throw invalidInput('JPEG component mapping is incomplete')
  }
  const chromaSubsampling = internalComponents.map((component) => {
    const sourceIndex = image.components.indexOf(component as JpegCoefficientComponent)
    const raw = rawForComponent[sourceIndex]
    if (!raw) throw invalidInput('JPEG sampling descriptor is missing')
    return subsamplingMode(raw[0], raw[1])
  }) as [number, number, number]
  const rawInternal = chromaSubsampling.map((mode): readonly [number, number] => {
    if (mode === 0) return Object.freeze([0, 0])
    if (mode === 1) return Object.freeze([1, 1])
    if (mode === 2) return Object.freeze([1, 0])
    return Object.freeze([0, 1])
  })
  const maximumRawX = Math.max(...rawInternal.map(([horizontal]) => horizontal))
  const maximumRawY = Math.max(...rawInternal.map(([, vertical]) => vertical))
  const shifts = rawInternal.map(([horizontal, vertical]) =>
    Object.freeze([maximumRawX - horizontal, maximumRawY - vertical] as const),
  )
  const fullBlockWidth = Math.ceil(Math.ceil(image.width / 8) / 2 ** maximumRawX) * 2 ** maximumRawX
  const fullBlockHeight =
    Math.ceil(Math.ceil(image.height / 8) / 2 ** maximumRawY) * 2 ** maximumRawY
  const dcPlaneIndexes = colorTransform === 'ycbcr' ? [0, 1, 2] : [1, 0, 2]
  const dcPlaneComponents = dcPlaneIndexes.map((index) => image.components[index])
  if (dcPlaneComponents.some((component) => component === undefined)) {
    throw invalidInput('JPEG DC component mapping is incomplete')
  }
  const quantization = internalComponents.map((component) =>
    transpose((component as JpegCoefficientComponent).quantization),
  )
  return Object.freeze({
    colorTransform,
    chromaSubsampling: Object.freeze(chromaSubsampling),
    shifts: Object.freeze(shifts),
    fullBlockWidth,
    fullBlockHeight,
    groupsAcross: Math.ceil(fullBlockWidth / 32),
    groupsDown: Math.ceil(fullBlockHeight / 32),
    dcGroupsAcross: Math.ceil(fullBlockWidth / 256),
    dcGroupsDown: Math.ceil(fullBlockHeight / 256),
    internalComponents: Object.freeze(internalComponents as JpegCoefficientComponent[]),
    dcPlaneComponents: Object.freeze(dcPlaneComponents as JpegCoefficientComponent[]),
    quantization: Object.freeze(quantization),
  })
}

const componentDcPlane = (
  component: JpegCoefficientComponent,
  originX: number,
  originY: number,
  width: number,
  height: number,
  offset: number,
): Plane => {
  const values = new Int32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = ((originY + y) * component.blocksPerLineForMcu + originX + x) * 64
      values[y * width + x] = (component.coefficients[source] ?? 0) + offset
    }
  }
  return Object.freeze({ width, height, values })
}

const dcGroupPlanes = (
  geometry: Readonly<JpegDerivedGeometry>,
  group: number,
): readonly Plane[] => {
  const groupX = group % geometry.dcGroupsAcross
  const groupY = Math.floor(group / geometry.dcGroupsAcross)
  const blockX = groupX * 256
  const blockY = groupY * 256
  const blockWidth = Math.min(256, geometry.fullBlockWidth - blockX)
  const blockHeight = Math.min(256, geometry.fullBlockHeight - blockY)
  const dcPlanes = geometry.dcPlaneComponents.map((component, planeIndex) => {
    const internalChannel = planeIndex < 2 ? planeIndex ^ 1 : planeIndex
    const shift = geometry.shifts[internalChannel]
    const quantization = geometry.quantization[internalChannel]
    if (!shift || !quantization) throw invalidInput('JPEG DC channel geometry is missing')
    const rgbOffset =
      geometry.colorTransform === 'none' ? Math.floor(1024 / (quantization[0] ?? 0)) : 0
    return componentDcPlane(
      component,
      blockX >> shift[0],
      blockY >> shift[1],
      blockWidth >> shift[0],
      blockHeight >> shift[1],
      rgbOffset,
    )
  })
  const correlationWidth = Math.ceil(blockWidth / 8)
  const correlationHeight = Math.ceil(blockHeight / 8)
  const metadata = [
    Object.freeze({
      width: correlationWidth,
      height: correlationHeight,
      values: new Int32Array(correlationWidth * correlationHeight),
    }),
    Object.freeze({
      width: correlationWidth,
      height: correlationHeight,
      values: new Int32Array(correlationWidth * correlationHeight),
    }),
    Object.freeze({
      width: blockWidth * blockHeight,
      height: 2,
      values: new Int32Array(blockWidth * blockHeight * 2),
    }),
    Object.freeze({
      width: blockWidth,
      height: blockHeight,
      values: new Int32Array(blockWidth * blockHeight),
    }),
  ]
  return Object.freeze([...dcPlanes, ...metadata])
}

const writeDcGroup = (
  writer: JpegXlBitWriter,
  planes: readonly Plane[],
  encoding: Readonly<ModularEncoding>,
): void => {
  writer.writeBits(0, 2)
  writePlanes(writer, planes.slice(0, 3), encoding)
  const blockCount = planes[6]?.values.length ?? 0
  if (blockCount < 1) throw invalidInput('JPEG XL DC group metadata is empty')
  writer.writeBits(blockCount - 1, Math.ceil(Math.log2(blockCount)))
  writePlanes(writer, planes.slice(3), encoding)
}

const writeF16 = (writer: JpegXlBitWriter, value: number): void => {
  if (!Number.isFinite(value) || value < 0)
    throw invalidInput('JPEG XL half-precision value is invalid')
  if (value === 0) {
    writer.writeBits(0, 16)
    return
  }
  let exponent = Math.floor(Math.log2(value))
  let mantissa = Math.round((value / 2 ** exponent - 1) * 1024)
  if (mantissa === 1024) {
    exponent += 1
    mantissa = 0
  }
  const encodedExponent = exponent + 15
  if (encodedExponent <= 0 || encodedExponent >= 31) {
    throw invalidInput('JPEG XL half-precision value is outside the supported encoder range')
  }
  writer.writeBits((encodedExponent << 10) | mantissa, 16)
}

const writeLfGlobal = (
  writer: JpegXlBitWriter,
  frequencies: Uint32Array,
  geometry: Readonly<JpegDerivedGeometry>,
  useAns: boolean,
): ModularEncoding => {
  writer.writeBits(0, 1)
  for (const quantization of geometry.quantization) {
    const dc = quantization[0]
    if (!dc || dc < 1) throw invalidInput('JPEG DC quantization value is invalid')
    writeF16(writer, (dc * 16) / 255)
  }
  writeU32(writer, 65_536, [
    { bits: 11, offset: 1 },
    { bits: 11, offset: 2_049 },
    { bits: 12, offset: 4_097 },
    { bits: 16, offset: 8_193 },
  ])
  writeU32(writer, 1, [
    { value: 16 },
    { bits: 5, offset: 1 },
    { bits: 8, offset: 1 },
    { bits: 16, offset: 1 },
  ])
  writer.writeBits(1, 1)
  writer.writeBits(0, 1)
  writeU32(writer, 84, [
    { value: 84 },
    { value: 256 },
    { bits: 8, offset: 2 },
    { bits: 16, offset: 258 },
  ])
  writeF16(writer, 0)
  writeF16(writer, 0)
  writer.writeBits(128, 8)
  writer.writeBits(128, 8)
  writer.writeBits(1, 1)
  writeModularTree(writer, 3)
  return useAns
    ? Object.freeze({
        kind: 'ans',
        encoding: writeAnsCode(writer, Uint8Array.of(0), [frequencies], acHybridConfig),
      })
    : Object.freeze({ kind: 'prefix', encoding: writePrefixCode(writer, 1, frequencies) })
}

const quantizationPlanes = (geometry: Readonly<JpegDerivedGeometry>): readonly Plane[] =>
  Object.freeze(
    geometry.quantization.map((values) => Object.freeze({ width: 8, height: 8, values })),
  )

const naturalOrder = (): Uint32Array => {
  const order = new Uint32Array(64)
  let next = 1
  order[0] = 0
  for (let diagonal = 1; diagonal < 15; diagonal += 1) {
    for (let step = 0; step <= diagonal; step += 1) {
      let x = step
      let y = diagonal - step
      if ((diagonal & 1) !== 0) [x, y] = [y, x]
      if (x < 8 && y < 8) order[next++] = y * 8 + x
    }
  }
  return order
}

const order = naturalOrder()
const transposed = (position: number): number => (position & 7) * 8 + (position >>> 3)
const naturalJpegXlOrder = Uint32Array.from(order, transposed)

const optimizedCoefficientOrders = (
  geometry: Readonly<JpegDerivedGeometry>,
): readonly Uint32Array[] =>
  Object.freeze(
    geometry.internalComponents.map((component) => {
      const nonzero = new Uint32Array(64)
      const blocks = component.blocksPerLineForMcu * component.blocksPerColumnForMcu
      for (let block = 0; block < blocks; block += 1) {
        const base = block * 64
        for (let scan = 1; scan < 64; scan += 1) {
          const position = naturalJpegXlOrder[scan] ?? 0
          if ((component.coefficients[base + position] ?? 0) !== 0) {
            nonzero[position] = (nonzero[position] ?? 0) + 1
          }
        }
      }
      const positions = Array.from({ length: 63 }, (_, index) => index + 1)
      positions.sort(
        (left, right) =>
          (nonzero[right] ?? 0) - (nonzero[left] ?? 0) ||
          naturalJpegXlOrder.indexOf(left) - naturalJpegXlOrder.indexOf(right),
      )
      return Uint32Array.from([0, ...positions])
    }),
  )

const coefficientFrequencyContext = new Uint16Array([
  0xbad, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 15, 16, 16, 17, 17, 18, 18, 19, 19,
  20, 20, 21, 21, 22, 22, 23, 23, 23, 23, 24, 24, 24, 24, 25, 25, 25, 25, 26, 26, 26, 26, 27, 27,
  27, 27, 28, 28, 28, 28, 29, 29, 29, 29, 30, 30, 30, 30,
])

const coefficientNonzeroContext = new Uint16Array([
  0xbad, 0, 31, 62, 62, 93, 93, 93, 93, 123, 123, 123, 123, 152, 152, 152, 152, 152, 152, 152, 152,
  180, 180, 180, 180, 180, 180, 180, 180, 180, 180, 180, 180, 206, 206, 206, 206, 206, 206, 206,
  206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206, 206,
  206, 206, 206, 206, 206,
])

const predictNonzeroCount = (plane: Int32Array, width: number, x: number, y: number): number => {
  if (x === 0) return y === 0 ? 32 : (plane[(y - 1) * width] ?? 32)
  const left = plane[y * width + x - 1] ?? 32
  if (y === 0) return left
  return Math.floor(((plane[(y - 1) * width + x] ?? 32) + left + 1) / 2)
}

const acContextMap = (): Uint8Array => {
  const map = new Uint8Array(15 * (37 + 458))
  for (let context = 0; context < map.length; context += 1) {
    if (context < 15 * 37) {
      const predictedBucket = Math.floor(context / 15)
      const blockContext = context % 15
      const predictionCluster = Math.min(7, Math.floor(predictedBucket / 5))
      map[context] = (blockContext === 0 ? 0 : 8) + predictionCluster
      continue
    }
    const coefficientContext = context - 15 * 37
    const blockContext = Math.floor(coefficientContext / 458)
    const withinBlockContext = coefficientContext % 458
    const previous = withinBlockContext & 1
    const densityAndFrequency = withinBlockContext >>> 1
    const densityBucket = Math.min(59, Math.floor(densityAndFrequency / 4))
    const componentBucket = blockContext === 0 ? 0 : 1
    map[context] = 16 + componentBucket * 120 + previous * 60 + densityBucket
  }
  const remapped = new Uint8Array(map.length)
  const compactIndexes = new Map<number, number>()
  let next = 0
  for (let context = 0; context < map.length; context += 1) {
    const cluster = map[context] ?? 0
    let compact = compactIndexes.get(cluster)
    if (compact === undefined) {
      compact = next
      compactIndexes.set(cluster, compact)
      next += 1
    }
    remapped[context] = compact
  }
  return remapped
}

const clusteredAcContextMap = acContextMap()
const clusteredAcHistogramCount =
  clusteredAcContextMap.reduce((maximum, histogram) => Math.max(maximum, histogram), 0) + 1
const acHybridConfig = Object.freeze({ splitExponent: 4, msbInToken: 2, lsbInToken: 0 })

type AcEncoding =
  | Readonly<{ readonly kind: 'prefix'; readonly encoding: PrefixEncoding }>
  | Readonly<{ readonly kind: 'ans'; readonly encoding: AnsEncoding }>

type ModularEncoding = AcEncoding

const visitAcGroup = (
  geometry: Readonly<JpegDerivedGeometry>,
  coefficientOrders: readonly Uint32Array[],
  group: number,
  visit: (value: number, context: number) => void,
): void => {
  const groupX = group % geometry.groupsAcross
  const groupY = Math.floor(group / geometry.groupsAcross)
  const blockX = groupX * 32
  const blockY = groupY * 32
  const blockWidth = Math.min(32, geometry.fullBlockWidth - blockX)
  const blockHeight = Math.min(32, geometry.fullBlockHeight - blockY)
  const nonzeroPlanes = geometry.internalComponents.map((_, channel) => {
    const shift = geometry.shifts[channel]
    if (!shift) throw invalidInput('JPEG XL AC channel geometry is missing')
    return new Int32Array((blockWidth >> shift[0]) * (blockHeight >> shift[1]))
  })
  for (let y = 0; y < blockHeight; y += 1) {
    for (let x = 0; x < blockWidth; x += 1) {
      for (const channel of [1, 0, 2]) {
        const shift = geometry.shifts[channel]
        const component = geometry.internalComponents[channel]
        if (
          !shift ||
          !component ||
          (x & (2 ** shift[0] - 1)) !== 0 ||
          (y & (2 ** shift[1] - 1)) !== 0
        )
          continue
        const componentX = (blockX + x) >> shift[0]
        const componentY = (blockY + y) >> shift[1]
        const base = (componentY * component.blocksPerLineForMcu + componentX) * 64
        const localX = x >> shift[0]
        const localY = y >> shift[1]
        const localWidth = blockWidth >> shift[0]
        const nonzeroPlane = nonzeroPlanes[channel]
        const coefficientOrder = coefficientOrders[channel]
        if (!nonzeroPlane || !coefficientOrder) {
          throw invalidInput('JPEG XL AC channel model is missing')
        }
        let lastNonzero = 0
        for (let scan = 1; scan < 64; scan += 1) {
          const position = coefficientOrder[scan] ?? 0
          if ((component.coefficients[base + position] ?? 0) !== 0) lastNonzero = scan
        }
        let nonzero = 0
        for (let scan = 1; scan <= lastNonzero; scan += 1) {
          const position = coefficientOrder[scan] ?? 0
          if ((component.coefficients[base + position] ?? 0) !== 0) nonzero += 1
        }
        const predicted = predictNonzeroCount(nonzeroPlane, localWidth, localX, localY)
        const blockContext = channel === 1 ? 0 : 7
        const nonzeroBucket =
          predicted < 8 ? predicted : 4 + Math.floor(Math.min(64, predicted) / 2)
        visit(nonzero, nonzeroBucket * 15 + blockContext)
        nonzeroPlane[localY * localWidth + localX] = nonzero
        let remainingNonzero = nonzero
        let previous = nonzero > 4 ? 0 : 1
        for (let scan = 1; scan <= lastNonzero; scan += 1) {
          const position = coefficientOrder[scan] ?? 0
          const coefficient = component.coefficients[base + position] ?? 0
          if (coefficient < -4_095 || coefficient > 4_095) {
            throw unsupportedOperation(
              'Exact JPEG transcode AC coefficient exceeds the JPEG XL subset',
            )
          }
          const remainingContext = coefficientNonzeroContext[remainingNonzero]
          const frequencyContext = coefficientFrequencyContext[scan]
          if (remainingContext === undefined || frequencyContext === undefined) {
            throw invalidInput('JPEG XL AC coefficient context is invalid')
          }
          const coefficientContext =
            15 * 37 + 458 * blockContext + (remainingContext + frequencyContext) * 2 + previous
          visit(packSigned(coefficient), coefficientContext)
          previous = coefficient === 0 ? 0 : 1
          remainingNonzero -= previous
        }
      }
    }
  }
}

const writeHfGlobal = (
  writer: JpegXlBitWriter,
  geometry: Readonly<JpegDerivedGeometry>,
  coefficientOrders: readonly Uint32Array[],
  useClusteredAns: boolean,
  modularEncoding: Readonly<ModularEncoding>,
  acFrequencies: readonly Uint32Array[],
): AcEncoding => {
  writer.writeBits(0, 1)
  for (let table = 0; table < 17; table += 1) {
    writer.writeBits(table === 0 ? 7 : 0, 3)
    if (table !== 0) continue
    writeF16(writer, 1 / (8 * 255))
    writePlanes(writer, quantizationPlanes(geometry), modularEncoding)
  }
  const groupCount = geometry.groupsAcross * geometry.groupsDown
  const histogramBits = Math.ceil(Math.log2(groupCount))
  if (histogramBits !== 0) writer.writeBits(0, histogramBits)
  if (!useClusteredAns) {
    writeU32(writer, 0, [{ value: 0x5f }, { value: 0x13 }, { value: 0 }, { bits: 13, offset: 0 }])
  } else {
    writeU32(writer, 1, [{ value: 0x5f }, { value: 0x13 }, { value: 0 }, { bits: 13, offset: 0 }])
    const inverseNatural = new Uint8Array(64)
    for (let index = 0; index < naturalJpegXlOrder.length; index += 1) {
      inverseNatural[naturalJpegXlOrder[index] ?? 0] = index
    }
    const lehmerCodes = coefficientOrders.map((coefficientOrder) => {
      const available = Array.from({ length: 64 }, (_, index) => index)
      const codes = new Uint8Array(64)
      for (let index = 0; index < coefficientOrder.length; index += 1) {
        const naturalIndex = inverseNatural[coefficientOrder[index] ?? 0] ?? 0
        const selected = available.indexOf(naturalIndex)
        if (selected < 0) throw invalidInput('JPEG XL coefficient order is not a permutation')
        codes[index] = selected
        available.splice(selected, 1)
      }
      return codes
    })
    const orderFrequencies = new Uint32Array(512)
    for (const codes of lehmerCodes) {
      for (let index = 1; index < codes.length; index += 1) {
        addFrequency(orderFrequencies, codes[index] ?? 0)
      }
      addFrequency(orderFrequencies, codes.length - 1)
    }
    const orderEncoding = writePrefixCode(writer, 8, orderFrequencies)
    for (const codes of lehmerCodes) {
      writeHybridUint(writer, codes.length - 1, orderEncoding)
      for (let index = 1; index < codes.length; index += 1) {
        writeHybridUint(writer, codes[index] ?? 0, orderEncoding)
      }
    }
  }
  if (!useClusteredAns) {
    const combined = new Uint32Array(512)
    for (const frequencies of acFrequencies) {
      for (let token = 0; token < combined.length; token += 1) {
        combined[token] = (combined[token] ?? 0) + (frequencies[token] ?? 0)
      }
    }
    return Object.freeze({
      kind: 'prefix',
      encoding: writePrefixCode(writer, 15 * (37 + 458), combined),
    })
  }
  return Object.freeze({
    kind: 'ans',
    encoding: writeAnsCode(writer, clusteredAcContextMap, acFrequencies, acHybridConfig),
  })
}

const writeAcGroup = (
  writer: JpegXlBitWriter,
  geometry: Readonly<JpegDerivedGeometry>,
  coefficientOrders: readonly Uint32Array[],
  group: number,
  encoding: Readonly<AcEncoding>,
): void => {
  if (encoding.kind === 'prefix') {
    visitAcGroup(geometry, coefficientOrders, group, (value) =>
      writeHybridUint(writer, value, encoding.encoding),
    )
    return
  }
  const maximumValues = 3 * 64 * 32 * 32
  const values = new Uint32Array(maximumValues)
  const contexts = new Uint16Array(maximumValues)
  let count = 0
  visitAcGroup(geometry, coefficientOrders, group, (value, context) => {
    if (count >= maximumValues) throw invalidInput('JPEG XL AC group exceeds its token bound')
    values[count] = value
    contexts[count] = context
    count += 1
  })
  writeAnsValues(writer, values, contexts, count, encoding.encoding)
}

const finishSection = (write: (writer: JpegXlBitWriter) => void): Uint8Array => {
  const writer = new JpegXlBitWriter()
  write(writer)
  return writer.finish()
}

const encodeSections = (
  geometry: Readonly<JpegDerivedGeometry>,
  profiler?: JpegXlJpegEncodeProfiler,
): readonly Uint8Array[] => {
  const dcGroupCount = geometry.dcGroupsAcross * geometry.dcGroupsDown
  const groupCount = geometry.groupsAcross * geometry.groupsDown
  const useClusteredAns =
    groupCount > 1 && geometry.fullBlockWidth * geometry.fullBlockHeight >= 4_096
  const coefficientOrders = !useClusteredAns
    ? Object.freeze([naturalJpegXlOrder, naturalJpegXlOrder, naturalJpegXlOrder])
    : optimizedCoefficientOrders(geometry)
  let started = performance.now()
  const dcPlanes = Array.from({ length: dcGroupCount }, (_, group) =>
    dcGroupPlanes(geometry, group),
  )
  const modularFrequencies = new Uint32Array(512)
  for (const planes of dcPlanes) collectPlanes(modularFrequencies, planes, useClusteredAns)
  collectPlanes(modularFrequencies, quantizationPlanes(geometry), useClusteredAns)
  profiler?.record(
    'dc-representation',
    performance.now() - started,
    dcPlanes.reduce(
      (total, planes) => total + planes.reduce((sum, plane) => sum + plane.values.byteLength, 0),
      0,
    ),
  )
  started = performance.now()
  const acFrequencies = Array.from(
    { length: useClusteredAns ? clusteredAcHistogramCount : 1 },
    () => new Uint32Array(512),
  )
  for (let group = 0; group < groupCount; group += 1) {
    visitAcGroup(geometry, coefficientOrders, group, (value, context) => {
      const histogram = useClusteredAns ? clusteredAcContextMap[context] : 0
      const frequencies = histogram === undefined ? undefined : acFrequencies[histogram]
      if (!frequencies) throw invalidInput('JPEG XL AC frequency cluster is missing')
      if (!useClusteredAns) {
        addFrequency(frequencies, value)
      } else {
        const token = hybridTokenForEncoding(value, acHybridConfig)
        frequencies[token] = (frequencies[token] ?? 0) + 1
      }
    })
  }
  profiler?.record('ac-statistics', performance.now() - started, acFrequencies.length * 512 * 4)

  if (groupCount === 1) {
    started = performance.now()
    const section = finishSection((writer) => {
      const modularEncoding = writeLfGlobal(writer, modularFrequencies, geometry, useClusteredAns)
      writeDcGroup(writer, dcPlanes[0] ?? [], modularEncoding)
      const acEncoding = writeHfGlobal(
        writer,
        geometry,
        coefficientOrders,
        useClusteredAns,
        modularEncoding,
        acFrequencies,
      )
      writeAcGroup(writer, geometry, coefficientOrders, 0, acEncoding)
    })
    profiler?.record('ac-groups', performance.now() - started, section.byteLength)
    return Object.freeze([section])
  }
  let modularEncoding: ModularEncoding | undefined
  started = performance.now()
  const lf = finishSection((writer) => {
    modularEncoding = writeLfGlobal(writer, modularFrequencies, geometry, useClusteredAns)
  })
  profiler?.record('lf-global', performance.now() - started, lf.byteLength)
  if (!modularEncoding) throw invalidInput('JPEG XL Modular encoding was not initialized')
  started = performance.now()
  const dc = dcPlanes.map((planes) =>
    finishSection((writer) => writeDcGroup(writer, planes, modularEncoding as ModularEncoding)),
  )
  profiler?.record(
    'dc-groups',
    performance.now() - started,
    dc.reduce((total, section) => total + section.byteLength, 0),
  )
  let acEncoding: AcEncoding | undefined
  started = performance.now()
  const hf = finishSection((writer) => {
    acEncoding = writeHfGlobal(
      writer,
      geometry,
      coefficientOrders,
      useClusteredAns,
      modularEncoding as ModularEncoding,
      acFrequencies,
    )
  })
  profiler?.record('hf-global', performance.now() - started, hf.byteLength)
  if (!acEncoding) throw invalidInput('JPEG XL AC encoding was not initialized')
  started = performance.now()
  const ac = Array.from({ length: groupCount }, (_, group) =>
    finishSection((writer) =>
      writeAcGroup(writer, geometry, coefficientOrders, group, acEncoding as AcEncoding),
    ),
  )
  profiler?.record(
    'ac-groups',
    performance.now() - started,
    ac.reduce((total, section) => total + section.byteLength, 0),
  )
  return Object.freeze([lf, ...dc, hf, ...ac])
}

const writeU64 = (writer: JpegXlBitWriter, value: number): void => {
  if (value === 0) writer.writeBits(0, 2)
  else if (value <= 16) {
    writer.writeBits(1, 2)
    writer.writeBits(value - 1, 4)
  } else if (value <= 272) {
    writer.writeBits(2, 2)
    writer.writeBits(value - 17, 8)
  } else throw unsupportedOperation('JPEG XL encoder 64-bit field exceeds the initial subset')
}

const writeDimension = (writer: JpegXlBitWriter, dimension: number): void =>
  writeU32(writer, dimension, [
    { bits: 9, offset: 1 },
    { bits: 13, offset: 1 },
    { bits: 18, offset: 1 },
    { bits: 30, offset: 1 },
  ])

const concatenate = (parts: readonly Uint8Array[]): Uint8Array => {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0)
  if (!Number.isSafeInteger(length)) throw limitExceeded('JPEG XL output size overflows')
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

const codestreamFor = (
  image: JpegCoefficientImage,
  geometry: Readonly<JpegDerivedGeometry>,
  sections: readonly Uint8Array[],
): Uint8Array => {
  const writer = new JpegXlBitWriter()
  writer.writeBits(0xff, 8)
  writer.writeBits(0x0a, 8)
  writer.writeBits(0, 1)
  writeDimension(writer, image.height)
  writer.writeBits(0, 3)
  writeDimension(writer, image.width)
  writer.writeBits(0, 1)
  writer.writeBits(0, 1)
  writer.writeBits(0, 1)
  writeU32(writer, 8, [{ value: 8 }, { value: 10 }, { value: 12 }, { bits: 6, offset: 1 }])
  writer.writeBits(1, 1)
  writeU32(writer, 0, [{ value: 0 }, { value: 1 }, { bits: 4, offset: 2 }, { bits: 12, offset: 1 }])
  writer.writeBits(0, 1)
  writer.writeBits(1, 1)
  writeU64(writer, 0)
  writer.writeBits(1, 1)
  writer.alignToByte()

  writer.writeBits(0, 1)
  writeU32(writer, 0, [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }])
  writer.writeBits(0, 1)
  writeU64(writer, 128)
  writer.writeBits(geometry.colorTransform === 'ycbcr' ? 1 : 0, 1)
  if (geometry.colorTransform === 'ycbcr') {
    for (const mode of geometry.chromaSubsampling) writer.writeBits(mode, 2)
  }
  writeU32(writer, 1, [{ value: 1 }, { value: 2 }, { value: 4 }, { value: 8 }])
  writeU32(writer, 1, [{ value: 1 }, { value: 2 }, { value: 3 }, { bits: 3, offset: 4 }])
  writer.writeBits(0, 1)
  writeU32(writer, 0, [{ value: 0 }, { value: 1 }, { value: 2 }, { bits: 2, offset: 3 }])
  writer.writeBits(1, 1)
  writeU32(writer, 0, [
    { value: 0 },
    { bits: 4, offset: 0 },
    { bits: 5, offset: 16 },
    { bits: 10, offset: 48 },
  ])
  writer.writeBits(0, 1)
  writer.writeBits(0, 1)
  writer.writeBits(0, 2)
  writeU64(writer, 0)
  writeU64(writer, 0)
  writer.writeBits(0, 1)
  writer.alignToByte()
  for (const section of sections) {
    writeU32(writer, section.byteLength, [
      { bits: 10, offset: 0 },
      { bits: 14, offset: 1_024 },
      { bits: 22, offset: 17_408 },
      { bits: 30, offset: 4_211_712 },
    ])
  }
  writer.alignToByte()
  return concatenate([writer.finish(), ...sections])
}

const ascii = (value: string): Uint8Array =>
  Uint8Array.from(value, (character) => character.charCodeAt(0))

const uint32 = (value: number): Uint8Array =>
  Uint8Array.of((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255)

const box = (type: string, payload: Uint8Array): Uint8Array => {
  const size = payload.byteLength + 8
  if (size > 0xffff_ffff) throw limitExceeded(`JPEG XL ${type} box exceeds 32-bit size`)
  return concatenate([uint32(size), ascii(type), payload])
}

export interface JpegXlJpegEncodeMemoryLease {
  release(): void
}

export interface JpegXlJpegEncodeMemoryLedger {
  allocate(category: string, bytes: number): JpegXlJpegEncodeMemoryLease
}

export type JpegXlJpegEncodeStage =
  | 'geometry'
  | 'dc-representation'
  | 'ac-statistics'
  | 'lf-global'
  | 'dc-groups'
  | 'hf-global'
  | 'ac-groups'
  | 'codestream-assembly'
  | 'container-assembly'

export interface JpegXlJpegEncodeProfiler {
  record(stage: JpegXlJpegEncodeStage, milliseconds: number, bytes: number): void
}

export const encodeJpegCoefficientImageAsJpegXl = (
  image: JpegCoefficientImage,
  reconstructionPayload: Uint8Array,
  limits: Readonly<JpegXlLimits>,
  memory?: JpegXlJpegEncodeMemoryLedger,
  profiler?: JpegXlJpegEncodeProfiler,
): Uint8Array => {
  let started = performance.now()
  const geometry = geometryFor(image)
  profiler?.record('geometry', performance.now() - started, 0)
  const sections = encodeSections(geometry, profiler)
  const sectionLease = memory?.allocate(
    'jpeg-transcode-jxl-sections',
    sections.reduce((total, section) => total + section.byteLength, 0),
  )
  let codestreamLease: JpegXlJpegEncodeMemoryLease | undefined
  let outputLease: JpegXlJpegEncodeMemoryLease | undefined
  try {
    started = performance.now()
    const codestream = codestreamFor(image, geometry, sections)
    profiler?.record('codestream-assembly', performance.now() - started, codestream.byteLength)
    codestreamLease = memory?.allocate('jpeg-transcode-jxl-codestream', codestream.byteLength)
    sectionLease?.release()
    if (codestream.byteLength > limits.maxCodestreamBytes) {
      throw limitExceeded(
        `JPEG XL codestream has ${codestream.byteLength} bytes; maxCodestreamBytes is ${limits.maxCodestreamBytes}`,
      )
    }
    started = performance.now()
    const output = concatenate([
      Uint8Array.of(0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a),
      box('ftyp', concatenate([ascii('jxl '), uint32(0), ascii('jxl ')])),
      box('jbrd', reconstructionPayload),
      box('jxlc', codestream),
    ])
    profiler?.record('container-assembly', performance.now() - started, output.byteLength)
    outputLease = memory?.allocate('jpeg-transcode-output', output.byteLength)
    codestreamLease?.release()
    return output
  } catch (error) {
    sectionLease?.release()
    codestreamLease?.release()
    outputLease?.release()
    throw error
  }
}
