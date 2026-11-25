import type { DecodeRequest, DecoderOptions, ImageDecoder } from '../codec.ts'
import { invalidInput, unsupportedOperation } from '../errors.ts'
import { gainMapHeadroomWeight } from '../gain-map-math.ts'
import { type ImageLimits, validateImageDimensions } from '../limits.ts'
import type { PixelBlock } from '../pixel.ts'
import type { ImageSource } from '../source.ts'
import { type Av1Frame, inspectAv1FrameHeader, parseAv1FrameObus } from './av1-frame.ts'
import {
  type Av1DecodedFrame,
  type Av1DeferredRestoration,
  av1ToRgbaRegion,
  decodeRestrictedAv1Intra,
  decodeRestrictedAv1IntraRows,
  estimateRestrictedAv1RowWorkingBytes,
  estimateRestrictedAv1WorkingBytes,
  supportsRestrictedAv1IntraRows,
} from './av1-intra.ts'
import { type Av1FilterPlane, createAv1RestorationBandFilter } from './av1-post-filter.ts'
import { type Av1Obu, type Av1SequenceHeader, av1ObuType } from './av1.ts'
import {
  isHdrTransfer,
  type NclxColor,
  type AvifGainMapMetadata,
  type PixelRegion,
  childBoxes,
  payload,
  parseMeta,
  inspectAvifTracks,
  readItemPayload,
  type AvifGridDescription,
  rationalValue,
  type AvifGainMapInspection,
  nclxSrgbTransform,
  type AvifCodedImageInspection,
  type AvifAlphaAssociation,
  type AvifBitstreamInspection,
  inspectAvifBitstreams,
  inspectAvifTrackFrame,
  inspectAvif,
} from './avif-metadata.ts'
import {
  MAX_BOUNDED_AVIF_WORKING_BYTES,
  validateAvifWorkingBytes,
  validateAvifFrameDimensions,
} from './avif-validation.ts'
import {
  ColorManagedDecoder,
  createNclxHdrToneMap,
  linearToSrgb,
  nclxToLinear,
  type NclxHdrToneMap,
} from './icc.ts'
import { checkedAdd, parseBrands } from './isobmff.ts'

const gainMapWeight = (metadata: AvifGainMapMetadata, hdrHeadroom = 0): number => {
  const base = rationalValue(metadata.baseHdrHeadroom)
  const alternate = rationalValue(metadata.alternateHdrHeadroom)
  return gainMapHeadroomWeight(base, alternate, 2 ** hdrHeadroom)
}

const validateHdrNclxMatrix = (color: NclxColor): void => {
  if (![0, 1, 5, 6, 9, 10, 12].includes(color.matrixCoefficients)) {
    throw unsupportedOperation(
      `HDR AVIF NCLX matrix coefficients ${color.matrixCoefficients} are not supported`,
    )
  }
  if (color.matrixCoefficients === 10 && color.primaries !== 9) {
    throw unsupportedOperation('HDR AVIF NCLX matrix coefficients 10 require color primaries 9')
  }
}

const nclxHdrToneMap = (color: NclxColor | undefined): NclxHdrToneMap | undefined => {
  if (!color || !isHdrTransfer(color.transferCharacteristics)) return undefined
  if (![1, 9, 12].includes(color.primaries)) {
    throw unsupportedOperation(`HDR AVIF NCLX color primaries ${color.primaries} are not supported`)
  }
  validateHdrNclxMatrix(color)
  const transfer = color.transferCharacteristics
  if (transfer !== 16 && transfer !== 18) return undefined
  return createNclxHdrToneMap(color.primaries, transfer)
}

const av1CicpIsAllUnspecified = (sequence: Av1SequenceHeader): boolean =>
  sequence.colorPrimaries === 2 &&
  sequence.transferCharacteristics === 2 &&
  sequence.matrixCoefficients === 2

const validateHdrCicpConsistency = (
  images: readonly AvifCodedImageInspection[],
  color: NclxColor,
): void => {
  for (const image of images) {
    const sequence = image.sequence
    if (av1CicpIsAllUnspecified(sequence)) continue
    if (
      sequence.colorPrimaries !== color.primaries ||
      sequence.transferCharacteristics !== color.transferCharacteristics ||
      sequence.matrixCoefficients !== color.matrixCoefficients ||
      sequence.fullRange !== color.fullRange
    ) {
      throw invalidInput('AVIF HDR container and AV1 color signaling do not match')
    }
  }
}

const validateSdrPixelDecode = (inspection: AvifBitstreamInspection): void => {
  const colorImages = inspection.codedImages.filter((image) => image.role === 'color')
  const hdrImages = colorImages.filter((image) =>
    isHdrTransfer(image.sequence.transferCharacteristics),
  )
  const color = inspection.nclx
  const containerHdr = isHdrTransfer(color?.transferCharacteristics ?? 0)
  const hdr = containerHdr || hdrImages.length !== 0
  if (color?.matrixCoefficients === 10 && color.transferCharacteristics !== 16) {
    throw unsupportedOperation(
      'AVIF NCLX matrix coefficients 10 are supported only with PQ transfer characteristics 16',
    )
  }
  if (containerHdr && color && color.matrixCoefficients !== 2) validateHdrNclxMatrix(color)
  if (hdr && color) {
    validateHdrCicpConsistency(colorImages, color)
  }
  const gainMapApplies =
    inspection.gainMap !== undefined && gainMapWeight(inspection.gainMap.metadata) !== 0
  if (hdr && gainMapApplies) {
    if (
      !inspection.gainMap ||
      isHdrTransfer(inspection.gainMap.alternateColor.transferCharacteristics)
    ) {
      throw unsupportedOperation('HDR AVIF gain-map alternate must use an SDR transfer')
    }
    return
  }
  if (hdr) {
    if (!color || !containerHdr) {
      throw unsupportedOperation('HDR AVIF pixel decode requires explicit HDR NCLX color signaling')
    }
    nclxHdrToneMap(color)
    return
  }
  if (
    color &&
    color.primaries !== 2 &&
    color.transferCharacteristics !== 2 &&
    color.primaries !== 1 &&
    !nclxSrgbTransform(color)
  ) {
    throw unsupportedOperation('AVIF NCLX color conversion is not supported')
  }
}

const decodeRegion = (
  width: number,
  height: number,
  request: DecodeRequest,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } => {
  const x = request.x ?? 0
  const y = request.y ?? 0
  const outputWidth = request.width ?? width - x
  const outputHeight = request.height ?? height - y
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(outputWidth) ||
    !Number.isSafeInteger(outputHeight) ||
    x < 0 ||
    y < 0 ||
    outputWidth < 1 ||
    outputHeight < 1 ||
    x + outputWidth > width ||
    y + outputHeight > height
  ) {
    throw invalidInput('AVIF decode region is invalid')
  }
  return { x, y, width: outputWidth, height: outputHeight }
}

const decodeScaleDenominator = (request: DecodeRequest): 1 | 2 | 4 | 8 => {
  const scale = request.scaleDenominator ?? 1
  if (scale !== 1 && scale !== 2 && scale !== 4 && scale !== 8) {
    throw invalidInput('AVIF decode scale denominator must be 1, 2, 4, or 8')
  }
  return scale
}

const scaledBandRange = (
  sourceY: number,
  outputHeight: number,
  scale: number,
  bandY: number,
  bandHeight: number,
): { readonly start: number; readonly end: number } => ({
  start: Math.max(0, Math.ceil((bandY - sourceY) / scale)),
  end: Math.min(outputHeight, Math.ceil((bandY + bandHeight - sourceY) / scale)),
})

interface AvifAlphaFrame {
  readonly coded: AvifCodedImageInspection
  readonly frame: Av1DecodedFrame
}

// Keep the chroma interpolation halo between adjacent RGBA blocks. Restoration reads
// the original CDEF planes; each reader owns its scratch, including interleaved crops.
const restoredFrameRows = (
  frame: Av1DecodedFrame,
  restoration: Av1DeferredRestoration,
  region: PixelRegion,
) => {
  const { cdef, deblocked, header, state } = restoration
  const restoreBand = createAv1RestorationBandFilter(deblocked, cdef, header, state, 32)
  const strip = (plane: Av1FilterPlane, shift: number): Av1FilterPlane => ({
    ...plane,
    data: new Uint8Array(plane.stride * Math.min(plane.height, 72 >> shift)),
  })
  const strips = [
    strip(cdef[0], 0),
    strip(cdef[1], state.chromaShiftY),
    strip(cdef[2], state.chromaShiftY),
  ] as const
  const left = Math.max(0, region.x - 2)
  const right = region.x + region.width + 2
  let origin = Math.max(0, Math.floor((region.y - 2) / 8) * 8)
  let nextBand = origin
  const regionEnd = 8 * Math.ceil(Math.min(frame.height, region.y + region.height + 2) / 8)
  return (y: number, height: number): Av1DecodedFrame => {
    const first = Math.max(0, Math.floor((y - 2) / 8) * 8)
    const end = Math.min(frame.height, y + height + 2)
    if (first !== origin) {
      for (const [index, plane] of strips.entries()) {
        const shift = index === 0 ? 0 : state.chromaShiftY
        plane.data.copyWithin(
          0,
          ((first - origin) >> shift) * plane.stride,
          ((nextBand - origin) >> shift) * plane.stride,
        )
      }
      origin = first
    }
    const band = (plane: Av1FilterPlane, shift: number, rows: number): Av1FilterPlane => {
      const offset = ((nextBand - origin) >> shift) * plane.stride
      return {
        ...plane,
        data: plane.data.subarray(offset, offset + (rows >> shift) * plane.stride),
      }
    }
    // End the lookahead on a restoration band boundary. The next RGBA block
    // can then restore a whole band instead of gathering two overlapping halos.
    const alignedEnd = Math.min(regionEnd, 32 * Math.ceil((end + 8) / 32) - 8)
    while (nextBand < alignedEnd) {
      // AV1 restoration stripes start at -8 and advance by 64 luma samples.
      // Splitting on the intervening 32-row boundary also respects every unit row.
      const rows = Math.min(alignedEnd - nextBand, 32 - ((nextBand + 8) % 32))
      restoreBand(
        nextBand,
        [
          band(strips[0], 0, rows),
          band(strips[1], state.chromaShiftY, rows),
          band(strips[2], state.chromaShiftY, rows),
        ],
        left,
        right,
        rows,
      )
      nextBand += rows
    }
    return {
      ...frame,
      yOrigin: origin,
      chromaYOrigin: origin >> state.chromaShiftY,
      y: strips[0].data,
      u: strips[1].data,
      v: strips[2].data,
    }
  }
}

class AvifFrameDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly opaqueRgba8: boolean
  readonly pixelFormat = 'rgba8' as const
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: true,
    scaledDecode: false,
    progressive: false,
  })
  readonly #restoration: Av1DeferredRestoration | undefined
  readonly #alpha: AvifAlphaFrame | undefined
  readonly #coded: AvifCodedImageInspection
  readonly #color: NclxColor | undefined
  readonly #displayRegion: PixelRegion
  readonly #frame: Av1DecodedFrame
  readonly #premultipliedAlpha: boolean
  readonly #toneMap: NclxHdrToneMap | undefined

  constructor(
    coded: AvifCodedImageInspection,
    frame: Av1DecodedFrame,
    displayRegion: PixelRegion,
    color: NclxColor | undefined,
    alpha: AvifAlphaFrame | undefined,
    premultipliedAlpha: boolean,
    toneMap?: NclxHdrToneMap,
    restoration?: Av1DeferredRestoration,
  ) {
    this.width = displayRegion.width
    this.height = displayRegion.height
    this.#restoration = restoration
    this.#coded = coded
    this.#frame = frame
    this.#displayRegion = displayRegion
    this.#color = color
    this.opaqueRgba8 = alpha === undefined
    this.#alpha = alpha
    this.#premultipliedAlpha = premultipliedAlpha
    this.#toneMap = toneMap
    if (alpha) validateAlphaFrame(frame.width, frame.height, alpha)
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const region = decodeRegion(this.width, this.height, request)
    const sourceX = this.#displayRegion.x + region.x
    const rowsPerBlock = 32
    const firstY = this.#displayRegion.y + region.y
    const readRows = this.#restoration
      ? restoredFrameRows(this.#frame, this.#restoration, {
          x: sourceX,
          y: firstY,
          width: region.width,
          height: region.height,
        })
      : undefined
    for (let rowStart = 0; rowStart < region.height; rowStart += rowsPerBlock) {
      const blockHeight = Math.min(rowsPerBlock, region.height - rowStart)
      const sourceY = this.#displayRegion.y + region.y + rowStart
      const data = av1ToRgbaRegion(
        this.#coded.sequence,
        readRows?.(sourceY, blockHeight) ?? this.#frame,
        { x: sourceX, y: sourceY, width: region.width, height: blockHeight },
        this.#color,
        1,
        this.#toneMap,
      )
      if (this.#alpha) {
        applyAlphaRegion(
          data,
          { x: sourceX, y: sourceY, width: region.width, height: blockHeight },
          this.#alpha,
          this.#premultipliedAlpha,
        )
      }
      yield {
        x: 0,
        y: rowStart,
        width: region.width,
        height: blockHeight,
        stride: region.width * 4,
        format: this.pixelFormat,
        data,
      }
    }
  }
}

interface Av1FrameUnit {
  readonly obus: readonly Av1Obu[]
  readonly spatialId: number
  readonly temporalId: number
}

const av1FrameUnits = (obus: readonly Av1Obu[]): readonly Av1FrameUnit[] => {
  const units: Av1FrameUnit[] = []
  let splitFrame: Av1Obu[] | undefined
  const commitSplitFrame = (): void => {
    if (!splitFrame) return
    const header = splitFrame[0]
    if (!header) throw invalidInput('AV1 split frame has no frame header')
    units.push({ obus: splitFrame, spatialId: header.spatialId, temporalId: header.temporalId })
    splitFrame = undefined
  }
  for (const obu of obus) {
    if (obu.type === av1ObuType.frame) {
      commitSplitFrame()
      units.push({ obus: [obu], spatialId: obu.spatialId, temporalId: obu.temporalId })
    } else if (obu.type === av1ObuType.frameHeader) {
      commitSplitFrame()
      splitFrame = [obu]
    } else if (obu.type === av1ObuType.tileGroup) {
      const header = splitFrame?.[0]
      if (!splitFrame || !header) {
        throw invalidInput('AV1 tile-group OBU has no preceding frame header')
      }
      if (obu.spatialId !== header.spatialId || obu.temporalId !== header.temporalId) {
        throw invalidInput('AV1 tile-group OBU does not match its frame-header layer')
      }
      splitFrame.push(obu)
    } else if (obu.type === av1ObuType.temporalDelimiter) {
      commitSplitFrame()
    }
  }
  commitSplitFrame()
  return units
}

const obuBelongsToOperatingPoint = (
  obu: Pick<Av1Obu, 'spatialId' | 'temporalId'>,
  operatingPointIdc: number,
): boolean =>
  operatingPointIdc === 0 ||
  (((operatingPointIdc >>> obu.temporalId) & 1) !== 0 &&
    ((operatingPointIdc >>> (obu.spatialId + 8)) & 1) !== 0)

const validateLayerIndexing = (
  coded: AvifCodedImageInspection,
  units: readonly Av1FrameUnit[],
): void => {
  if (!coded.layerSizes) return
  const boundaries: number[] = []
  let end = 0
  for (const size of coded.layerSizes) {
    end = checkedAdd(end, size, `AVIF item ${coded.itemId} a1lx layer sizes overflow`)
    boundaries.push(end)
  }
  boundaries.push(coded.payloadBytes)
  let start = 0
  for (const boundary of boundaries) {
    const layerUnits = units.filter((unit) => {
      const first = unit.obus[0]
      const last = unit.obus[unit.obus.length - 1]
      if (!first || !last) return false
      return first.offset >= start && last.offset + last.totalBytes <= boundary
    })
    if (layerUnits.length !== 1) {
      throw invalidInput(`AVIF item ${coded.itemId} a1lx range does not contain one complete frame`)
    }
    start = boundary
  }
  if (boundaries.length !== units.length) {
    throw invalidInput(`AVIF item ${coded.itemId} a1lx layer count does not match its AV1 frames`)
  }
}

const selectCodedImageFrameObus = (coded: AvifCodedImageInspection): readonly Av1Obu[] => {
  const operatingPointIndex = coded.operatingPointIndex ?? 0
  const operatingPoint = coded.sequence.operatingPoints[operatingPointIndex]
  if (!operatingPoint) {
    throw invalidInput(`AVIF item ${coded.itemId} selects a missing AV1 operating point`)
  }
  const units = av1FrameUnits(coded.obus)
  if (units.length === 0) {
    throw unsupportedOperation(
      'AVIF decode requires one complete AV1 frame OBU or one frame-header OBU followed by tile groups',
    )
  }
  validateLayerIndexing(coded, units)
  const eligible = units.filter((unit) => obuBelongsToOperatingPoint(unit, operatingPoint.idc))
  if (eligible.length === 0) {
    throw invalidInput(`AVIF item ${coded.itemId} has no frame in its selected operating point`)
  }
  const selectedSpatialId =
    coded.layerSelector === undefined || coded.layerSelector === 0xffff
      ? Math.max(...eligible.map((unit) => unit.spatialId))
      : coded.layerSelector
  const selected = eligible.filter((unit) => unit.spatialId === selectedSpatialId).at(-1)
  if (!selected) {
    throw invalidInput(
      `AVIF item ${coded.itemId} has no output frame for selected spatial layer ${selectedSpatialId}`,
    )
  }
  const frameHeaderObu = selected.obus.find(
    (obu) => obu.type === av1ObuType.frame || obu.type === av1ObuType.frameHeader,
  )
  if (!frameHeaderObu) {
    throw invalidInput(`AVIF item ${coded.itemId} selected frame has no frame header`)
  }
  const frameHeader = inspectAv1FrameHeader(coded.sequence, frameHeaderObu.payload)
  if (frameHeader.kind === 'show-existing') {
    throw unsupportedOperation('AV1 show-existing-frame decode is not supported')
  }
  if (frameHeader.kind === 'inter' || frameHeader.kind === 'switch') {
    const dependsOnLowerSpatialLayer = eligible.some((unit) => unit.spatialId < selectedSpatialId)
    throw unsupportedOperation(
      dependsOnLowerSpatialLayer
        ? `AVIF dependent AV1 spatial enhancement layer ${selectedSpatialId} decode is not supported`
        : `AV1 ${frameHeader.kind} frame decode is not supported`,
    )
  }
  return selected.obus
}

const parseCodedImageFrame = (coded: AvifCodedImageInspection, limits: ImageLimits): Av1Frame => {
  validateImageDimensions(coded.width, coded.height, 1, limits)
  const frame = parseAv1FrameObus(coded.sequence, selectCodedImageFrameObus(coded))
  validateAvifFrameDimensions(coded, frame)
  return frame
}

const decodeCodedImage = (coded: AvifCodedImageInspection, limits: ImageLimits): Av1DecodedFrame =>
  decodeRestrictedAv1Intra(coded.sequence, parseCodedImageFrame(coded, limits))

class AvifRowDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly capabilities: ImageDecoder['capabilities']
  readonly #coded: AvifCodedImageInspection
  readonly #color: NclxColor | undefined
  readonly #displayRegion: PixelRegion
  readonly #frame: Av1Frame
  readonly #toneMap: NclxHdrToneMap | undefined

  constructor(
    coded: AvifCodedImageInspection,
    frame: Av1Frame,
    displayRegion: PixelRegion,
    color: NclxColor | undefined,
    toneMap?: NclxHdrToneMap,
  ) {
    const scaledDecode =
      displayRegion.x === 0 &&
      displayRegion.y === 0 &&
      displayRegion.width === frame.header.upscaledWidth &&
      displayRegion.height === frame.header.frameHeight
    this.capabilities = Object.freeze({
      sequential: true,
      regionDecode: false,
      scaledDecode,
      progressive: false,
    })
    this.width = displayRegion.width
    this.height = displayRegion.height
    this.#coded = coded
    this.#frame = frame
    this.#displayRegion = displayRegion
    this.#color = color
    this.#toneMap = toneMap
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const scale = decodeScaleDenominator(request)
    if (scale !== 1 && !this.capabilities.scaledDecode) {
      throw unsupportedOperation('Scaled AVIF decode requires a full coded image aperture')
    }
    const scaledWidth = Math.ceil(this.width / scale)
    const scaledHeight = Math.ceil(this.height / scale)
    const region = decodeRegion(scaledWidth, scaledHeight, request)
    const sourceX = this.#displayRegion.x + region.x * scale
    const sourceY = this.#displayRegion.y + region.y * scale
    for (const band of decodeRestrictedAv1IntraRows(this.#coded.sequence, this.#frame)) {
      const range = scaledBandRange(sourceY, region.height, scale, band.y, band.height)
      for (let outputY = range.start; outputY < range.end; outputY += 32) {
        const blockHeight = Math.min(32, range.end - outputY)
        yield {
          x: 0,
          y: outputY,
          width: region.width,
          height: blockHeight,
          stride: region.width * 4,
          format: this.pixelFormat,
          data: av1ToRgbaRegion(
            this.#coded.sequence,
            band.frame,
            {
              x: sourceX,
              y: sourceY + outputY * scale,
              width: region.width,
              height: blockHeight,
            },
            this.#color,
            scale,
            this.#toneMap,
          ),
        }
      }
    }
  }
}

const unpremultiplyRgba = (pixels: Uint8Array): void => {
  for (let offset = 0; offset < pixels.byteLength; offset += 4) {
    const alpha = pixels[offset + 3] ?? 0
    if (alpha === 255) continue
    if (alpha === 0) {
      pixels[offset] = 0
      pixels[offset + 1] = 0
      pixels[offset + 2] = 0
      continue
    }
    pixels[offset] = Math.min(255, Math.round(((pixels[offset] ?? 0) * 255) / alpha))
    pixels[offset + 1] = Math.min(255, Math.round(((pixels[offset + 1] ?? 0) * 255) / alpha))
    pixels[offset + 2] = Math.min(255, Math.round(((pixels[offset + 2] ?? 0) * 255) / alpha))
  }
}

const validateAlphaCoding = (
  width: number,
  height: number,
  alpha: AvifCodedImageInspection,
): void => {
  if (!alpha.sequence.monochrome || alpha.sequence.chromaSubsampling !== '400') {
    throw unsupportedOperation('AVIF alpha must use a monochrome AV1 sequence')
  }
  if (alpha.width !== width || alpha.height !== height) {
    throw invalidInput('AVIF alpha dimensions do not align with the color item')
  }
}

const validateAlphaFrame = (width: number, height: number, alpha: AvifAlphaFrame): void => {
  validateAlphaCoding(width, height, alpha.coded)
  if (alpha.frame.width !== alpha.coded.width || alpha.frame.height !== alpha.coded.height) {
    throw invalidInput('AVIF alpha frame dimensions do not match its coded item')
  }
}

const applyAlphaRegion = (
  pixels: Uint8Array,
  region: PixelRegion,
  alpha: AvifAlphaFrame,
  premultiplied: boolean,
  scaleDenominator: 1 | 2 | 4 | 8 = 1,
): void => {
  const storageHeight = Math.floor(alpha.frame.y.length / alpha.frame.yStride)
  const sampleShift = alpha.coded.sequence.bitDepth - 8
  const alphaMinimum = alpha.coded.sequence.fullRange ? 0 : 16 * 2 ** sampleShift
  const alphaRange = alpha.coded.sequence.fullRange
    ? 2 ** alpha.coded.sequence.bitDepth - 1
    : 219 * 2 ** sampleShift
  const directSamples = alphaMinimum === 0 && alphaRange === 255
  for (let localY = 0; localY < region.height; localY += 1) {
    const y = region.y + localY * scaleDenominator
    for (let localX = 0; localX < region.width; localX += 1) {
      const sourceX = region.x + localX * scaleDenominator
      const sourceY = y
      const storageY = sourceY - (alpha.frame.yOrigin ?? 0)
      let sample = 0
      if (scaleDenominator === 1) {
        sample =
          storageY < 0 || storageY >= storageHeight
            ? 0
            : (alpha.frame.y[storageY * alpha.frame.yStride + sourceX] ?? 0)
      } else {
        for (let deltaY = 0; deltaY < scaleDenominator; deltaY += 1) {
          const sampleY =
            Math.min(alpha.frame.height - 1, sourceY + deltaY) - (alpha.frame.yOrigin ?? 0)
          for (let deltaX = 0; deltaX < scaleDenominator; deltaX += 1) {
            const sampleX = Math.min(alpha.frame.width - 1, sourceX + deltaX)
            sample +=
              sampleY < 0 || sampleY >= storageHeight
                ? 0
                : (alpha.frame.y[sampleY * alpha.frame.yStride + sampleX] ?? 0)
          }
        }
        sample = Math.round(sample / (scaleDenominator * scaleDenominator))
      }
      pixels[(localY * region.width + localX) * 4 + 3] = directSamples
        ? sample
        : Math.max(0, Math.min(255, Math.round(((sample - alphaMinimum) * 255) / alphaRange)))
    }
  }
  if (premultiplied) unpremultiplyRgba(pixels)
}

class AvifAlphaRowDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly capabilities: ImageDecoder['capabilities']
  readonly #alphaCoded: AvifCodedImageInspection
  readonly #alphaFrame: Av1Frame
  readonly #coded: AvifCodedImageInspection
  readonly #color: NclxColor | undefined
  readonly #displayRegion: PixelRegion
  readonly #frame: Av1Frame
  readonly #premultipliedAlpha: boolean
  readonly #toneMap: NclxHdrToneMap | undefined

  constructor(
    coded: AvifCodedImageInspection,
    frame: Av1Frame,
    displayRegion: PixelRegion,
    color: NclxColor | undefined,
    alphaCoded: AvifCodedImageInspection,
    alphaFrame: Av1Frame,
    premultipliedAlpha: boolean,
    toneMap?: NclxHdrToneMap,
  ) {
    const scaledDecode =
      displayRegion.x === 0 &&
      displayRegion.y === 0 &&
      displayRegion.width === frame.header.frameWidth &&
      displayRegion.height === frame.header.frameHeight
    this.capabilities = Object.freeze({
      sequential: true,
      regionDecode: false,
      scaledDecode,
      progressive: false,
    })
    this.width = displayRegion.width
    this.height = displayRegion.height
    this.#coded = coded
    this.#frame = frame
    this.#displayRegion = displayRegion
    this.#color = color
    this.#alphaCoded = alphaCoded
    this.#alphaFrame = alphaFrame
    this.#premultipliedAlpha = premultipliedAlpha
    this.#toneMap = toneMap
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const scale = decodeScaleDenominator(request)
    const scaledWidth = Math.ceil(this.width / scale)
    const scaledHeight = Math.ceil(this.height / scale)
    if (scale !== 1 && !this.capabilities.scaledDecode) {
      throw unsupportedOperation('Scaled AVIF decode requires a full coded image aperture')
    }
    const region = decodeRegion(scaledWidth, scaledHeight, request)
    const sourceX = this.#displayRegion.x + region.x * scale
    const sourceY = this.#displayRegion.y + region.y * scale
    const alphaBands = decodeRestrictedAv1IntraRows(this.#alphaCoded.sequence, this.#alphaFrame)[
      Symbol.iterator
    ]()
    let alphaBand = alphaBands.next()
    for (const colorBand of decodeRestrictedAv1IntraRows(this.#coded.sequence, this.#frame)) {
      const range = scaledBandRange(sourceY, region.height, scale, colorBand.y, colorBand.height)
      for (let outputY = range.start; outputY < range.end; outputY += 32) {
        const blockHeight = Math.min(32, range.end - outputY)
        const blockSourceY = sourceY + outputY * scale
        const blockSourceEndY = blockSourceY + (blockHeight - 1) * scale
        while (!alphaBand.done && blockSourceY >= alphaBand.value.y + alphaBand.value.height) {
          alphaBand = alphaBands.next()
        }
        if (
          alphaBand.done ||
          blockSourceY < alphaBand.value.y ||
          blockSourceEndY >= alphaBand.value.y + alphaBand.value.height
        ) {
          throw invalidInput('AVIF alpha row bands do not align with the color item')
        }
        const data = av1ToRgbaRegion(
          this.#coded.sequence,
          colorBand.frame,
          {
            x: sourceX,
            y: blockSourceY,
            width: region.width,
            height: blockHeight,
          },
          this.#color,
          scale,
          this.#toneMap,
        )
        applyAlphaRegion(
          data,
          { x: sourceX, y: blockSourceY, width: region.width, height: blockHeight },
          { coded: this.#alphaCoded, frame: alphaBand.value.frame },
          this.#premultipliedAlpha,
          scale,
        )
        yield {
          x: 0,
          y: outputY,
          width: region.width,
          height: blockHeight,
          stride: region.width * 4,
          format: this.pixelFormat,
          data,
        }
      }
    }
  }
}
interface AvifGridDecoderSource {
  readonly alphaAssociations: readonly AvifAlphaAssociation[]
  readonly codedImages: readonly AvifCodedImageInspection[]
  readonly color: NclxColor | undefined
  readonly mirroring: number
  readonly displayRegion: PixelRegion
  readonly grid: AvifGridDescription
  readonly itemIds: readonly number[]
  readonly rotation: number
  readonly premultipliedAlpha: boolean
  readonly toneMap?: NclxHdrToneMap
}

class AvifGridDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: false,
    scaledDecode: false,
    progressive: false,
  })
  readonly estimatedWorkingBytes: number
  readonly #alphaTiles: readonly (AvifCodedImageInspection | undefined)[]
  readonly #color: NclxColor | undefined
  readonly #displayRegion: PixelRegion
  readonly #grid: NonNullable<AvifBitstreamInspection['grid']>
  readonly #limits: ImageLimits
  readonly #premultipliedAlpha: boolean
  readonly #tileHeight: number
  readonly #tiles: readonly AvifCodedImageInspection[]
  readonly #tileWidth: number
  readonly #toneMap: NclxHdrToneMap | undefined

  constructor(source: AvifGridDecoderSource, limits: ImageLimits) {
    const grid = source.grid
    if (source.itemIds.length !== grid.rows * grid.columns) {
      throw invalidInput('AVIF grid item count does not match its dimensions')
    }
    const tiles = source.itemIds.map((itemId) => {
      const coded = source.codedImages.find((image) => image.itemId === itemId)
      if (!coded) throw invalidInput(`AVIF grid tile ${itemId} is not coded`)
      if (coded.rotation !== source.rotation || coded.mirroring !== source.mirroring) {
        throw unsupportedOperation(
          'Phase B2 does not support independently transformed AVIF grid tiles',
        )
      }
      return coded
    })
    const alphaTiles = source.itemIds.map((colorItemId) => {
      const association = source.alphaAssociations.find(
        (candidate) => candidate.colorItemId === colorItemId,
      )
      if (!association) return undefined
      const alpha = source.codedImages.find(
        (image) => image.itemId === association.alphaItemId && image.role === 'alpha',
      )
      if (!alpha) throw invalidInput(`AVIF grid alpha tile ${association.alphaItemId} is not coded`)
      return alpha
    })
    const first = tiles[0]
    if (!first) throw invalidInput('AVIF grid has no coded tiles')
    for (const tile of tiles) {
      if (tile.width !== first.width || tile.height !== first.height) {
        throw invalidInput('AVIF grid tiles have inconsistent dimensions')
      }
    }
    for (let index = 0; index < tiles.length; index += 1) {
      const alpha = alphaTiles[index]
      if (alpha) validateAlphaCoding(first.width, first.height, alpha)
    }
    if (
      grid.width <= (grid.columns - 1) * first.width ||
      grid.width > grid.columns * first.width ||
      grid.height <= (grid.rows - 1) * first.height ||
      grid.height > grid.rows * first.height
    ) {
      throw invalidInput('AVIF grid output dimensions do not match its tile geometry')
    }
    let payloadBytes = 0
    for (let index = 0; index < tiles.length; index += 1) {
      payloadBytes += tiles[index]?.payloadBytes ?? 0
      payloadBytes += alphaTiles[index]?.payloadBytes ?? 0
    }
    let maximumWorkingBytes = 0
    for (let row = 0; row < grid.rows; row += 1) {
      let workingBytes = payloadBytes + source.displayRegion.width * Math.min(32, grid.height) * 4
      for (let column = 0; column < grid.columns; column += 1) {
        const tile = tiles[row * grid.columns + column]
        if (!tile) throw invalidInput('AVIF grid tile layout is incomplete')
        const frame = parseCodedImageFrame(tile, limits)
        workingBytes += estimateRestrictedAv1WorkingBytes(tile.sequence, frame)
        const alpha = alphaTiles[row * grid.columns + column]
        if (alpha) {
          const alphaFrame = parseCodedImageFrame(alpha, limits)
          workingBytes += estimateRestrictedAv1WorkingBytes(alpha.sequence, alphaFrame)
        }
      }
      maximumWorkingBytes = Math.max(maximumWorkingBytes, workingBytes)
    }
    validateAvifWorkingBytes(maximumWorkingBytes)
    this.estimatedWorkingBytes = maximumWorkingBytes
    this.#alphaTiles = alphaTiles
    this.width = source.displayRegion.width
    this.height = source.displayRegion.height
    this.#color = source.color
    this.#displayRegion = source.displayRegion
    this.#grid = grid
    this.#limits = limits
    this.#premultipliedAlpha = source.premultipliedAlpha
    this.#tileHeight = first.height
    this.#tiles = tiles
    this.#tileWidth = first.width
    this.#toneMap = source.toneMap
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const region = decodeRegion(this.width, this.height, request)
    const sourceX = this.#displayRegion.x + region.x
    const sourceY = this.#displayRegion.y + region.y
    const sourceRight = sourceX + region.width
    const sourceBottom = sourceY + region.height
    const firstColumn = Math.floor(sourceX / this.#tileWidth)
    const lastColumn = Math.floor((sourceRight - 1) / this.#tileWidth)
    const firstRow = Math.floor(sourceY / this.#tileHeight)
    const lastRow = Math.floor((sourceBottom - 1) / this.#tileHeight)
    const rowsPerBlock = 32
    for (let tileRow = firstRow; tileRow <= lastRow; tileRow += 1) {
      const decodedTiles: Av1DecodedFrame[] = []
      const decodedAlphaTiles: (Av1DecodedFrame | undefined)[] = []
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const coded = this.#tiles[tileRow * this.#grid.columns + column]
        if (!coded) throw invalidInput('AVIF grid tile layout is incomplete')
        decodedTiles.push(decodeCodedImage(coded, this.#limits))
        const alphaCoded = this.#alphaTiles[tileRow * this.#grid.columns + column]
        decodedAlphaTiles.push(alphaCoded ? decodeCodedImage(alphaCoded, this.#limits) : undefined)
      }
      const rowStart = Math.max(sourceY, tileRow * this.#tileHeight)
      const rowEnd = Math.min(sourceBottom, (tileRow + 1) * this.#tileHeight)
      for (let blockY = rowStart; blockY < rowEnd; blockY += rowsPerBlock) {
        const blockHeight = Math.min(rowsPerBlock, rowEnd - blockY)
        const stride = region.width * 4
        const data = new Uint8Array(stride * blockHeight)
        for (let column = firstColumn; column <= lastColumn; column += 1) {
          const coded = this.#tiles[tileRow * this.#grid.columns + column]
          const frame = decodedTiles[column - firstColumn]
          if (!coded || !frame) throw invalidInput('AVIF grid tile layout is incomplete')
          const alphaCoded = this.#alphaTiles[tileRow * this.#grid.columns + column]
          const alphaFrame = decodedAlphaTiles[column - firstColumn]
          const tileStart = column * this.#tileWidth
          const copyStart = Math.max(sourceX, tileStart)
          const copyEnd = Math.min(sourceRight, tileStart + this.#tileWidth)
          const copyWidth = copyEnd - copyStart
          const tile = av1ToRgbaRegion(
            coded.sequence,
            frame,
            {
              x: copyStart - tileStart,
              y: blockY - tileRow * this.#tileHeight,
              width: copyWidth,
              height: blockHeight,
            },
            this.#color,
            1,
            this.#toneMap,
          )
          if (alphaCoded && alphaFrame) {
            applyAlphaRegion(
              tile,
              {
                x: copyStart - tileStart,
                y: blockY - tileRow * this.#tileHeight,
                width: copyWidth,
                height: blockHeight,
              },
              { coded: alphaCoded, frame: alphaFrame },
              this.#premultipliedAlpha,
            )
          }
          const outputX = copyStart - sourceX
          for (let localY = 0; localY < blockHeight; localY += 1) {
            const sourceOffset = localY * copyWidth * 4
            const targetOffset = localY * stride + outputX * 4
            data.set(tile.subarray(sourceOffset, sourceOffset + copyWidth * 4), targetOffset)
          }
        }
        yield {
          x: 0,
          y: blockY - sourceY,
          width: region.width,
          height: blockHeight,
          stride,
          format: this.pixelFormat,
          data,
        }
      }
    }
  }
}

const bilinearSourceCoordinate = (target: number, sourceSize: number, targetSize: number): number =>
  Math.max(0, Math.min(sourceSize - 1, ((target + 0.5) * sourceSize) / targetSize - 0.5))

class AvifGainMapScaleDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: false,
    scaledDecode: false,
    progressive: false,
  })
  readonly #source: ImageDecoder

  constructor(source: ImageDecoder, width: number, height: number) {
    if (source.width > width || source.height > height) {
      throw unsupportedOperation('AVIF gain-map downsampling is not supported')
    }
    this.#source = source
    this.width = width
    this.height = height
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    if (decodeScaleDenominator(request) !== 1) {
      throw unsupportedOperation('Scaled AVIF gain-map decode is not supported')
    }
    const region = decodeRegion(this.width, this.height, request)
    const x0 = new Int32Array(region.width)
    const x1 = new Int32Array(region.width)
    const xWeight = new Uint16Array(region.width)
    let sourceLeft = this.#source.width
    let sourceRight = 0
    for (let x = 0; x < region.width; x += 1) {
      const coordinate = bilinearSourceCoordinate(region.x + x, this.#source.width, this.width)
      const first = Math.floor(coordinate)
      const second = Math.min(this.#source.width - 1, first + 1)
      x0[x] = first
      x1[x] = second
      xWeight[x] = Math.round((coordinate - first) * 256)
      sourceLeft = Math.min(sourceLeft, first)
      sourceRight = Math.max(sourceRight, second + 1)
    }
    const firstY = Math.floor(bilinearSourceCoordinate(region.y, this.#source.height, this.height))
    const lastY = Math.min(
      this.#source.height - 1,
      Math.floor(
        bilinearSourceCoordinate(region.y + region.height - 1, this.#source.height, this.height),
      ) + 1,
    )
    const sourceWidth = sourceRight - sourceLeft
    const sourceRows = [new Uint8Array(sourceWidth * 4), new Uint8Array(sourceWidth * 4)] as const
    const sourceRowY = new Int32Array([-1, -1])
    let nextSourceSlot: 0 | 1 = 0
    let outputY = 0
    let blockY = 0
    let blockRows = 0
    let output = new Uint8Array(region.width * Math.min(32, region.height) * 4)
    const source = this.#source.decode({
      x: sourceLeft,
      y: firstY,
      width: sourceWidth,
      height: lastY - firstY + 1,
    })
    for await (const block of source) {
      if (
        block.x !== 0 ||
        block.width !== sourceWidth ||
        block.stride < sourceWidth * 4 ||
        block.format !== 'rgba8'
      ) {
        throw invalidInput('AVIF gain-map resampling source rows are invalid')
      }
      for (let localY = 0; localY < block.height; localY += 1) {
        const sourceY = firstY + block.y + localY
        const slot = nextSourceSlot
        sourceRows[slot].set(
          block.data.subarray(localY * block.stride, localY * block.stride + sourceWidth * 4),
        )
        sourceRowY[slot] = sourceY
        nextSourceSlot = nextSourceSlot === 0 ? 1 : 0
        while (outputY < region.height) {
          const coordinate = bilinearSourceCoordinate(
            region.y + outputY,
            this.#source.height,
            this.height,
          )
          const y0 = Math.floor(coordinate)
          const y1 = Math.min(this.#source.height - 1, y0 + 1)
          if (y1 > sourceY) break
          const firstSlot: 0 | 1 | undefined =
            sourceRowY[0] === y0 ? 0 : sourceRowY[1] === y0 ? 1 : undefined
          const secondSlot: 0 | 1 | undefined =
            sourceRowY[0] === y1 ? 0 : sourceRowY[1] === y1 ? 1 : undefined
          if (firstSlot === undefined || secondSlot === undefined) {
            throw invalidInput('AVIF gain-map resampling rows are not contiguous')
          }
          const yWeight = Math.round((coordinate - y0) * 256)
          const firstRow = sourceRows[firstSlot]
          const secondRow = sourceRows[secondSlot]
          const targetRow = blockRows * region.width * 4
          for (let x = 0; x < region.width; x += 1) {
            const firstX = ((x0[x] ?? 0) - sourceLeft) * 4
            const secondX = ((x1[x] ?? 0) - sourceLeft) * 4
            const horizontalWeight = xWeight[x] ?? 0
            const target = targetRow + x * 4
            for (let channel = 0; channel < 4; channel += 1) {
              const top =
                ((firstRow[firstX + channel] ?? 0) * (256 - horizontalWeight) +
                  (firstRow[secondX + channel] ?? 0) * horizontalWeight +
                  128) >>
                8
              const bottom =
                ((secondRow[firstX + channel] ?? 0) * (256 - horizontalWeight) +
                  (secondRow[secondX + channel] ?? 0) * horizontalWeight +
                  128) >>
                8
              output[target + channel] = (top * (256 - yWeight) + bottom * yWeight + 128) >> 8
            }
          }
          outputY += 1
          blockRows += 1
          if (blockRows === 32) {
            yield {
              x: 0,
              y: blockY,
              width: region.width,
              height: blockRows,
              stride: region.width * 4,
              format: this.pixelFormat,
              data: output,
            }
            blockY += blockRows
            blockRows = 0
            output = new Uint8Array(region.width * Math.min(32, region.height - outputY) * 4)
          }
        }
      }
    }
    if (outputY !== region.height) {
      throw invalidInput('AVIF gain-map resampling source ended before its output')
    }
    if (blockRows > 0) {
      yield {
        x: 0,
        y: blockY,
        width: region.width,
        height: blockRows,
        stride: region.width * 4,
        format: this.pixelFormat,
        data: output,
      }
    }
  }
}

const alignedRgbaBlocks = async function* (
  blocks: AsyncIterable<PixelBlock>,
  width: number,
): AsyncGenerator<PixelBlock> {
  let expectedY = 0
  let blockY = 0
  let rows = 0
  let output = new Uint8Array(width * 32 * 4)
  for await (const block of blocks) {
    if (
      block.x !== 0 ||
      block.y !== expectedY ||
      block.width !== width ||
      block.stride < width * 4 ||
      block.format !== 'rgba8'
    ) {
      throw invalidInput('AVIF gain-map rows are not contiguous')
    }
    for (let sourceY = 0; sourceY < block.height; sourceY += 1) {
      output.set(
        block.data.subarray(sourceY * block.stride, sourceY * block.stride + width * 4),
        rows * width * 4,
      )
      rows += 1
      expectedY += 1
      if (rows === 32) {
        yield {
          x: 0,
          y: blockY,
          width,
          height: rows,
          stride: width * 4,
          format: 'rgba8',
          data: output,
        }
        blockY += rows
        rows = 0
        output = new Uint8Array(width * 32 * 4)
      }
    }
  }
  if (rows > 0) {
    yield {
      x: 0,
      y: blockY,
      width,
      height: rows,
      stride: width * 4,
      format: 'rgba8',
      data: output.subarray(0, rows * width * 4),
    }
  }
}
const GAIN_MAP_SRGB_LUT_STEPS = 4095

class AvifGainMapDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly capabilities: ImageDecoder['capabilities']
  readonly #alternateOffset: Float64Array
  readonly #base: ImageDecoder
  readonly #baseLinear: Float64Array
  readonly #baseOffset: Float64Array
  readonly #gainMap: ImageDecoder
  readonly #gainMultiplier: Float64Array
  readonly #linearToSrgb: Uint8Array

  constructor(
    base: ImageDecoder,
    gainMap: ImageDecoder,
    baseColor: NclxColor,
    alternateColor: NclxColor,
    metadata: AvifGainMapMetadata,
  ) {
    const scaledGainMap =
      base.width === gainMap.width && base.height === gainMap.height
        ? gainMap
        : new AvifGainMapScaleDecoder(gainMap, base.width, base.height)
    if (
      (baseColor.primaries !== 1 && baseColor.primaries !== 2) ||
      alternateColor.primaries !== 1 ||
      alternateColor.transferCharacteristics !== 13
    ) {
      throw unsupportedOperation(
        'AVIF gain-map SDR decode currently requires sRGB alternate color primaries',
      )
    }
    this.width = base.width
    this.height = base.height
    this.capabilities = Object.freeze({ ...base.capabilities, scaledDecode: false })
    this.#base = base
    this.#gainMap = scaledGainMap
    this.#baseLinear = Float64Array.from({ length: 256 }, (_, value) =>
      nclxToLinear(baseColor.transferCharacteristics, value / 255),
    )
    this.#baseOffset = Float64Array.from(metadata.baseOffset, rationalValue)
    this.#alternateOffset = Float64Array.from(metadata.alternateOffset, rationalValue)
    const weight = gainMapWeight(metadata)
    this.#gainMultiplier = new Float64Array(3 * 256)
    for (let channel = 0; channel < 3; channel += 1) {
      const minimum = rationalValue(metadata.gainMapMin[channel] ?? metadata.gainMapMin[0])
      const maximum = rationalValue(metadata.gainMapMax[channel] ?? metadata.gainMapMax[0])
      const gammaInverse =
        1 / rationalValue(metadata.gainMapGamma[channel] ?? metadata.gainMapGamma[0])
      for (let value = 0; value < 256; value += 1) {
        const gainLog = minimum + (maximum - minimum) * (value / 255) ** gammaInverse
        this.#gainMultiplier[channel * 256 + value] = 2 ** (gainLog * weight)
      }
    }
    this.#linearToSrgb = Uint8Array.from({ length: GAIN_MAP_SRGB_LUT_STEPS + 1 }, (_, value) =>
      Math.max(0, Math.min(255, Math.round(linearToSrgb(value / GAIN_MAP_SRGB_LUT_STEPS) * 255))),
    )
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    if (decodeScaleDenominator(request) !== 1) {
      throw unsupportedOperation('Scaled AVIF gain-map decode is not supported')
    }
    const region = decodeRegion(this.width, this.height, request)
    const baseIterator = alignedRgbaBlocks(this.#base.decode(request), region.width)[
      Symbol.asyncIterator
    ]()
    const gainMapIterator = alignedRgbaBlocks(this.#gainMap.decode(request), region.width)[
      Symbol.asyncIterator
    ]()
    try {
      while (true) {
        const [baseResult, gainMapResult] = await Promise.all([
          baseIterator.next(),
          gainMapIterator.next(),
        ])
        if (baseResult.done || gainMapResult.done) {
          if (baseResult.done !== gainMapResult.done) {
            throw invalidInput('AVIF gain-map rows do not align with the base image')
          }
          return
        }
        const baseBlock = baseResult.value
        const gainMapBlock = gainMapResult.value
        if (
          baseBlock.x !== gainMapBlock.x ||
          baseBlock.y !== gainMapBlock.y ||
          baseBlock.width !== gainMapBlock.width ||
          baseBlock.height !== gainMapBlock.height ||
          baseBlock.stride !== gainMapBlock.stride ||
          baseBlock.format !== 'rgba8' ||
          gainMapBlock.format !== 'rgba8'
        ) {
          throw invalidInput('AVIF gain-map rows do not align with the base image')
        }
        for (let offset = 0; offset < baseBlock.data.byteLength; offset += 4) {
          for (let channel = 0; channel < 3; channel += 1) {
            const baseEncoded = baseBlock.data[offset + channel] ?? 0
            const gainEncoded = gainMapBlock.data[offset + channel] ?? 0
            const alternateLinear =
              ((this.#baseLinear[baseEncoded] ?? 0) + (this.#baseOffset[channel] ?? 0)) *
                (this.#gainMultiplier[channel * 256 + gainEncoded] ?? 1) -
              (this.#alternateOffset[channel] ?? 0)
            const encodedIndex = Math.max(
              0,
              Math.min(
                GAIN_MAP_SRGB_LUT_STEPS,
                Math.round(alternateLinear * GAIN_MAP_SRGB_LUT_STEPS),
              ),
            )
            baseBlock.data[offset + channel] = this.#linearToSrgb[encodedIndex] ?? 0
          }
        }
        yield baseBlock
      }
    } finally {
      await baseIterator.return?.(undefined)
      await gainMapIterator.return?.(undefined)
    }
  }
}
interface AvifDecoderWorkingSet {
  readonly decoder: ImageDecoder
  readonly workingBytes: number
}

const decodedFrameBytes = (frame: Av1DecodedFrame): number =>
  frame.y.byteLength + frame.u.byteLength + frame.v.byteLength

const createCodedAvifDecoder = (
  coded: AvifCodedImageInspection,
  displayRegion: PixelRegion,
  color: NclxColor | undefined,
  limits: ImageLimits,
  toneMap?: NclxHdrToneMap,
  allowRegionRestoration = false,
): AvifDecoderWorkingSet => {
  const frame = parseCodedImageFrame(coded, limits)
  if (supportsRestrictedAv1IntraRows(frame)) {
    const workingBytes =
      coded.payloadBytes + estimateRestrictedAv1RowWorkingBytes(coded.sequence, frame)
    validateAvifWorkingBytes(workingBytes)
    return {
      decoder: new AvifRowDecoder(coded, frame, displayRegion, color, toneMap),
      workingBytes,
    }
  }
  const workingBytes = coded.payloadBytes + estimateRestrictedAv1WorkingBytes(coded.sequence, frame)
  validateAvifWorkingBytes(workingBytes)
  // Up to 72 padded rows of each 8-bit plane and a 128x32 restoration tile.
  const paddedWidth = Math.ceil(frame.header.frameWidth / 8) * 8
  const regionScratchBytes = 72 * 3 * paddedWidth + 96 * 1024
  const canStream =
    allowRegionRestoration &&
    !toneMap &&
    coded.sequence.bitDepth === 8 &&
    workingBytes + regionScratchBytes <= MAX_BOUNDED_AVIF_WORKING_BYTES
  let restoration: Av1DeferredRestoration | undefined
  const decoded = decodeRestrictedAv1Intra(
    coded.sequence,
    frame,
    canStream
      ? (value) => {
          restoration = value
        }
      : undefined,
  )
  return {
    decoder: new AvifFrameDecoder(
      coded,
      decoded,
      displayRegion,
      color,
      undefined,
      false,
      toneMap,
      restoration,
    ),
    workingBytes: restoration
      ? workingBytes + regionScratchBytes
      : coded.payloadBytes +
        decodedFrameBytes(decoded) +
        displayRegion.width * Math.min(32, displayRegion.height) * 4,
  }
}

const createSingleAvifDecoder = (
  inspection: AvifBitstreamInspection,
  limits: ImageLimits,
  toneMap?: NclxHdrToneMap,
): AvifDecoderWorkingSet => {
  if (inspection.colorItemIds.length !== 1) {
    throw invalidInput('Single-image AVIF has an invalid color item count')
  }
  const coded = inspection.codedImages.find(
    (image) => image.itemId === inspection.primaryItemId && image.role === 'color',
  )
  if (!coded) throw invalidInput('AVIF has no coded primary color item')
  const parsedFrame = parseCodedImageFrame(coded, limits)
  let alpha: AvifCodedImageInspection | undefined
  let parsedAlphaFrame: Av1Frame | undefined
  if (inspection.alphaItemId !== undefined) {
    alpha = inspection.codedImages.find(
      (image) => image.itemId === inspection.alphaItemId && image.role === 'alpha',
    )
    if (!alpha) throw invalidInput('AVIF alpha auxiliary item is not coded')
    parsedAlphaFrame = parseCodedImageFrame(alpha, limits)
    validateAlphaCoding(coded.width, coded.height, alpha)
  }
  const colorRowsSupported = supportsRestrictedAv1IntraRows(parsedFrame)
  const alphaRowsSupported =
    !alpha || (!!parsedAlphaFrame && supportsRestrictedAv1IntraRows(parsedAlphaFrame))
  if (colorRowsSupported && alphaRowsSupported) {
    let workingBytes =
      coded.payloadBytes + estimateRestrictedAv1RowWorkingBytes(coded.sequence, parsedFrame)
    if (alpha && parsedAlphaFrame) {
      workingBytes +=
        alpha.payloadBytes + estimateRestrictedAv1RowWorkingBytes(alpha.sequence, parsedAlphaFrame)
    }
    validateAvifWorkingBytes(workingBytes)
    return {
      decoder:
        alpha && parsedAlphaFrame
          ? new AvifAlphaRowDecoder(
              coded,
              parsedFrame,
              inspection.displayRegion,
              inspection.nclx,
              alpha,
              parsedAlphaFrame,
              inspection.premultipliedAlpha,
              toneMap,
            )
          : new AvifRowDecoder(
              coded,
              parsedFrame,
              inspection.displayRegion,
              inspection.nclx,
              toneMap,
            ),
      workingBytes,
    }
  }
  if (alpha && parsedAlphaFrame) {
    const payloadBytes = coded.payloadBytes + alpha.payloadBytes
    validateAvifWorkingBytes(
      payloadBytes + estimateRestrictedAv1WorkingBytes(alpha.sequence, parsedAlphaFrame),
    )
    const alphaDecoded = decodeRestrictedAv1Intra(alpha.sequence, parsedAlphaFrame)
    const retainedAlphaBytes = decodedFrameBytes(alphaDecoded)
    validateAvifWorkingBytes(
      payloadBytes +
        retainedAlphaBytes +
        estimateRestrictedAv1WorkingBytes(coded.sequence, parsedFrame),
    )
    const frame = decodeRestrictedAv1Intra(coded.sequence, parsedFrame)
    if (frame.width !== coded.width || frame.height !== coded.height) {
      throw invalidInput('AVIF display dimensions do not match its AV1 frame')
    }
    return {
      decoder: new AvifFrameDecoder(
        coded,
        frame,
        inspection.displayRegion,
        inspection.nclx,
        { coded: alpha, frame: alphaDecoded },
        inspection.premultipliedAlpha,
        toneMap,
      ),
      workingBytes:
        payloadBytes +
        retainedAlphaBytes +
        decodedFrameBytes(frame) +
        inspection.displayRegion.width * Math.min(32, inspection.displayRegion.height) * 4,
    }
  }
  return createCodedAvifDecoder(
    coded,
    inspection.displayRegion,
    inspection.nclx,
    limits,
    toneMap,
    !inspection.gainMap,
  )
}

const createGridAvifDecoder = (
  source: AvifGridDecoderSource,
  limits: ImageLimits,
): AvifDecoderWorkingSet => {
  const decoder = new AvifGridDecoder(source, limits)
  return { decoder, workingBytes: decoder.estimatedWorkingBytes }
}

const createGainMapGridAvifDecoder = (
  grid: NonNullable<AvifGainMapInspection['grid']>,
  codedImages: readonly AvifCodedImageInspection[],
  color: NclxColor | undefined,
  limits: ImageLimits,
): AvifDecoderWorkingSet => {
  const tiles = grid.itemIds.map((itemId) => {
    const coded = codedImages.find((image) => image.itemId === itemId && image.role === 'gain-map')
    if (!coded) throw invalidInput(`AVIF gain-map grid tile ${itemId} is not coded`)
    return { coded, parsed: parseCodedImageFrame(coded, limits) }
  })
  const first = tiles[0]
  if (!first) throw invalidInput('AVIF gain-map grid has no coded tiles')
  if (tiles.length !== grid.description.rows * grid.description.columns) {
    throw invalidInput('AVIF gain-map grid item count does not match its dimensions')
  }
  for (const tile of tiles) {
    if (
      tile.coded.width !== first.coded.width ||
      tile.coded.height !== first.coded.height ||
      tile.coded.sequence.bitDepth !== first.coded.sequence.bitDepth ||
      tile.coded.sequence.chromaSubsampling !== first.coded.sequence.chromaSubsampling ||
      tile.coded.sequence.fullRange !== first.coded.sequence.fullRange
    ) {
      throw unsupportedOperation('AVIF gain-map grid tiles must use matching pixel formats')
    }
  }
  const sequence = first.coded.sequence
  const chromaShiftX = sequence.monochrome || sequence.chromaSubsampling === '444' ? 0 : 1
  const chromaShiftY = sequence.chromaSubsampling === '420' ? 1 : 0
  const chromaWidth = sequence.monochrome
    ? 0
    : Math.ceil(grid.description.width / 2 ** chromaShiftX)
  const chromaHeight = sequence.monochrome
    ? 0
    : Math.ceil(grid.description.height / 2 ** chromaShiftY)
  const sampleBytes = sequence.bitDepth > 8 ? 2 : 1
  const stitchedBytes =
    (grid.description.width * grid.description.height + 2 * chromaWidth * chromaHeight) *
    sampleBytes
  const payloadBytes = tiles.reduce((total, tile) => total + tile.coded.payloadBytes, 0)
  const maximumTileWorkingBytes = Math.max(
    ...tiles.map((tile) => estimateRestrictedAv1WorkingBytes(tile.coded.sequence, tile.parsed)),
  )
  const outputBytes = grid.description.width * Math.min(32, grid.description.height) * 4
  const workingBytes = payloadBytes + stitchedBytes + maximumTileWorkingBytes + outputBytes
  validateAvifWorkingBytes(workingBytes)

  const y =
    sequence.bitDepth > 8
      ? new Uint16Array(grid.description.width * grid.description.height)
      : new Uint8Array(grid.description.width * grid.description.height)
  const u =
    sequence.bitDepth > 8
      ? new Uint16Array(chromaWidth * chromaHeight)
      : new Uint8Array(chromaWidth * chromaHeight)
  const v =
    sequence.bitDepth > 8
      ? new Uint16Array(chromaWidth * chromaHeight)
      : new Uint8Array(chromaWidth * chromaHeight)
  const copyPlane = (
    source: Uint8Array | Uint16Array,
    sourceStride: number,
    sourceWidth: number,
    sourceHeight: number,
    target: Uint8Array | Uint16Array,
    targetStride: number,
    targetX: number,
    targetY: number,
  ): void => {
    const width = Math.min(sourceWidth, targetStride - targetX)
    const height = Math.min(sourceHeight, Math.floor(target.length / targetStride) - targetY)
    for (let row = 0; row < height; row += 1) {
      target.set(
        source.subarray(row * sourceStride, row * sourceStride + width),
        (targetY + row) * targetStride + targetX,
      )
    }
  }
  for (let index = 0; index < tiles.length; index += 1) {
    const tile = tiles[index]
    if (!tile) continue
    const frame = decodeRestrictedAv1Intra(tile.coded.sequence, tile.parsed)
    const row = Math.floor(index / grid.description.columns)
    const column = index % grid.description.columns
    copyPlane(
      frame.y,
      frame.yStride,
      frame.width,
      frame.height,
      y,
      grid.description.width,
      column * frame.width,
      row * frame.height,
    )
    if (!sequence.monochrome) {
      copyPlane(
        frame.u,
        frame.chromaStride,
        frame.chromaWidth,
        frame.chromaHeight,
        u,
        chromaWidth,
        column * frame.chromaWidth,
        row * frame.chromaHeight,
      )
      copyPlane(
        frame.v,
        frame.chromaStride,
        frame.chromaWidth,
        frame.chromaHeight,
        v,
        chromaWidth,
        column * frame.chromaWidth,
        row * frame.chromaHeight,
      )
    }
  }
  const frame: Av1DecodedFrame = {
    width: grid.description.width,
    height: grid.description.height,
    y,
    yStride: grid.description.width,
    u,
    v,
    chromaWidth,
    chromaHeight,
    chromaStride: chromaWidth,
  }
  return {
    decoder: new AvifFrameDecoder(
      first.coded,
      frame,
      { x: 0, y: 0, width: frame.width, height: frame.height },
      color,
      undefined,
      false,
    ),
    workingBytes,
  }
}

export interface AvifGainMapDecoderComponents {
  readonly inspection: AvifBitstreamInspection
  readonly baseDecoder: ImageDecoder
  readonly gainMapDecoder: ImageDecoder
  readonly baseItem?: Uint8Array
  readonly gainMapItem?: Uint8Array
}

export const createAvifGainMapDecoderComponents = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<AvifGainMapDecoderComponents> => {
  const topLevel = await childBoxes(source, 0, source.size)
  const metaBox = topLevel.find((box) => box.type === 'meta')
  if (!metaBox) throw invalidInput('AVIF requires a meta box')
  const meta = await parseMeta(source, metaBox)
  const inspection = await inspectAvifBitstreams(source)
  const gainMap = inspection.gainMap
  if (!gainMap) throw unsupportedOperation('AVIF does not contain a supported gain map')
  let base: AvifDecoderWorkingSet
  if (inspection.primaryItemType === 'grid') {
    const grid = inspection.grid
    if (!grid) throw invalidInput('AVIF grid description is missing')
    base = createGridAvifDecoder(
      {
        grid,
        itemIds: inspection.colorItemIds,
        codedImages: inspection.codedImages,
        alphaAssociations: inspection.alphaAssociations,
        displayRegion: inspection.displayRegion,
        mirroring: inspection.mirroring,
        color: inspection.nclx,
        premultipliedAlpha: inspection.premultipliedAlpha,
        rotation: inspection.rotation,
      },
      limits,
    )
  } else {
    base = createSingleAvifDecoder(inspection, limits)
  }
  let gain: AvifDecoderWorkingSet
  if (gainMap.gainMapItemType === 'grid') {
    const grid = gainMap.grid
    if (!grid) throw invalidInput('AVIF gain-map grid description is missing')
    const color =
      grid.nclx ??
      inspection.codedImages.find(
        (image) => image.itemId === grid.itemIds[0] && image.role === 'gain-map',
      )?.nclx
    gain = createGainMapGridAvifDecoder(grid, inspection.codedImages, color, limits)
  } else {
    const coded = inspection.codedImages.find(
      (image) => image.itemId === gainMap.gainMapItemId && image.role === 'gain-map',
    )
    if (!coded) throw invalidInput('AVIF gain-map image is not coded')
    gain = createCodedAvifDecoder(
      coded,
      { x: 0, y: 0, width: coded.width, height: coded.height },
      coded.nclx,
      limits,
    )
  }
  validateAvifWorkingBytes(base.workingBytes + gain.workingBytes)
  const baseItem =
    inspection.primaryItemType === 'av01'
      ? await readItemPayload(source, meta, inspection.primaryItemId)
      : undefined
  const gainMapItem =
    gainMap.gainMapItemType === 'av01'
      ? await readItemPayload(source, meta, gainMap.gainMapItemId)
      : undefined
  return Object.freeze({
    inspection,
    baseDecoder: base.decoder,
    gainMapDecoder: gain.decoder,
    ...(baseItem ? { baseItem: Uint8Array.from(baseItem) } : {}),
    ...(gainMapItem ? { gainMapItem: Uint8Array.from(gainMapItem) } : {}),
  })
}

export const createAvifDecoder = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
): Promise<ImageDecoder> => {
  const topLevel = await childBoxes(source, 0, source.size)
  const fileType = topLevel.find((box) => box.type === 'ftyp')
  if (!fileType) throw invalidInput('AVIF requires an ftyp box')
  const brands = parseBrands(await payload(source, fileType, 4096), 'AVIF')
  const sequenceBrand = brands.includes('avis')
  const tracks = sequenceBrand
    ? await inspectAvifTracks(source, limits.maxFrames, topLevel)
    : undefined
  const metadata = await inspectAvif(source, limits, options, tracks, topLevel)
  let inspection: AvifBitstreamInspection
  if (tracks) {
    if (options.frame === undefined) {
      throw unsupportedOperation(
        `Animated AVIF has ${tracks.frames} frames; pass { frame } to explicitly select an independently decodable key frame`,
      )
    }
    inspection = await inspectAvifTrackFrame(source, tracks, options.frame)
  } else {
    inspection = await inspectAvifBitstreams(source)
  }
  validateSdrPixelDecode(inspection)
  const gainMapApplies =
    inspection.gainMap !== undefined && gainMapWeight(inspection.gainMap.metadata) !== 0
  const toneMap = gainMapApplies ? undefined : nclxHdrToneMap(inspection.nclx)
  let base: AvifDecoderWorkingSet
  if (inspection.primaryItemType === 'grid') {
    const grid = inspection.grid
    if (!grid) throw invalidInput('AVIF grid description is missing')
    base = createGridAvifDecoder(
      {
        grid,
        itemIds: inspection.colorItemIds,
        codedImages: inspection.codedImages,
        alphaAssociations: inspection.alphaAssociations,
        displayRegion: inspection.displayRegion,
        mirroring: inspection.mirroring,
        color: inspection.nclx,
        premultipliedAlpha: inspection.premultipliedAlpha,
        rotation: inspection.rotation,
        ...(toneMap ? { toneMap } : {}),
      },
      limits,
    )
  } else {
    base = createSingleAvifDecoder(inspection, limits, toneMap)
  }
  if (toneMap) {
    validateAvifWorkingBytes(
      base.workingBytes +
        toneMap.encodedToLinear.byteLength +
        toneMap.linearToSrgb.byteLength +
        toneMap.sourceToSrgb.byteLength,
    )
  }

  let decoder = base.decoder
  if (gainMapApplies) {
    const gainMap = inspection.gainMap
    if (!gainMap) throw invalidInput('AVIF gain-map metadata is missing')
    if (!inspection.nclx) {
      throw unsupportedOperation('AVIF gain-map base color signaling is required')
    }
    let gain: AvifDecoderWorkingSet
    if (gainMap.gainMapItemType === 'av01') {
      const gainMapCoded = inspection.codedImages.find(
        (image) => image.itemId === gainMap.gainMapItemId && image.role === 'gain-map',
      )
      if (!gainMapCoded) throw invalidInput('AVIF gain-map image is not coded')
      gain = createCodedAvifDecoder(
        gainMapCoded,
        { x: 0, y: 0, width: gainMapCoded.width, height: gainMapCoded.height },
        gainMapCoded.nclx,
        limits,
      )
    } else {
      const grid = gainMap.grid
      if (!grid) throw invalidInput('AVIF gain-map grid description is missing')
      const color =
        grid.nclx ??
        inspection.codedImages.find(
          (image) => image.itemId === grid.itemIds[0] && image.role === 'gain-map',
        )?.nclx
      gain = createGainMapGridAvifDecoder(grid, inspection.codedImages, color, limits)
    }
    const resamplingBytes =
      base.decoder.width === gain.decoder.width && base.decoder.height === gain.decoder.height
        ? 0
        : base.decoder.width * 32 * 8 + gain.decoder.width * 8 + base.decoder.width * 10
    validateAvifWorkingBytes(base.workingBytes + gain.workingBytes + resamplingBytes)
    decoder = new AvifGainMapDecoder(
      base.decoder,
      gain.decoder,
      inspection.nclx,
      gainMap.alternateColor,
      gainMap.metadata,
    )
  }
  if (
    metadata.width !== inspection.displayRegion.width ||
    metadata.height !== inspection.displayRegion.height
  ) {
    throw invalidInput('AVIF clean-aperture metadata is inconsistent')
  }
  return inspection.colorTransform && !gainMapApplies && options.preserveIcc !== true
    ? new ColorManagedDecoder(decoder, inspection.colorTransform)
    : decoder
}
