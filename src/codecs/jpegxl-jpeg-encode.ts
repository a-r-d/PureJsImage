import { ImageError, invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { JpegCoefficientComponent, JpegCoefficientImage } from './jpeg-coefficients.ts'
import type { JpegXlModularNode } from './jpegxl-decode.ts'
import {
  allocateJpegXlArray,
  copyJpegXlArray,
  type JpegXlEncoderMemory,
  withJpegXlMemory,
  withJpegXlMemoryAsync,
} from './jpegxl-encoder-memory.ts'
import { invalidJpegXlInput } from './jpegxl-errors.ts'
import type { JpegXlLimits } from './jpegxl-limits.ts'
import {
  type AnsEncoding,
  encodeHybridUintPacked,
  encodeRepeatedJpegXlAlphaGroup,
  hybridTokenForEncoding,
  JpegXlBitWriter,
  type PrefixEncoding,
  packSigned,
  writeAnsCode,
  writeAnsPackedValues,
  writeAnsValues,
  writeChannelTree,
  writeColorEncoding,
  writeHybridUint,
  writeLearnedTree,
  writeModularHeader,
  writeModularTree,
  writePrefixCode,
  writeU32,
} from './jpegxl-modular-encode.ts'
import { learnJpegXlModularTree } from './jpegxl-modular-tree.ts'

interface Plane {
  readonly width: number
  readonly height: number
  readonly values: Int32Array
}

export interface VarDctCoefficientPlane {
  readonly blocksPerLineForMcu: number
  readonly blocksPerColumnForMcu: number
  readonly coefficients: Int16Array | Int32Array
  readonly coefficientStride?: 1 | 64
}

export interface VarDctCoefficientGeometry {
  readonly colorTransform: 'none' | 'ycbcr' | 'xyb'
  readonly grayscale?: boolean
  readonly chromaSubsampling: readonly [number, number, number]
  readonly shifts: readonly (readonly [number, number])[]
  readonly fullBlockWidth: number
  readonly fullBlockHeight: number
  readonly groupsAcross: number
  readonly groupsDown: number
  readonly dcGroupsAcross: number
  readonly dcGroupsDown: number
  readonly internalComponents: readonly VarDctCoefficientPlane[]
  readonly dcPlaneComponents: readonly VarDctCoefficientPlane[]
  readonly quantization: readonly Int32Array[]
  readonly dcQuantization?: readonly number[]
  readonly adaptiveLfSmoothing?: boolean
  readonly acQuantizationScale?: number
  readonly baseCorrelationB?: number
  readonly defaultQuantization?: boolean
  readonly globalScale?: number
  readonly quantDc?: number
  readonly blockQuantization?: number
  readonly blockStrategyMap?: Int32Array
  readonly blockQuantizationMap?: Int32Array
  readonly colorCorrelationX?: Int32Array
  readonly colorCorrelationB?: Int32Array
  readonly effort?: 1 | 3 | 5 | 7
  readonly epfSharpnessMap?: Uint8Array
  readonly alpha?: Readonly<{ loadGroup: (group: number) => Plane }>
  readonly progressive?: boolean
  readonly imageHeader?: Uint8Array
  /** Group-local AC storage may be reused after each visit. DC planes stay compact. */
  readonly loadAcGroup?: (group: number, pass: number) => readonly VarDctCoefficientPlane[]
  /** Three channel orders for DCT8, followed by the three small-transform orders. */
  readonly forwardCoefficientOrders?: readonly Uint32Array[]
  /** Forward search may separate DCT8 from Hornuss and split-transform AC models. */
  readonly forwardFamilyContexts?: boolean
  /** Forward effort 1 fills compact DC planes while visiting every AC group, before LF output. */
  readonly deferredDcGroups?: boolean
  readonly memory?: JpegXlEncoderMemory
}

type JpegDerivedGeometry = VarDctCoefficientGeometry

const tokenFor = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw invalidInput('JPEG-derived JPEG XL entropy value is outside the supported range')
  }
  return value < 256 ? value : 256 + Math.floor(Math.log2(value)) - 8
}

const addFrequency = (frequencies: Uint32Array, value: number): void => {
  const token = tokenFor(value)
  frequencies[token] = (frequencies[token] ?? 0) + 1
}

const visitPlaneResiduals = (
  plane: Readonly<Plane>,
  visit: (value: number) => void,
  predictor: 1 | 5 = 5,
): void => {
  if (predictor === 1) {
    for (let y = 0; y < plane.height; y++) {
      for (let x = 0; x < plane.width; x++) {
        const index = y * plane.width + x
        const sample = plane.values[index]
        if (sample === undefined) throw invalidInput('JPEG-derived JPEG XL plane is incomplete')
        const left =
          x > 0
            ? (plane.values[index - 1] ?? 0)
            : y > 0
              ? (plane.values[index - plane.width] ?? 0)
              : 0
        visit(packSigned(sample - left))
      }
    }
    return
  }
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
      const topLeft = x > 0 && y > 0 ? (plane.values[index - plane.width - 1] ?? 0) : left
      const gradient = Math.max(
        Math.min(left, top),
        Math.min(Math.max(left, top), left + top - topLeft),
      )
      visit(packSigned(sample - gradient))
    }
  }
}

const writePlanes = (
  writer: JpegXlBitWriter,
  planes: readonly Plane[],
  encoding: Readonly<ModularEncoding>,
  localTree = false,
  strategyPredictor: 1 | 5 = 5,
): void =>
  withJpegXlMemory(writer.memory, () => {
    let selectedEncoding = encoding
    writeModularHeader(writer, !localTree)
    const planeContexts = allocateJpegXlArray(writer.memory, Uint16Array, planes.length)
    if (localTree) {
      const frequencies = planes.map((plane, channel) => {
        const values = allocateJpegXlArray(writer.memory, Uint32Array, 512)
        visitPlaneResiduals(
          plane,
          (value) => {
            const token = hybridTokenForEncoding(value, acHybridConfig)
            values[token] = (values[token] ?? 0) + 1
          },
          channel === 2 ? strategyPredictor : 5,
        )
        return values
      })
      const contextMap = writeChannelTree(
        writer,
        planes.map((_, channel) => (channel === 2 ? strategyPredictor : 5)),
      )
      for (let context = 0; context < contextMap.length; context++) {
        const channel = contextMap[context]
        if (channel === undefined) throw invalidInput('Missing local Modular channel')
        planeContexts[channel] = context
      }
      selectedEncoding = Object.freeze({
        kind: 'ans',
        encoding: writeAnsCode(writer, contextMap, frequencies, acHybridConfig),
      })
    }
    if (selectedEncoding.kind === 'prefix') {
      for (const plane of planes) {
        visitPlaneResiduals(plane, (value) =>
          writeHybridUint(writer, value, selectedEncoding.encoding),
        )
      }
      return
    }
    const count = planes.reduce((total, plane) => total + plane.values.length, 0)
    const values = allocateJpegXlArray(writer.memory, Uint32Array, count)
    const contexts = allocateJpegXlArray(writer.memory, Uint16Array, count)
    let offset = 0
    for (let channel = 0; channel < planes.length; channel++) {
      const plane = planes[channel]
      if (!plane) throw invalidInput('Missing local Modular plane')
      const context = planeContexts[channel] ?? 0
      visitPlaneResiduals(
        plane,
        (value) => {
          values[offset] = value
          contexts[offset] = context
          offset += 1
        },
        channel === 2 ? strategyPredictor : 5,
      )
    }
    writeAnsValues(writer, values, contexts, count, selectedEncoding.encoding)
  })

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

const writeAlphaPlane = (
  writer: JpegXlBitWriter,
  plane: Readonly<Plane>,
  encoding: Readonly<ModularEncoding>,
  localTree: boolean,
  repeats: boolean,
): void => {
  let nonconstant = false
  if (repeats && plane.values.length >= 64)
    for (let index = 1; index < plane.values.length; index++)
      if (plane.values[index] !== plane.values[0]) {
        nonconstant = true
        break
      }
  let candidate: Readonly<{ bytes: Uint8Array; bitLength: number }> | undefined
  if (nonconstant) {
    try {
      candidate = withJpegXlMemory(writer.memory, () => {
        const originalBits = withJpegXlMemory(writer.memory, () => {
          const original = new JpegXlBitWriter(writer.memory, writer.outputLimit)
          writePlanes(original, [plane], encoding, localTree)
          return original.bitPosition
        })
        return encodeRepeatedJpegXlAlphaGroup(
          plane.values,
          plane.width,
          plane.height,
          originalBits,
          acHybridConfig,
          writer.memory,
          writer.outputLimit,
        )
      })
    } catch (error) {
      if (!(error instanceof ImageError) || error.code !== 'LIMIT_EXCEEDED') throw error
    }
  }
  if (candidate) {
    writer.writeEncodedBits(candidate.bytes, candidate.bitLength)
    writer.memory?.release(candidate.bytes)
  } else writePlanes(writer, [plane], encoding, localTree)
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
  const grayscale = image.components.length === 1 && image.colorTransform === 'gray'
  if (
    !grayscale &&
    (image.components.length !== 3 ||
      (image.colorTransform !== 'ycbcr' && image.colorTransform !== 'rgb'))
  ) {
    throw unsupportedOperation('Exact JPEG transcode requires grayscale, RGB, or YCbCr 8-bit JPEG')
  }
  const colorTransform = image.colorTransform === 'rgb' ? 'none' : 'ycbcr'
  const source = image.components[0]
  if (!source) throw invalidInput('JPEG coefficient image has no component')
  let components: readonly JpegCoefficientComponent[] = image.components
  if (grayscale) {
    const zeroComponent: JpegCoefficientComponent = Object.freeze({
      ...source,
      coefficients: new Int16Array(source.coefficients.length),
    })
    components = [source, zeroComponent, zeroComponent]
  }
  const componentShifts = components.map((component) =>
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
  const internalComponents = componentForInternal.map((index) => {
    const component = components[index]
    if (!component) throw invalidInput('JPEG component mapping is incomplete')
    return component
  })
  const chromaSubsampling = internalComponents.map((component) => {
    const sourceIndex = components.indexOf(component)
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
  const dcPlaneComponents = dcPlaneIndexes.map((index) => {
    const component = components[index]
    if (!component) throw invalidInput('JPEG DC component mapping is incomplete')
    return component
  })
  const quantization = internalComponents.map((component) => transpose(component.quantization))
  return Object.freeze({
    colorTransform,
    grayscale,
    chromaSubsampling: Object.freeze(chromaSubsampling),
    shifts: Object.freeze(shifts),
    fullBlockWidth,
    fullBlockHeight,
    groupsAcross: Math.ceil(fullBlockWidth / 32),
    groupsDown: Math.ceil(fullBlockHeight / 32),
    dcGroupsAcross: Math.ceil(fullBlockWidth / 256),
    dcGroupsDown: Math.ceil(fullBlockHeight / 256),
    internalComponents: Object.freeze(internalComponents),
    dcPlaneComponents: Object.freeze(dcPlaneComponents),
    quantization: Object.freeze(quantization),
  })
}

const componentDcPlane = (
  component: VarDctCoefficientPlane,
  originX: number,
  originY: number,
  width: number,
  height: number,
  offset: number,
  memory?: JpegXlEncoderMemory,
): Plane => {
  const values = allocateJpegXlArray(memory, Int32Array, width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source =
        ((originY + y) * component.blocksPerLineForMcu + originX + x) *
        (component.coefficientStride ?? 64)
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
      geometry.memory,
    )
  })
  const correlationWidth = Math.ceil(blockWidth / 8)
  const correlationHeight = Math.ceil(blockHeight / 8)
  const metadata = [
    Object.freeze({
      width: correlationWidth,
      height: correlationHeight,
      values: allocateJpegXlArray(
        geometry.memory,
        Int32Array,
        correlationWidth * correlationHeight,
      ),
    }),
    Object.freeze({
      width: correlationWidth,
      height: correlationHeight,
      values: allocateJpegXlArray(
        geometry.memory,
        Int32Array,
        correlationWidth * correlationHeight,
      ),
    }),
    Object.freeze({
      width: blockWidth * blockHeight,
      height: 2,
      values: allocateJpegXlArray(geometry.memory, Int32Array, blockWidth * blockHeight * 2),
    }),
    Object.freeze({
      width: blockWidth,
      height: blockHeight,
      values: allocateJpegXlArray(geometry.memory, Int32Array, blockWidth * blockHeight),
    }),
  ]
  if (geometry.blockQuantization !== undefined)
    metadata[2]?.values.fill(geometry.blockQuantization - 1, blockWidth * blockHeight)
  const epfValues = metadata[3]?.values
  if (geometry.epfSharpnessMap && epfValues)
    for (let y = 0; y < blockHeight; y++)
      for (let x = 0; x < blockWidth; x++)
        epfValues[y * blockWidth + x] =
          geometry.epfSharpnessMap[(blockY + y) * geometry.fullBlockWidth + blockX + x] ?? 0
  const strategyMap = geometry.blockStrategyMap
  const strategyValues = metadata[2]?.values
  if (strategyMap && strategyValues)
    for (let y = 0; y < blockHeight; y++)
      for (let x = 0; x < blockWidth; x++)
        strategyValues[y * blockWidth + x] =
          strategyMap[(blockY + y) * geometry.fullBlockWidth + blockX + x] ?? 0
  const quantizationMap = geometry.blockQuantizationMap
  const codedQuantization = metadata[2]?.values
  if (quantizationMap && codedQuantization) {
    for (let y = 0; y < blockHeight; y++)
      for (let x = 0; x < blockWidth; x++)
        codedQuantization[blockWidth * blockHeight + y * blockWidth + x] =
          (quantizationMap[(blockY + y) * geometry.fullBlockWidth + blockX + x] ?? 1) - 1
  }
  const colorTileWidth = Math.ceil(geometry.fullBlockWidth / 8)
  for (let channel = 0; channel < 2; channel++) {
    const source = channel === 0 ? geometry.colorCorrelationX : geometry.colorCorrelationB
    const destination = metadata[channel]?.values
    if (!source || !destination) continue
    for (let y = 0; y < correlationHeight; y++)
      for (let x = 0; x < correlationWidth; x++)
        destination[y * correlationWidth + x] =
          source[(blockY / 8 + y) * colorTileWidth + blockX / 8 + x] ?? 0
  }
  return Object.freeze([...dcPlanes, ...metadata])
}

// Leaf contexts follow breadth-first tree order: sharpness, B, X, quantizers, strategies.
const splitMetadataTree: readonly JpegXlModularNode[] = [
  { kind: 'branch', property: 0, split: 1, greater: 1, lessOrEqual: 2 },
  { kind: 'branch', property: 0, split: 2, greater: 3, lessOrEqual: 4 },
  { kind: 'branch', property: 0, split: 0, greater: 5, lessOrEqual: 6 },
  { kind: 'leaf', predictor: 5, offset: 0, multiplier: 1, context: 0 },
  { kind: 'branch', property: 2, split: 0, greater: 7, lessOrEqual: 8 },
  { kind: 'leaf', predictor: 5, offset: 0, multiplier: 1, context: 1 },
  { kind: 'leaf', predictor: 5, offset: 0, multiplier: 1, context: 2 },
  { kind: 'leaf', predictor: 1, offset: 0, multiplier: 1, context: 3 },
  { kind: 'leaf', predictor: 0, offset: 0, multiplier: 1, context: 4 },
]

const writeSplitDcMetadata = (writer: JpegXlBitWriter, planes: readonly Plane[]): void =>
  withJpegXlMemory(writer.memory, () => {
    const strategy = planes[2]
    if (
      planes.length !== 4 ||
      !strategy ||
      strategy.width < 1 ||
      strategy.height !== 2 ||
      strategy.values.length !== strategy.width * 2
    )
      throw invalidJpegXlInput('metadata requires one strategy and one quantizer row')
    writeModularHeader(writer, false)
    writeLearnedTree(writer, splitMetadataTree)
    const count = planes.reduce((total, plane) => total + plane.values.length, 0)
    const values = allocateJpegXlArray(writer.memory, Uint32Array, count)
    const contexts = allocateJpegXlArray(writer.memory, Uint16Array, count)
    const frequencies = Array.from({ length: 5 }, () =>
      allocateJpegXlArray(writer.memory, Uint32Array, 512),
    )
    let offset = 0
    const emit = (value: number, context: number): void => {
      const histogram = frequencies[context]
      if (!histogram) throw invalidJpegXlInput('metadata histogram is missing')
      values[offset] = value
      contexts[offset++] = context
      const token = hybridTokenForEncoding(value, acHybridConfig)
      histogram[token] = (histogram[token] ?? 0) + 1
    }
    for (let channel = 0; channel < planes.length; channel++) {
      const plane = planes[channel]
      if (!plane) throw invalidJpegXlInput('metadata plane is missing')
      if (channel !== 2) {
        const context = channel === 0 ? 2 : channel === 1 ? 1 : 0
        visitPlaneResiduals(plane, (value) => emit(value, context))
        continue
      }
      for (let x = 0; x < plane.width; x++) emit(packSigned(plane.values[x] ?? 0), 4)
      // Left prediction at x=0 uses the first sample in the strategy row above.
      let left = plane.values[0] ?? 0
      for (let x = 0; x < plane.width; x++) {
        const sample = plane.values[plane.width + x] ?? 0
        emit(packSigned(sample - left), 3)
        left = sample
      }
    }
    const contextMap = allocateJpegXlArray(writer.memory, Uint8Array, 5)
    for (let index = 0; index < contextMap.length; index++) contextMap[index] = index
    writeAnsValues(
      writer,
      values,
      contexts,
      count,
      writeAnsCode(writer, contextMap, frequencies, acHybridConfig),
    )
  })

const writeDcMetadata = (
  writer: JpegXlBitWriter,
  planes: readonly Plane[],
  encoding: Readonly<ModularEncoding>,
  localTree: boolean,
  search: boolean,
): void => {
  let candidate: Readonly<{ bytes: Uint8Array; bitLength: number }> | undefined
  if (localTree && search) {
    try {
      candidate = withJpegXlMemory(writer.memory, () => {
        const originalBits = withJpegXlMemory(writer.memory, () => {
          const original = new JpegXlBitWriter(writer.memory, writer.outputLimit)
          writePlanes(original, planes, encoding, true)
          return original.bitPosition
        })
        let selected = withJpegXlMemory(writer.memory, () => {
          const alternative = new JpegXlBitWriter(writer.memory, writer.outputLimit)
          writePlanes(alternative, planes, encoding, true, 1)
          const bitLength = alternative.bitPosition
          return bitLength < originalBits ? { bytes: alternative.finish(), bitLength } : undefined
        })
        try {
          const split = withJpegXlMemory(writer.memory, () => {
            const alternative = new JpegXlBitWriter(writer.memory, writer.outputLimit)
            writeSplitDcMetadata(alternative, planes)
            const bitLength = alternative.bitPosition
            return bitLength < (selected?.bitLength ?? originalBits)
              ? { bytes: alternative.finish(), bitLength }
              : undefined
          })
          if (split) {
            if (selected) writer.memory?.release(selected.bytes)
            selected = split
          }
        } catch (error) {
          // New optional search must preserve any already-completed left candidate.
          if (!(error instanceof ImageError) || error.code !== 'LIMIT_EXCEEDED') throw error
        }
        return selected
      })
    } catch (error) {
      if (!(error instanceof ImageError) || error.code !== 'LIMIT_EXCEEDED') throw error
    }
  }
  if (candidate) {
    try {
      // Admission happens before any bits are appended, so LIMIT can use the original.
      writer.writeEncodedBits(candidate.bytes, candidate.bitLength)
      return
    } catch (error) {
      if (!(error instanceof ImageError) || error.code !== 'LIMIT_EXCEEDED') throw error
    } finally {
      writer.memory?.release(candidate.bytes)
    }
  }
  writePlanes(writer, planes, encoding, localTree)
}

const writeForwardDcColorPlanes = (
  writer: JpegXlBitWriter,
  planes: readonly Plane[],
  encoding: Readonly<ModularEncoding>,
  localTree: boolean,
  search: boolean,
): void => {
  let candidate: Readonly<{ bytes: Uint8Array; bitLength: number }> | undefined
  if (localTree && search) {
    try {
      candidate = withJpegXlMemory(writer.memory, () => {
        const original = new JpegXlBitWriter(writer.memory, writer.outputLimit)
        writePlanes(original, planes, encoding, true)
        const originalBits = original.bitPosition,
          originalBytes = original.finish()
        const learned = withJpegXlMemory(writer.memory, () => {
          const count = planes.reduce((sum, plane) => sum + plane.values.length, 0)
          const residuals = allocateJpegXlArray(writer.memory, Uint32Array, count)
          let offset = 0
          for (const plane of planes) {
            for (let y = 0; y < plane.height; y++) {
              for (let x = 0; x < plane.width; x++) {
                const index = y * plane.width + x,
                  sample = plane.values[index]
                if (sample === undefined) throw invalidJpegXlInput('learned DC sample missing')
                const left =
                  x > 0
                    ? (plane.values[index - 1] ?? 0)
                    : y > 0
                      ? (plane.values[index - plane.width] ?? 0)
                      : 0
                const top = y > 0 ? (plane.values[index - plane.width] ?? 0) : left
                const topLeft = x > 0 && y > 0 ? (plane.values[index - plane.width - 1] ?? 0) : left
                const gradient = Math.max(
                  Math.min(left, top),
                  Math.min(Math.max(left, top), left + top - topLeft),
                )
                residuals[offset++] = packSigned(sample - gradient)
              }
            }
          }
          const plan = learnJpegXlModularTree(
            planes.map((plane) => plane.values),
            planes.map((plane) => plane.width),
            planes.map(() => 5),
            residuals,
            writer.memory,
            4096,
          )
          if (!plan) return undefined
          const frequencies = Array.from({ length: plan.histogramCount }, () =>
            allocateJpegXlArray(writer.memory, Uint32Array, 512),
          )
          for (let sample = 0; sample < plan.residuals.length; sample++) {
            const histogram = plan.histogramMap[plan.contexts[sample] ?? 0],
              values = histogram === undefined ? undefined : frequencies[histogram]
            if (!values) throw invalidJpegXlInput('learned DC histogram missing')
            const token = hybridTokenForEncoding(plan.residuals[sample] ?? 0, acHybridConfig)
            values[token] = (values[token] ?? 0) + 1
          }
          const alternative = new JpegXlBitWriter(writer.memory, writer.outputLimit)
          writeModularHeader(alternative, false)
          writeLearnedTree(alternative, plan.nodes)
          const code = writeAnsCode(alternative, plan.histogramMap, frequencies, acHybridConfig)
          writeAnsValues(alternative, plan.residuals, plan.contexts, count, code)
          const bitLength = alternative.bitPosition
          return bitLength < originalBits ? { bytes: alternative.finish(), bitLength } : undefined
        })
        if (learned) {
          writer.memory?.release(originalBytes)
          return learned
        }
        return { bytes: originalBytes, bitLength: originalBits }
      })
    } catch (error) {
      if (!(error instanceof ImageError && error.code === 'LIMIT_EXCEEDED')) throw error
    }
  }
  if (candidate) {
    try {
      writer.writeEncodedBits(candidate.bytes, candidate.bitLength)
      return
    } catch (error) {
      if (!(error instanceof ImageError && error.code === 'LIMIT_EXCEEDED')) throw error
    } finally {
      writer.memory?.release(candidate.bytes)
    }
  }
  writePlanes(writer, planes, encoding, localTree)
}

const writeDcGroup = (
  writer: JpegXlBitWriter,
  planes: readonly Plane[],
  encoding: Readonly<ModularEncoding>,
  localTree = false,
  searchMetadata = false,
): void => {
  writer.writeBits(0, 2)
  writeForwardDcColorPlanes(writer, planes.slice(0, 3), encoding, localTree, searchMetadata)
  const blockCount = planes[6]?.values.length ?? 0
  if (blockCount < 1) throw invalidJpegXlInput('DC group metadata is empty')
  writer.writeBits(blockCount - 1, Math.ceil(Math.log2(blockCount)))
  writeDcMetadata(writer, planes.slice(3), encoding, localTree, searchMetadata)
}

const writeF16 = (writer: JpegXlBitWriter, value: number): void => {
  if (!Number.isFinite(value) || value < 0)
    throw invalidJpegXlInput('half-precision value is invalid')
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
    throw invalidJpegXlInput('half-precision value is outside the supported encoder range')
  }
  writer.writeBits((encodedExponent << 10) | mantissa, 16)
}

const writeComponentBlockContexts = (writer: JpegXlBitWriter, familyContexts: boolean): void => {
  writer.writeBits(0, 1)
  for (let channel = 0; channel < 3; channel += 1) writer.writeBits(0, 4)
  writer.writeBits(0, 4)
  writer.writeBits(1, 1)
  const bits = familyContexts ? 3 : 2
  writer.writeBits(bits, 2)
  for (let channel = 0; channel < 3; channel += 1) {
    for (let order = 0; order < 13; order += 1) {
      writer.writeBits(channel + (familyContexts && order === 1 ? 3 : 0), bits)
    }
  }
}

const writeLfGlobal = (
  writer: JpegXlBitWriter,
  frequencies: Uint32Array,
  geometry: Readonly<JpegDerivedGeometry>,
  useAns: boolean,
): ModularEncoding => {
  writer.writeBits(0, 1)
  for (let channel = 0; channel < geometry.quantization.length; channel++) {
    const quantization = geometry.quantization[channel]
    if (!quantization) throw invalidJpegXlInput('quantization plane is missing')
    const dc = quantization[0]
    if (!dc || dc < 1) throw invalidInput('JPEG DC quantization value is invalid')
    writeF16(
      writer,
      geometry.dcQuantization?.[channel] === undefined
        ? (dc * 16) / 255
        : (geometry.dcQuantization[channel] ?? 0) * 128,
    )
  }
  writeU32(writer, geometry.globalScale ?? 65_536, [
    { bits: 11, offset: 1 },
    { bits: 11, offset: 2_049 },
    { bits: 12, offset: 4_097 },
    { bits: 16, offset: 8_193 },
  ])
  writeU32(writer, geometry.quantDc ?? 1, [
    { value: 16 },
    { bits: 5, offset: 1 },
    { bits: 8, offset: 1 },
    { bits: 16, offset: 1 },
  ])
  writeComponentBlockContexts(writer, geometry.forwardFamilyContexts === true)
  writer.writeBits(0, 1)
  writeU32(writer, 84, [
    { value: 84 },
    { value: 256 },
    { bits: 8, offset: 2 },
    { bits: 16, offset: 258 },
  ])
  writeF16(writer, 0)
  writeF16(writer, geometry.baseCorrelationB ?? 0)
  writer.writeBits(128, 8)
  writer.writeBits(128, 8)
  writer.writeBits(1, 1)
  writeModularTree(writer, 5)
  const encoding: ModularEncoding = useAns
    ? Object.freeze({
        kind: 'ans',
        encoding: writeAnsCode(
          writer,
          allocateJpegXlArray(writer.memory, Uint8Array, 1),
          [frequencies],
          acHybridConfig,
        ),
      })
    : Object.freeze({ kind: 'prefix', encoding: writePrefixCode(writer, 1, frequencies) })
  if (geometry.alpha) {
    if (geometry.groupsAcross * geometry.groupsDown === 1)
      writeAlphaPlane(
        writer,
        geometry.alpha.loadGroup(0),
        encoding,
        !!geometry.loadAcGroup && geometry.effort !== 1,
        !!geometry.loadAcGroup && geometry.effort === 7,
      )
    else writeModularHeader(writer, true)
  }
  return encoding
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

/** Count all passes in reusable forward groups, retaining only six 64-position models. */
export function* learnJpegXlForwardCoefficientOrders(
  geometry: Readonly<VarDctCoefficientGeometry>,
): Generator<void, readonly Uint32Array[], void> {
  const counts = allocateJpegXlArray(geometry.memory, Uint32Array, 6 * 64)
  const groups = geometry.groupsAcross * geometry.groupsDown
  for (let group = 0; group < groups; group++) {
    const blockX = (group % geometry.groupsAcross) * 32
    const blockY = Math.floor(group / geometry.groupsAcross) * 32
    for (let pass = 0; pass < (geometry.progressive ? 2 : 1); pass++) {
      const components = geometry.loadAcGroup?.(group, pass)
      if (!components || components.length !== 3)
        throw invalidJpegXlInput('forward order group is missing')
      for (let channel = 0; channel < 3; channel++) {
        const component = components[channel]
        const shift = geometry.shifts[channel]
        if (!component || !shift || shift[0] !== 0 || shift[1] !== 0)
          throw invalidJpegXlInput('forward order geometry is invalid')
        for (let y = 0; y < component.blocksPerColumnForMcu; y++) {
          for (let x = 0; x < component.blocksPerLineForMcu; x++) {
            const strategy =
              geometry.blockStrategyMap?.[(blockY + y) * geometry.fullBlockWidth + blockX + x] ?? 0
            if (strategy !== 0 && strategy !== 1 && strategy !== 12 && strategy !== 13)
              throw unsupportedOperation('JPEG XL forward order strategy is not supported')
            const histogram = (channel + (strategy === 0 ? 0 : 3)) * 64
            const base = (y * component.blocksPerLineForMcu + x) * 64
            for (let position = 1; position < 64; position++) {
              if ((component.coefficients[base + position] ?? 0) !== 0)
                counts[histogram + position] = (counts[histogram + position] ?? 0) + 1
            }
          }
        }
      }
    }
    yield
  }
  const orders: Uint32Array[] = []
  for (let histogram = 0; histogram < 6; histogram++) {
    const positions = allocateJpegXlArray(geometry.memory, Uint32Array, 63)
    for (let position = 0; position < 63; position++) positions[position] = position + 1
    positions.sort(
      (left, right) =>
        (counts[histogram * 64 + right] ?? 0) - (counts[histogram * 64 + left] ?? 0) ||
        naturalJpegXlOrder.indexOf(left) - naturalJpegXlOrder.indexOf(right),
    )
    const order = allocateJpegXlArray(geometry.memory, Uint32Array, 64)
    order.set(positions, 1)
    orders.push(order)
    geometry.memory?.release(positions)
  }
  geometry.memory?.release(counts)
  return Object.freeze(orders)
}

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

const acBlockContextCount = (geometry: Readonly<JpegDerivedGeometry>): 3 | 6 =>
  geometry.forwardFamilyContexts ? 6 : 3
const acHybridConfig = Object.freeze({ splitExponent: 3, msbInToken: 1, lsbInToken: 0 })

// All visited AC values are nonzero counts or signed coefficients bounded to +/-4095.
// Reuse one bounded module table; the existing group buffer can hold the packed words.
let packedClusteredAcValues: Uint32Array | undefined
const getPackedClusteredAcValues = (): Uint32Array => {
  if (packedClusteredAcValues) return packedClusteredAcValues
  const values = new Uint32Array(8192)
  for (let value = 0; value < values.length; value++)
    values[value] = encodeHybridUintPacked(value, acHybridConfig)
  packedClusteredAcValues = values
  return values
}

// Resolve optional scratch before entering this numeric clustering kernel.
const assignCachedAcHistograms = (
  frequencies: readonly Uint32Array[],
  active: readonly number[],
  compact: readonly Uint32Array[],
  totals: readonly number[],
  assignments: Uint8Array,
  symbolCount: number,
  bestCosts: Float64Array,
  logarithms: Float64Array,
): void => {
  bestCosts.fill(Number.POSITIVE_INFINITY)
  for (let cluster = 0; cluster < compact.length; cluster++) {
    const centroid = compact[cluster],
      total = totals[cluster] ?? 0
    if (!centroid || total === 0) continue
    const denominator = total + 128
    for (let symbol = 0; symbol < symbolCount; symbol++) {
      logarithms[symbol] = Math.log2(((centroid[symbol] ?? 0) + 0.5) / denominator)
    }
    for (const histogram of active) {
      const values = frequencies[histogram]
      if (!values) throw invalidJpegXlInput('AC frequency histogram is missing')
      let cost = 0
      for (let symbol = 0; symbol < symbolCount; symbol++) {
        const count = values[symbol] ?? 0
        if (count !== 0) cost -= count * (logarithms[symbol] ?? 0)
      }
      if (cost < (bestCosts[histogram] ?? Number.POSITIVE_INFINITY)) {
        bestCosts[histogram] = cost
        assignments[histogram] = cluster
      }
    }
  }
}

const compactAcHistograms = (
  frequencies: readonly Uint32Array[],
  targetHistogramCount: number,
  memory?: JpegXlEncoderMemory,
): Readonly<{ contextMap: Uint8Array; frequencies: readonly Uint32Array[] }> =>
  withJpegXlMemory(memory, () => {
    const target = Math.min(targetHistogramCount, frequencies.length)
    const assignments = allocateJpegXlArray(memory, Uint8Array, frequencies.length)
    const active: number[] = []
    let symbolCount = 0
    for (let histogram = 0; histogram < frequencies.length; histogram += 1) {
      const values = frequencies[histogram]
      if (!values || !values.some((frequency) => frequency !== 0)) continue
      // Derive the occupied extent from all original input histograms.
      for (let symbol = values.length - 1; symbol >= symbolCount; symbol--) {
        if ((values[symbol] ?? 0) !== 0) {
          symbolCount = symbol + 1
          break
        }
      }
      active.push(histogram)
      assignments[histogram] = Math.min(
        target - 1,
        Math.floor((histogram * target) / frequencies.length),
      )
    }
    if (active.length === 0) {
      throw invalidJpegXlInput('AC frequencies contain no symbols')
    }
    let compact: Uint32Array[] = []
    let costs: Readonly<{ best: Float64Array; logs: Float64Array }> | undefined
    for (let iteration = 0; iteration < 6; iteration += 1) {
      for (const previous of compact) memory?.release(previous)
      compact = Array.from({ length: target }, () => allocateJpegXlArray(memory, Uint32Array, 512))
      for (const histogram of active) {
        const destination = compact[assignments[histogram] ?? 0]
        const values = frequencies[histogram]
        if (!destination || !values) throw invalidJpegXlInput('AC cluster is missing')
        for (let symbol = 0; symbol < symbolCount; symbol += 1) {
          destination[symbol] = (destination[symbol] ?? 0) + (values[symbol] ?? 0)
        }
      }
      if (iteration === 5) break
      const totals = compact.map((values) =>
        values.reduce((total, frequency) => total + frequency, 0),
      )
      // Admit optional scratch after the original centroid allocations already fit.
      // Subsequent iterations replace identically sized centroids; release scratch before remapping.
      if (iteration === 0) {
        try {
          costs = withJpegXlMemory(memory, () => ({
            best: allocateJpegXlArray(memory, Float64Array, frequencies.length),
            logs: allocateJpegXlArray(memory, Float64Array, 512),
          }))
        } catch (error) {
          if (!(error instanceof ImageError) || error.code !== 'LIMIT_EXCEEDED') throw error
        }
      }
      if (costs) {
        assignCachedAcHistograms(
          frequencies,
          active,
          compact,
          totals,
          assignments,
          symbolCount,
          costs.best,
          costs.logs,
        )
      } else {
        for (const histogram of active) {
          const values = frequencies[histogram]
          if (!values) throw invalidJpegXlInput('AC frequency histogram is missing')
          let bestCluster = assignments[histogram] ?? 0
          let bestCost = Number.POSITIVE_INFINITY
          for (let cluster = 0; cluster < compact.length; cluster += 1) {
            const centroid = compact[cluster]
            const total = totals[cluster] ?? 0
            if (!centroid || total === 0) continue
            const denominator = total + 128
            let cost = 0
            for (let symbol = 0; symbol < symbolCount; symbol += 1) {
              const count = values[symbol] ?? 0
              if (count !== 0) {
                cost -= count * Math.log2(((centroid[symbol] ?? 0) + 0.5) / denominator)
              }
            }
            if (cost < bestCost) {
              bestCost = cost
              bestCluster = cluster
            }
          }
          assignments[histogram] = bestCluster
        }
      }
    }
    if (costs) {
      memory?.release(costs.best)
      memory?.release(costs.logs)
    }
    const remap = allocateJpegXlArray(memory, Int16Array, compact.length)
    remap.fill(-1)
    const populated: Uint32Array[] = []
    for (let cluster = 0; cluster < compact.length; cluster += 1) {
      const values = compact[cluster]
      if (!values || !values.some((frequency) => frequency !== 0)) continue
      remap[cluster] = populated.length
      populated.push(values)
    }
    const clusteredContextMap = copyJpegXlArray(memory, Uint8Array, assignments, (_, histogram) => {
      const mapped = remap[assignments[histogram] ?? 0]
      return mapped === undefined || mapped < 0 ? 0 : mapped
    })
    const canonicalIndexes = allocateJpegXlArray(memory, Int16Array, populated.length)
    canonicalIndexes.fill(-1)
    const canonicalFrequencies: Uint32Array[] = []
    const contextMap = copyJpegXlArray(memory, Uint8Array, clusteredContextMap, (histogram) => {
      let canonical = canonicalIndexes[histogram]
      if (canonical === undefined) throw invalidJpegXlInput('AC histogram index is invalid')
      if (canonical < 0) {
        canonical = canonicalFrequencies.length
        canonicalIndexes[histogram] = canonical
        const values = populated[histogram]
        if (!values) throw invalidJpegXlInput('AC histogram is missing')
        canonicalFrequencies.push(values)
      }
      return canonical
    })
    return Object.freeze({
      contextMap,
      frequencies: Object.freeze(canonicalFrequencies),
    })
  })

type AcEncoding =
  | Readonly<{ readonly kind: 'prefix'; readonly encoding: PrefixEncoding }>
  | Readonly<{ readonly kind: 'ans'; readonly encoding: AnsEncoding }>

type ModularEncoding = AcEncoding

const visitAcGroup = (
  geometry: Readonly<JpegDerivedGeometry>,
  coefficientOrders: readonly Uint32Array[],
  group: number,
  visit: (value: number, context: number) => void,
  pass = 0,
  contextsNeeded = true,
): void =>
  withJpegXlMemory(geometry.memory, () => {
    const groupX = group % geometry.groupsAcross
    const groupY = Math.floor(group / geometry.groupsAcross)
    const blockX = groupX * 32
    const blockY = groupY * 32
    const blockWidth = Math.min(32, geometry.fullBlockWidth - blockX)
    const blockHeight = Math.min(32, geometry.fullBlockHeight - blockY)
    const blockContextCount = acBlockContextCount(geometry)
    const familyContexts = geometry.forwardFamilyContexts === true
    const components = geometry.loadAcGroup?.(group, pass) ?? geometry.internalComponents
    const nonzeroPlanes = contextsNeeded
      ? components.map((_, channel) => {
          const shift = geometry.shifts[channel]
          if (!shift) throw invalidJpegXlInput('AC channel geometry is missing')
          return allocateJpegXlArray(
            geometry.memory,
            Int32Array,
            (blockWidth >> shift[0]) * (blockHeight >> shift[1]),
          )
        })
      : undefined
    for (let y = 0; y < blockHeight; y += 1) {
      for (let x = 0; x < blockWidth; x += 1) {
        for (const channel of [1, 0, 2]) {
          const shift = geometry.shifts[channel]
          const component = components[channel]
          if (
            !shift ||
            !component ||
            (x & (2 ** shift[0] - 1)) !== 0 ||
            (y & (2 ** shift[1] - 1)) !== 0
          )
            continue
          const componentX = ((geometry.loadAcGroup ? 0 : blockX) + x) >> shift[0]
          const componentY = ((geometry.loadAcGroup ? 0 : blockY) + y) >> shift[1]
          const base = (componentY * component.blocksPerLineForMcu + componentX) * 64
          const localX = x >> shift[0]
          const localY = y >> shift[1]
          const localWidth = blockWidth >> shift[0]
          const strategy =
            geometry.blockStrategyMap?.[(blockY + y) * geometry.fullBlockWidth + blockX + x] ?? 0
          const coefficientOrder =
            coefficientOrders[
              channel + (geometry.forwardCoefficientOrders && strategy !== 0 ? 3 : 0)
            ]
          if (!coefficientOrder) throw invalidJpegXlInput('AC coefficient order is missing')
          let lastNonzero = 0
          let nonzero = 0
          for (let scan = 1; scan < 64; scan += 1) {
            const position = coefficientOrder[scan] ?? 0
            if ((component.coefficients[base + position] ?? 0) !== 0) {
              lastNonzero = scan
              nonzero += 1
            }
          }
          if (!contextsNeeded) {
            visit(nonzero, 0)
            for (let scan = 1; scan <= lastNonzero; scan++) {
              const coefficient = component.coefficients[base + (coefficientOrder[scan] ?? 0)] ?? 0
              if (coefficient < -4095 || coefficient > 4095)
                throw unsupportedOperation(
                  'Exact JPEG transcode AC coefficient exceeds the JPEG XL subset',
                )
              visit(packSigned(coefficient), 0)
            }
            continue
          }
          const nonzeroPlane = nonzeroPlanes?.[channel]
          if (!nonzeroPlane) throw invalidJpegXlInput('AC channel model is missing')
          const blockContext =
            (channel === 1 ? 0 : channel === 0 ? 1 : 2) + (familyContexts && strategy !== 0 ? 3 : 0)
          const predicted = predictNonzeroCount(nonzeroPlane, localWidth, localX, localY)
          const nonzeroBucket =
            predicted < 8 ? predicted : 4 + Math.floor(Math.min(64, predicted) / 2)
          visit(nonzero, nonzeroBucket * blockContextCount + blockContext)
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
              throw invalidJpegXlInput('AC coefficient context is invalid')
            }
            const coefficientContext =
              blockContextCount * 37 +
              458 * blockContext +
              (remainingContext + frequencyContext) * 2 +
              previous
            visit(packSigned(coefficient), coefficientContext)
            previous = coefficient === 0 ? 0 : 1
            remainingNonzero -= previous
          }
        }
      }
    }
  })

const writeHfGlobal = (
  writer: JpegXlBitWriter,
  geometry: Readonly<JpegDerivedGeometry>,
  coefficientOrders: readonly Uint32Array[],
  useClusteredAns: boolean,
  modularEncoding: Readonly<ModularEncoding>,
  acContextMap: Uint8Array,
  acFrequencies: readonly Uint32Array[],
  histogramCount = 1,
): AcEncoding => {
  writer.writeBits(geometry.defaultQuantization ? 1 : 0, 1)
  for (let table = 0; !geometry.defaultQuantization && table < 17; table += 1) {
    writer.writeBits(table === 0 ? 7 : 0, 3)
    if (table !== 0) continue
    writeF16(writer, geometry.acQuantizationScale ?? 1 / (8 * 255))
    writePlanes(writer, quantizationPlanes(geometry), modularEncoding)
  }
  const groupCount = geometry.groupsAcross * geometry.groupsDown
  const histogramBits = Math.ceil(Math.log2(groupCount))
  if (histogramBits !== 0) writer.writeBits(histogramCount - 1, histogramBits)
  let encoding = writeHfPass(
    writer,
    coefficientOrders,
    useClusteredAns,
    acContextMap,
    acFrequencies,
    acBlockContextCount(geometry),
  )
  if (geometry.progressive)
    encoding = writeHfPass(
      writer,
      coefficientOrders,
      useClusteredAns,
      acContextMap,
      acFrequencies,
      acBlockContextCount(geometry),
    )
  return encoding
}

const writeHfPass = (
  writer: JpegXlBitWriter,
  coefficientOrders: readonly Uint32Array[],
  useClusteredAns: boolean,
  acContextMap: Uint8Array,
  acFrequencies: readonly Uint32Array[],
  blockContextCount: 3 | 6,
): AcEncoding => {
  let usedOrders = useClusteredAns ? 1 : 0
  if (useClusteredAns && coefficientOrders.length === 6) {
    usedOrders = 0
    for (let family = 0; family < 2; family++) {
      for (let channel = 0; channel < 3; channel++) {
        const order = coefficientOrders[family * 3 + channel]
        if (!order || order.length !== 64)
          throw invalidJpegXlInput('forward coefficient order is missing')
        for (let position = 0; position < 64; position++) {
          if (order[position] !== naturalJpegXlOrder[position]) {
            usedOrders |= 1 << family
            break
          }
        }
      }
    }
  }
  writeU32(writer, usedOrders, [
    { value: 0x5f },
    { value: 0x13 },
    { value: 0 },
    { bits: 13, offset: 0 },
  ])
  if (usedOrders !== 0) {
    const inverseNatural = allocateJpegXlArray(writer.memory, Uint8Array, 64)
    for (let index = 0; index < naturalJpegXlOrder.length; index += 1) {
      inverseNatural[naturalJpegXlOrder[index] ?? 0] = index
    }
    const signaledOrders = coefficientOrders.filter(
      (_, index) => (usedOrders & (1 << Math.floor(index / 3))) !== 0,
    )
    const lehmerCodes = signaledOrders.map((coefficientOrder) => {
      const available = Array.from({ length: 64 }, (_, index) => index)
      const codes = allocateJpegXlArray(writer.memory, Uint8Array, 64)
      for (let index = 0; index < coefficientOrder.length; index += 1) {
        const naturalIndex = inverseNatural[coefficientOrder[index] ?? 0] ?? 0
        const selected = available.indexOf(naturalIndex)
        if (selected < 0) throw invalidJpegXlInput('coefficient order is not a permutation')
        codes[index] = selected
        available.splice(selected, 1)
      }
      return codes
    })
    const orderFrequencies = allocateJpegXlArray(writer.memory, Uint32Array, 512)
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
    const combined = allocateJpegXlArray(writer.memory, Uint32Array, 512)
    for (const frequencies of acFrequencies) {
      for (let token = 0; token < combined.length; token += 1) {
        combined[token] = (combined[token] ?? 0) + (frequencies[token] ?? 0)
      }
    }
    return Object.freeze({
      kind: 'prefix',
      encoding: writePrefixCode(writer, blockContextCount * (37 + 458), combined),
    })
  }
  return Object.freeze({
    kind: 'ans',
    encoding: writeAnsCode(writer, acContextMap, acFrequencies, acHybridConfig),
  })
}

const writeAcGroup = (
  writer: JpegXlBitWriter,
  geometry: Readonly<JpegDerivedGeometry>,
  coefficientOrders: readonly Uint32Array[],
  group: number,
  encoding: Readonly<AcEncoding>,
  pass = 0,
): void =>
  withJpegXlMemory(writer.memory, () => {
    if (encoding.kind === 'prefix') {
      visitAcGroup(
        geometry,
        coefficientOrders,
        group,
        (value) => writeHybridUint(writer, value, encoding.encoding),
        pass,
      )
      return
    }
    const packedAcValues = getPackedClusteredAcValues()
    const maximumValues = 3 * 64 * 32 * 32
    const values = allocateJpegXlArray(writer.memory, Uint32Array, maximumValues)
    const contexts = allocateJpegXlArray(writer.memory, Uint16Array, maximumValues)
    let count = 0
    visitAcGroup(
      geometry,
      coefficientOrders,
      group,
      (value, context) => {
        if (count >= maximumValues) throw invalidJpegXlInput('AC group exceeds its token bound')
        values[count] = packedAcValues[value] ?? 0
        contexts[count] = context
        count += 1
      },
      pass,
    )
    writeAnsPackedValues(writer, values, contexts, count, encoding.encoding)
  })

const finishSection = (
  write: (writer: JpegXlBitWriter) => void,
  memory?: JpegXlEncoderMemory,
): Uint8Array => {
  const writer = new JpegXlBitWriter(memory)
  write(writer)
  return writer.finish()
}

function* localForwardSections(
  geometry: Readonly<JpegDerivedGeometry>,
  coefficientOrders: readonly Uint32Array[],
): Generator<void, readonly Uint8Array[], void> {
  const groupCount = geometry.groupsAcross * geometry.groupsDown
  const acContextCount = acBlockContextCount(geometry) * (37 + 458)
  const frequencies: Uint32Array[] = []
  const prefixCounts: Uint32Array[] = []
  const prefixFrequencies = allocateJpegXlArray(geometry.memory, Uint32Array, 512)
  const ac: Uint8Array[] = []
  const maximumValues = 3 * 64 * 32 * 32
  const scratch = {
    contexts: allocateJpegXlArray(geometry.memory, Uint16Array, maximumValues),
    entropy: {
      packedValues: allocateJpegXlArray(geometry.memory, Uint32Array, maximumValues),
      renormalizedWords: allocateJpegXlArray(geometry.memory, Int32Array, maximumValues),
    },
  }
  const localMap = allocateJpegXlArray(geometry.memory, Uint8Array, acContextCount)
  const histogramBits = Math.ceil(Math.log2(groupCount))
  // The visitor bounds coefficients to +/-4095; packed values and nonzero counts fit this table.
  const packedAcValues = allocateJpegXlArray(geometry.memory, Uint32Array, 8192)
  for (let value = 0; value < packedAcValues.length; value++)
    packedAcValues[value] = encodeHybridUintPacked(value, acHybridConfig)
  for (let group = 0; group < groupCount; group++) {
    const counts = allocateJpegXlArray(geometry.memory, Uint32Array, 512)
    frequencies.push(counts)
    const prefix = allocateJpegXlArray(geometry.memory, Uint32Array, 512)
    prefixCounts.push(prefix)
    let valueCount = 0
    // Every local context selects one histogram, so collect only values.
    visitAcGroup(
      geometry,
      coefficientOrders,
      group,
      (value) => {
        if (valueCount >= maximumValues)
          throw invalidJpegXlInput('AC group exceeds its token bound')
        const packed = packedAcValues[value] ?? 0
        scratch.entropy.packedValues[valueCount++] = packed
        const token = packed & 255
        counts[token] = (counts[token] ?? 0) + 1
        const prefixToken = tokenFor(value)
        prefix[prefixToken] = (prefix[prefixToken] ?? 0) + 1
        prefixFrequencies[prefixToken] = (prefixFrequencies[prefixToken] ?? 0) + 1
      },
      0,
      false,
    )
    ac.push(
      withJpegXlMemory(geometry.memory, () => {
        const headerWriter = new JpegXlBitWriter(geometry.memory)
        const encoding = writeAnsCode(headerWriter, localMap, [counts], acHybridConfig)
        return finishSection((writer) => {
          writer.writeBits(group, histogramBits)
          writeAnsPackedValues(
            writer,
            scratch.entropy.packedValues,
            scratch.contexts,
            valueCount,
            encoding,
            scratch.entropy.renormalizedWords,
          )
        }, geometry.memory)
      }),
    )
    yield
  }
  geometry.memory?.release(packedAcValues)
  geometry.memory?.release(scratch.contexts)
  geometry.memory?.release(scratch.entropy.packedValues)
  geometry.memory?.release(scratch.entropy.renormalizedWords)
  const dcPlanes = Array.from(
    { length: geometry.dcGroupsAcross * geometry.dcGroupsDown },
    (_, group) => dcGroupPlanes(geometry, group),
  )
  const modularFrequencies = allocateJpegXlArray(geometry.memory, Uint32Array, 512)
  for (const planes of dcPlanes) collectPlanes(modularFrequencies, planes, false)
  const lfWriter = new JpegXlBitWriter(geometry.memory)
  const modularEncoding = writeLfGlobal(lfWriter, modularFrequencies, geometry, false)
  const lf = lfWriter.finish()
  const dc: Uint8Array[] = []
  for (const planes of dcPlanes) {
    dc.push(
      finishSection((writer) => writeDcGroup(writer, planes, modularEncoding), geometry.memory),
    )
    yield
  }
  const contextMap = allocateJpegXlArray(geometry.memory, Uint8Array, groupCount * acContextCount)
  for (let group = 0; group < groupCount; group++)
    contextMap.fill(group, group * acContextCount, (group + 1) * acContextCount)
  const hf = finishSection((writer) => {
    writeHfGlobal(
      writer,
      geometry,
      coefficientOrders,
      true,
      modularEncoding,
      contextMap,
      frequencies,
      groupCount,
    )
  }, geometry.memory)
  const prefixWriter = new JpegXlBitWriter(geometry.memory)
  const prefixEncoding = writeHfGlobal(
    prefixWriter,
    geometry,
    coefficientOrders,
    false,
    modularEncoding,
    localMap,
    [prefixFrequencies],
  )
  const prefixHf = prefixWriter.finish()
  if (prefixEncoding.kind !== 'prefix') throw invalidJpegXlInput('prefix fallback is unavailable')
  const lengths = prefixEncoding.encoding.lengths
  const prefixSizes = prefixCounts.map((counts) => {
    let bits = 0
    for (let token = 0; token < counts.length; token++)
      bits += (counts[token] ?? 0) * ((lengths[token] ?? 0) + (token < 256 ? 0 : token - 248))
    return Math.ceil(bits / 8)
  })
  const sectionCost = (sizes: readonly number[]): number => {
    let bytes = 0,
      tocBits = 0
    for (const size of sizes) {
      bytes += size
      tocBits += size < 1024 ? 12 : size < 17408 ? 16 : size < 4211712 ? 24 : 32
    }
    return bytes + Math.ceil(tocBits / 8)
  }
  const commonSizes = [lf.length, ...dc.map((section) => section.length)]
  if (
    sectionCost([...commonSizes, prefixHf.length, ...prefixSizes]) <
    sectionCost([...commonSizes, hf.length, ...ac.map((section) => section.length)])
  ) {
    for (const section of ac) geometry.memory?.release(section)
    ac.length = 0
    for (let group = 0; group < groupCount; group++) {
      const section = finishSection(
        (writer) => writeAcGroup(writer, geometry, coefficientOrders, group, prefixEncoding),
        geometry.memory,
      )
      if (section.length !== prefixSizes[group])
        throw invalidJpegXlInput('prefix size prediction disagrees with output')
      ac.push(section)
      yield
    }
    return Object.freeze([lf, ...dc, prefixHf, ...ac])
  }
  return Object.freeze([lf, ...dc, hf, ...ac])
}

function* coefficientSectionSteps(
  geometry: Readonly<JpegDerivedGeometry>,
  profiler?: JpegXlJpegEncodeProfiler,
): Generator<void, readonly Uint8Array[], void> {
  const dcGroupCount = geometry.dcGroupsAcross * geometry.dcGroupsDown
  const acContextCount = acBlockContextCount(geometry) * (37 + 458)
  const groupCount = geometry.groupsAcross * geometry.groupsDown
  const useClusteredAns =
    geometry.effort !== 1 &&
    groupCount > 1 &&
    geometry.fullBlockWidth * geometry.fullBlockHeight >= 1_024
  const coefficientOrders =
    geometry.forwardCoefficientOrders ??
    (!useClusteredAns || geometry.loadAcGroup
      ? Object.freeze([naturalJpegXlOrder, naturalJpegXlOrder, naturalJpegXlOrder])
      : optimizedCoefficientOrders(geometry))
  if (geometry.deferredDcGroups) return yield* localForwardSections(geometry, coefficientOrders)
  let started = performance.now()
  const dcPlanes = Array.from({ length: dcGroupCount }, (_, group) =>
    dcGroupPlanes(geometry, group),
  )
  const modularFrequencies = allocateJpegXlArray(geometry.memory, Uint32Array, 512)
  const localDc = !!geometry.loadAcGroup && useClusteredAns
  if (localDc) modularFrequencies[0] = 1
  else for (const planes of dcPlanes) collectPlanes(modularFrequencies, planes, useClusteredAns)
  if (!geometry.defaultQuantization)
    collectPlanes(modularFrequencies, quantizationPlanes(geometry), useClusteredAns)
  if (geometry.alpha && (!geometry.loadAcGroup || geometry.effort === 1)) {
    for (let group = 0; group < groupCount; group++) {
      collectPlanes(modularFrequencies, [geometry.alpha.loadGroup(group)], useClusteredAns)
      yield
    }
  }
  profiler?.record(
    'dc-representation',
    performance.now() - started,
    dcPlanes.reduce(
      (total, planes) => total + planes.reduce((sum, plane) => sum + plane.values.byteLength, 0),
      0,
    ),
  )
  started = performance.now()
  const packedAcValues = getPackedClusteredAcValues()
  const acFrequencies = Array.from({ length: useClusteredAns ? acContextCount : 1 }, () =>
    allocateJpegXlArray(geometry.memory, Uint32Array, 512),
  )
  for (let group = 0; group < groupCount; group += 1) {
    for (let pass = 0; pass < (geometry.progressive ? 2 : 1); pass++) {
      visitAcGroup(
        geometry,
        coefficientOrders,
        group,
        (value, context) => {
          const histogram = useClusteredAns ? context : 0
          const frequencies = histogram === undefined ? undefined : acFrequencies[histogram]
          if (!frequencies) throw invalidJpegXlInput('AC frequency cluster is missing')
          if (!useClusteredAns) {
            addFrequency(frequencies, value)
          } else {
            const token = (packedAcValues[value] ?? 0) & 255
            frequencies[token] = (frequencies[token] ?? 0) + 1
          }
        },
        pass,
      )
    }
    yield
  }
  const compactAc = useClusteredAns
    ? compactAcHistograms(
        acFrequencies,
        geometry.loadAcGroup ? (geometry.effort === 7 ? 96 : geometry.effort === 5 ? 64 : 32) : 192,
        geometry.memory,
      )
    : Object.freeze({
        contextMap: allocateJpegXlArray(geometry.memory, Uint8Array, 1),
        frequencies: acFrequencies,
      })
  profiler?.record(
    'ac-statistics',
    performance.now() - started,
    compactAc.frequencies.length * 512 * 4,
  )

  if (groupCount === 1 && !geometry.progressive) {
    started = performance.now()
    const section = finishSection((writer) => {
      const modularEncoding = writeLfGlobal(writer, modularFrequencies, geometry, useClusteredAns)
      writeDcGroup(
        writer,
        dcPlanes[0] ?? [],
        modularEncoding,
        localDc,
        geometry.effort === 7 && geometry.loadAcGroup !== undefined,
      )
      const acEncoding = writeHfGlobal(
        writer,
        geometry,
        coefficientOrders,
        useClusteredAns,
        modularEncoding,
        compactAc.contextMap,
        compactAc.frequencies,
      )
      writeAcGroup(writer, geometry, coefficientOrders, 0, acEncoding)
    }, geometry.memory)
    profiler?.record('ac-groups', performance.now() - started, section.byteLength)
    return Object.freeze([section])
  }
  let modularEncoding: ModularEncoding | undefined
  started = performance.now()
  const lf = finishSection((writer) => {
    modularEncoding = writeLfGlobal(writer, modularFrequencies, geometry, useClusteredAns)
  }, geometry.memory)
  profiler?.record('lf-global', performance.now() - started, lf.byteLength)
  if (!modularEncoding) throw invalidJpegXlInput('Modular encoding was not initialized')
  started = performance.now()
  const dc: Uint8Array[] = []
  for (const planes of dcPlanes) {
    dc.push(
      finishSection(
        (writer) =>
          writeDcGroup(
            writer,
            planes,
            modularEncoding as ModularEncoding,
            localDc,
            geometry.effort === 7 && geometry.loadAcGroup !== undefined,
          ),
        geometry.memory,
      ),
    )
    yield
  }
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
      compactAc.contextMap,
      compactAc.frequencies,
    )
  }, geometry.memory)
  profiler?.record('hf-global', performance.now() - started, hf.byteLength)
  if (!acEncoding) throw invalidJpegXlInput('AC encoding was not initialized')
  started = performance.now()
  const passCount = geometry.progressive ? 2 : 1
  const ac: Uint8Array[] = new Array<Uint8Array>(groupCount * passCount)
  const groupEncoding = acEncoding
  const alphaEncoding = modularEncoding
  for (let group = 0; group < groupCount; group++) {
    for (let pass = 0; pass < passCount; pass++) {
      ac[pass * groupCount + group] = finishSection((writer) => {
        writeAcGroup(writer, geometry, coefficientOrders, group, groupEncoding, pass)
        if (geometry.alpha && groupCount > 1 && pass === passCount - 1)
          writeAlphaPlane(
            writer,
            geometry.alpha.loadGroup(group),
            alphaEncoding,
            !!geometry.loadAcGroup && geometry.effort !== 1,
            !!geometry.loadAcGroup && geometry.effort === 7,
          )
      }, geometry.memory)
      yield
    }
  }
  profiler?.record(
    'ac-groups',
    performance.now() - started,
    ac.reduce((total, section) => total + section.byteLength, 0),
  )
  return Object.freeze([lf, ...dc, hf, ...ac])
}

export const encodeVarDctCoefficientSections = (
  geometry: Readonly<JpegDerivedGeometry>,
  profiler?: JpegXlJpegEncodeProfiler,
): readonly Uint8Array[] =>
  withJpegXlMemory(geometry.memory, () => {
    const steps = coefficientSectionSteps(geometry, profiler)
    let next = steps.next()
    while (!next.done) next = steps.next()
    return next.value
  })

export const encodeVarDctCoefficientSectionsAsync = (
  geometry: Readonly<JpegDerivedGeometry>,
  checkpoint: () => Promise<void>,
): Promise<readonly Uint8Array[]> =>
  withJpegXlMemoryAsync(geometry.memory, async () => {
    const steps = coefficientSectionSteps(geometry)
    try {
      await checkpoint()
      let next = steps.next()
      while (!next.done) {
        await checkpoint()
        next = steps.next()
      }
      return next.value
    } finally {
      steps.return([])
    }
  })

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

const concatenate = (parts: readonly Uint8Array[], memory?: JpegXlEncoderMemory): Uint8Array => {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0)
  if (!Number.isSafeInteger(length)) throw limitExceeded('JPEG XL output size overflows')
  const output = allocateJpegXlArray(memory, Uint8Array, length)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

export const varDctCodestreamParts = (
  image: Readonly<{ width: number; height: number }>,
  geometry: Readonly<JpegDerivedGeometry>,
  sections: readonly Uint8Array[],
  frame: Readonly<{ reference?: boolean; patches?: boolean }> = {},
): readonly Uint8Array[] => {
  const writer = new JpegXlBitWriter(geometry.memory)
  if (!geometry.imageHeader) {
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
    writeU32(writer, geometry.alpha ? 1 : 0, [
      { value: 0 },
      { value: 1 },
      { bits: 4, offset: 2 },
      { bits: 12, offset: 1 },
    ])
    if (geometry.alpha) writer.writeBits(1, 1)
    writer.writeBits(geometry.colorTransform === 'xyb' ? 1 : 0, 1)
    if (geometry.grayscale)
      writeColorEncoding(writer, {
        family: 'gray',
        primaries: 'srgb',
        transfer: { kind: 'srgb' },
        matrix: 'identity',
        range: 'full',
        alpha: 'none',
        provenance: 'container-signaled',
        renderingIntent: 'relative',
      })
    else writer.writeBits(1, 1)
    writeU64(writer, 0)
    writer.writeBits(1, 1)
    writer.alignToByte()
  }

  writer.writeBits(0, 1)
  writeU32(writer, frame.reference ? 2 : 0, [
    { value: 0 },
    { value: 1 },
    { value: 2 },
    { value: 3 },
  ])
  writer.writeBits(0, 1)
  writeU64(writer, (geometry.adaptiveLfSmoothing ? 0 : 128) | (frame.patches ? 2 : 0))
  if (geometry.colorTransform !== 'xyb')
    writer.writeBits(geometry.colorTransform === 'ycbcr' ? 1 : 0, 1)
  if (geometry.colorTransform === 'ycbcr') {
    for (const mode of geometry.chromaSubsampling) writer.writeBits(mode, 2)
  }
  writeU32(writer, 1, [{ value: 1 }, { value: 2 }, { value: 4 }, { value: 8 }])
  if (geometry.alpha) writeU32(writer, 1, [{ value: 1 }, { value: 2 }, { value: 4 }, { value: 8 }])
  if (geometry.colorTransform === 'xyb') {
    writer.writeBits(2, 3)
    writer.writeBits(2, 3)
  }
  if (!frame.reference)
    writeU32(writer, geometry.progressive ? 2 : 1, [
      { value: 1 },
      { value: 2 },
      { value: 3 },
      { bits: 3, offset: 4 },
    ])
  if (geometry.progressive && !frame.reference) {
    writeU32(writer, 1, [{ value: 0 }, { value: 1 }, { value: 2 }, { bits: 1, offset: 3 }])
    writer.writeBits(0, 2)
    writeU32(writer, 2, [{ value: 1 }, { value: 2 }, { value: 4 }, { value: 8 }])
    writeU32(writer, 0, [{ value: 0 }, { value: 1 }, { value: 2 }, { bits: 3, offset: 0 }])
  }
  writer.writeBits(frame.reference ? 1 : 0, 1)
  if (frame.reference) {
    writeU32(writer, image.width, [
      { bits: 8, offset: 0 },
      { bits: 11, offset: 256 },
      { bits: 14, offset: 2_304 },
      { bits: 30, offset: 18_688 },
    ])
    writeU32(writer, image.height, [
      { bits: 8, offset: 0 },
      { bits: 11, offset: 256 },
      { bits: 14, offset: 2_304 },
      { bits: 30, offset: 18_688 },
    ])
  }
  if (frame.reference) {
    writeU32(writer, 3, [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }])
    writer.writeBits(1, 1)
  } else {
    writeU32(writer, 0, [{ value: 0 }, { value: 1 }, { value: 2 }, { bits: 2, offset: 3 }])
    if (geometry.alpha)
      writeU32(writer, 0, [{ value: 0 }, { value: 1 }, { value: 2 }, { bits: 2, offset: 3 }])
    writer.writeBits(1, 1)
  }
  writeU32(writer, 0, [
    { value: 0 },
    { bits: 4, offset: 0 },
    { bits: 5, offset: 16 },
    { bits: 10, offset: 48 },
  ])
  writer.writeBits(0, 1)
  writer.writeBits(0, 1)
  writer.writeBits(geometry.epfSharpnessMap ? 2 : 0, 2)
  if (geometry.epfSharpnessMap) writer.writeBits(0, 3)
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
  const parts = Object.freeze([
    ...(geometry.imageHeader ? [geometry.imageHeader] : []),
    writer.finish(),
    ...sections,
  ])
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0)
  if (length > (geometry.memory?.outputLimit ?? 134_217_728))
    throw limitExceeded('JPEG XL codestream exceeds maxOutputBytes')
  return parts
}

const assembleVarDctCodestream = (
  image: Readonly<{ width: number; height: number }>,
  geometry: Readonly<JpegDerivedGeometry>,
  sections: readonly Uint8Array[],
): Uint8Array => concatenate(varDctCodestreamParts(image, geometry, sections), geometry.memory)

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
  const virtualPlaneLease = geometry.grayscale
    ? memory?.allocate(
        'jpeg-transcode-grayscale-virtual-plane',
        geometry.internalComponents[0]?.coefficients.byteLength ?? 0,
      )
    : undefined
  try {
    profiler?.record('geometry', performance.now() - started, 0)
    const sections = encodeVarDctCoefficientSections(geometry, profiler)
    const sectionLease = memory?.allocate(
      'jpeg-transcode-jxl-sections',
      sections.reduce((total, section) => total + section.byteLength, 0),
    )
    let codestreamLease: JpegXlJpegEncodeMemoryLease | undefined
    let outputLease: JpegXlJpegEncodeMemoryLease | undefined
    try {
      started = performance.now()
      const codestream = assembleVarDctCodestream(image, geometry, sections)
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
  } finally {
    virtualPlaneLease?.release()
  }
}
