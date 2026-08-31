import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { JpegCoefficientComponent, JpegCoefficientImage } from './jpeg-coefficients.ts'
import type { JpegXlLimits } from './jpegxl-limits.ts'
import {
  JpegXlBitWriter,
  packSigned,
  type PrefixEncoding,
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
    let left = 0
    for (let x = 0; x < plane.width; x += 1) {
      const index = y * plane.width + x
      const sample = plane.values[index]
      if (sample === undefined) throw invalidInput('JPEG-derived JPEG XL plane is incomplete')
      if (x === 0 && y > 0) left = plane.values[index - plane.width] ?? 0
      visit(packSigned(sample - left))
      left = sample
    }
  }
}

const writePlanes = (
  writer: JpegXlBitWriter,
  planes: readonly Plane[],
  encoding: Readonly<PrefixEncoding>,
): void => {
  writeModularHeader(writer, true)
  for (const plane of planes) {
    visitPlaneResiduals(plane, (value) => writeHybridUint(writer, value, encoding))
  }
}

const collectPlanes = (frequencies: Uint32Array, planes: readonly Plane[]): void => {
  for (const plane of planes)
    visitPlaneResiduals(plane, (value) => addFrequency(frequencies, value))
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
    const rgbOffset = geometry.colorTransform === 'none' ? 1024 / (quantization[0] ?? 0) : 0
    if (!Number.isInteger(rgbOffset))
      throw unsupportedOperation('Exact JPEG RGB DC level shift is not integral')
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
  encoding: Readonly<PrefixEncoding>,
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
  colorTransform: JpegDerivedGeometry['colorTransform'],
): PrefixEncoding => {
  writer.writeBits(0, 1)
  const dcQuantization = colorTransform === 'ycbcr' ? 128 / 255 : 16 / 255
  writeF16(writer, dcQuantization)
  writeF16(writer, dcQuantization)
  writeF16(writer, dcQuantization)
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
  writeModularTree(writer)
  return writePrefixCode(writer, 1, frequencies)
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

const visitAcGroup = (
  geometry: Readonly<JpegDerivedGeometry>,
  group: number,
  visit: (value: number) => void,
): void => {
  const groupX = group % geometry.groupsAcross
  const groupY = Math.floor(group / geometry.groupsAcross)
  const blockX = groupX * 32
  const blockY = groupY * 32
  const blockWidth = Math.min(32, geometry.fullBlockWidth - blockX)
  const blockHeight = Math.min(32, geometry.fullBlockHeight - blockY)
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
        let lastNonzero = 0
        for (let scan = 1; scan < 64; scan += 1) {
          const position = transposed(order[scan] ?? 0)
          if ((component.coefficients[base + position] ?? 0) !== 0) lastNonzero = scan
        }
        let nonzero = 0
        for (let scan = 1; scan <= lastNonzero; scan += 1) {
          const position = transposed(order[scan] ?? 0)
          if ((component.coefficients[base + position] ?? 0) !== 0) nonzero += 1
        }
        visit(nonzero)
        for (let scan = 1; scan <= lastNonzero; scan += 1) {
          const position = transposed(order[scan] ?? 0)
          const coefficient = component.coefficients[base + position] ?? 0
          if (coefficient < -4_095 || coefficient > 4_095) {
            throw unsupportedOperation(
              'Exact JPEG transcode AC coefficient exceeds the JPEG XL subset',
            )
          }
          visit(packSigned(coefficient))
        }
      }
    }
  }
}

const writeHfGlobal = (
  writer: JpegXlBitWriter,
  geometry: Readonly<JpegDerivedGeometry>,
  modularEncoding: Readonly<PrefixEncoding>,
  acFrequencies: Uint32Array,
): PrefixEncoding => {
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
  writeU32(writer, 0, [{ value: 0x5f }, { value: 0x13 }, { value: 0 }, { bits: 13, offset: 0 }])
  return writePrefixCode(writer, 15 * (37 + 458), acFrequencies)
}

const writeAcGroup = (
  writer: JpegXlBitWriter,
  geometry: Readonly<JpegDerivedGeometry>,
  group: number,
  encoding: Readonly<PrefixEncoding>,
): void => visitAcGroup(geometry, group, (value) => writeHybridUint(writer, value, encoding))

const finishSection = (write: (writer: JpegXlBitWriter) => void): Uint8Array => {
  const writer = new JpegXlBitWriter()
  write(writer)
  return writer.finish()
}

const encodeSections = (geometry: Readonly<JpegDerivedGeometry>): readonly Uint8Array[] => {
  const dcGroupCount = geometry.dcGroupsAcross * geometry.dcGroupsDown
  const groupCount = geometry.groupsAcross * geometry.groupsDown
  const dcPlanes = Array.from({ length: dcGroupCount }, (_, group) =>
    dcGroupPlanes(geometry, group),
  )
  const modularFrequencies = new Uint32Array(512)
  for (const planes of dcPlanes) collectPlanes(modularFrequencies, planes)
  collectPlanes(modularFrequencies, quantizationPlanes(geometry))
  const acFrequencies = new Uint32Array(512)
  for (let group = 0; group < groupCount; group += 1) {
    visitAcGroup(geometry, group, (value) => addFrequency(acFrequencies, value))
  }

  if (groupCount === 1) {
    return Object.freeze([
      finishSection((writer) => {
        const modularEncoding = writeLfGlobal(writer, modularFrequencies, geometry.colorTransform)
        writeDcGroup(writer, dcPlanes[0] ?? [], modularEncoding)
        const acEncoding = writeHfGlobal(writer, geometry, modularEncoding, acFrequencies)
        writeAcGroup(writer, geometry, 0, acEncoding)
      }),
    ])
  }
  let modularEncoding: PrefixEncoding | undefined
  const lf = finishSection((writer) => {
    modularEncoding = writeLfGlobal(writer, modularFrequencies, geometry.colorTransform)
  })
  if (!modularEncoding) throw invalidInput('JPEG XL Modular encoding was not initialized')
  const dc = dcPlanes.map((planes) =>
    finishSection((writer) => writeDcGroup(writer, planes, modularEncoding as PrefixEncoding)),
  )
  let acEncoding: PrefixEncoding | undefined
  const hf = finishSection((writer) => {
    acEncoding = writeHfGlobal(writer, geometry, modularEncoding as PrefixEncoding, acFrequencies)
  })
  if (!acEncoding) throw invalidInput('JPEG XL AC encoding was not initialized')
  const ac = Array.from({ length: groupCount }, (_, group) =>
    finishSection((writer) => writeAcGroup(writer, geometry, group, acEncoding as PrefixEncoding)),
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

export const encodeJpegCoefficientImageAsJpegXl = (
  image: JpegCoefficientImage,
  reconstructionPayload: Uint8Array,
  limits: Readonly<JpegXlLimits>,
): Uint8Array => {
  const geometry = geometryFor(image)
  const sections = encodeSections(geometry)
  const codestream = codestreamFor(image, geometry, sections)
  if (codestream.byteLength > limits.maxCodestreamBytes) {
    throw limitExceeded(
      `JPEG XL codestream has ${codestream.byteLength} bytes; maxCodestreamBytes is ${limits.maxCodestreamBytes}`,
    )
  }
  return concatenate([
    Uint8Array.of(0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a),
    box('ftyp', concatenate([ascii('jxl '), uint32(0), ascii('jxl ')])),
    box('jbrd', reconstructionPayload),
    box('jxlc', codestream),
  ])
}
