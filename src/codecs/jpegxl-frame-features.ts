import { invalidInput } from '../errors.ts'
import {
  JpegXlBitReader,
  JpegXlEntropySymbolReader,
  readJpegXlEntropyCode,
} from './jpegxl-bitstream.ts'

export interface JpegXlPatch {
  readonly referenceId: 0 | 1 | 2 | 3
  readonly referenceX: number
  readonly referenceY: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly blendMode: number
}

export interface JpegXlSpline {
  readonly startingX: number
  readonly startingY: number
  readonly controlPointDeltas: readonly (readonly [number, number])[]
  readonly colorDct: readonly (readonly number[])[]
  readonly sigmaDct: readonly number[]
}

export interface JpegXlFrameFeatures {
  readonly patches: readonly JpegXlPatch[]
  readonly splines: readonly JpegXlSpline[]
  readonly splineQuantizationAdjustment: number
  readonly noiseLut: readonly number[] | undefined
  readonly endingBitPosition: number
}

const unpackSigned = (encoded: number): number =>
  (encoded & 1) === 0 ? encoded / 2 : -(encoded + 1) / 2

export const readJpegXlFrameFeatures = (
  section: Uint8Array,
  startBit: number,
  frameFlags: number,
  frameWidth: number,
  frameHeight: number,
  extraChannelCount: number,
): JpegXlFrameFeatures => {
  const reader = new JpegXlBitReader(section, startBit)
  const patches: JpegXlPatch[] = []
  if ((frameFlags & 2) !== 0) {
    const code = readJpegXlEntropyCode(reader, 10)
    const maximumPatches =
      frameWidth > 0 && frameHeight > 0
        ? 4 * (1_024 + Math.floor((frameWidth * frameHeight) / 4))
        : 1_048_576
    const symbols = new JpegXlEntropySymbolReader(code, Math.max(1, maximumPatches * 8))
    const referencePatchCount = symbols.readHybridUint(0, reader)
    if (referencePatchCount > 1_024 + Math.floor((frameWidth * frameHeight) / 4)) {
      throw invalidInput('JPEG XL patch dictionary has too many references')
    }
    for (let referencePatch = 0; referencePatch < referencePatchCount; referencePatch += 1) {
      const referenceId = symbols.readHybridUint(1, reader)
      const referenceX = symbols.readHybridUint(3, reader)
      const referenceY = symbols.readHybridUint(3, reader)
      const width = symbols.readHybridUint(2, reader) + 1
      const height = symbols.readHybridUint(2, reader) + 1
      const placementCount = symbols.readHybridUint(7, reader) + 1
      if (referenceId > 3 || placementCount > maximumPatches - patches.length) {
        throw invalidInput('JPEG XL patch dictionary extent is invalid')
      }
      let x = 0
      let y = 0
      for (let placement = 0; placement < placementCount; placement += 1) {
        if (placement === 0) {
          x = symbols.readHybridUint(4, reader)
          y = symbols.readHybridUint(4, reader)
        } else {
          x += unpackSigned(symbols.readHybridUint(6, reader))
          y += unpackSigned(symbols.readHybridUint(6, reader))
        }
        if (
          x < 0 ||
          y < 0 ||
          referenceX + width > 1_073_741_824 ||
          referenceY + height > 1_073_741_824 ||
          (frameWidth > 0 && x + width > frameWidth) ||
          (frameHeight > 0 && y + height > frameHeight)
        ) {
          throw invalidInput('JPEG XL patch position is outside the frame')
        }
        let colorBlendMode = 0
        for (let channel = 0; channel < extraChannelCount + 1; channel += 1) {
          const blendMode = symbols.readHybridUint(5, reader)
          if (blendMode > 7) throw invalidInput('JPEG XL patch blend mode is invalid')
          if (channel === 0) colorBlendMode = blendMode
          if (blendMode >= 4) {
            if (extraChannelCount > 1) symbols.readHybridUint(8, reader)
            symbols.readHybridUint(9, reader)
          } else if (blendMode === 3) {
            symbols.readHybridUint(9, reader)
          }
        }
        patches.push(
          Object.freeze({
            referenceId: referenceId as 0 | 1 | 2 | 3,
            referenceX,
            referenceY,
            x,
            y,
            width,
            height,
            blendMode: colorBlendMode,
          }),
        )
      }
    }
    if (!symbols.hasValidFinalState()) {
      throw invalidInput('JPEG XL patch dictionary ANS state is invalid')
    }
  }

  const splines: JpegXlSpline[] = []
  let splineQuantizationAdjustment = 0
  if ((frameFlags & 16) !== 0) {
    const code = readJpegXlEntropyCode(reader, 6)
    const maximumControlPoints = Math.min(1_048_576, Math.floor((frameWidth * frameHeight) / 2))
    const symbols = new JpegXlEntropySymbolReader(code, Math.max(1, maximumControlPoints * 4 + 130))
    const splineCount = symbols.readHybridUint(2, reader) + 1
    if (splineCount > maximumControlPoints) {
      throw invalidInput('JPEG XL spline count exceeds the frame limit')
    }
    const starts: [number, number][] = []
    let previousX = 0
    let previousY = 0
    for (let spline = 0; spline < splineCount; spline += 1) {
      const encodedX = symbols.readHybridUint(1, reader)
      const encodedY = symbols.readHybridUint(1, reader)
      const x = spline === 0 ? encodedX : previousX + unpackSigned(encodedX)
      const y = spline === 0 ? encodedY : previousY + unpackSigned(encodedY)
      if (Math.abs(x) >= 8_388_608 || Math.abs(y) >= 8_388_608) {
        throw invalidInput('JPEG XL spline starting point is out of bounds')
      }
      starts.push([x, y])
      previousX = x
      previousY = y
    }
    splineQuantizationAdjustment = unpackSigned(symbols.readHybridUint(0, reader))
    let totalControlPoints = splineCount
    for (let spline = 0; spline < splineCount; spline += 1) {
      const controlPointCount = symbols.readHybridUint(3, reader)
      totalControlPoints += controlPointCount
      if (totalControlPoints > maximumControlPoints) {
        throw invalidInput('JPEG XL spline control-point count exceeds the frame limit')
      }
      const controlPointDeltas: [number, number][] = []
      for (let point = 0; point < controlPointCount; point += 1) {
        controlPointDeltas.push([
          unpackSigned(symbols.readHybridUint(4, reader)),
          unpackSigned(symbols.readHybridUint(4, reader)),
        ])
      }
      const colorDct = Array.from({ length: 3 }, () =>
        Object.freeze(
          Array.from({ length: 32 }, () => unpackSigned(symbols.readHybridUint(5, reader))),
        ),
      )
      const sigmaDct = Object.freeze(
        Array.from({ length: 32 }, () => unpackSigned(symbols.readHybridUint(5, reader))),
      )
      const start = starts[spline]
      if (!start) throw invalidInput('JPEG XL spline starting point is missing')
      splines.push(
        Object.freeze({
          startingX: start[0],
          startingY: start[1],
          controlPointDeltas: Object.freeze(controlPointDeltas),
          colorDct: Object.freeze(colorDct),
          sigmaDct,
        }),
      )
    }
    if (!symbols.hasValidFinalState()) throw invalidInput('JPEG XL spline ANS state is invalid')
  }
  const noiseLut =
    (frameFlags & 1) === 0
      ? undefined
      : Object.freeze(Array.from({ length: 8 }, () => reader.readBits(10) / 1_024))
  return Object.freeze({
    patches: Object.freeze(patches),
    splines: Object.freeze(splines),
    splineQuantizationAdjustment,
    noiseLut,
    endingBitPosition: reader.bitPosition,
  })
}
