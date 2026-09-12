import { combineAbortSignals, throwIfAborted } from '../abort.ts'
import type { DecoderOptions, ImageDecoder } from '../codec.ts'
import type { PixelColorSemantics } from '../color.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { type ImageLimitOptions, resolveLimits } from '../limits.ts'
import type { ImageSource } from '../source.ts'
import { createImageSource, type ImageInput, readExactly } from '../source.ts'
import { jpegXlYcbcrToRgb, reconstructJpegXlChroma } from './jpegxl-chroma.ts'
import { inspectJpegXlSource, JpegXlCodestreamSource } from './jpegxl-container.ts'
import {
  decodeJpegXlModularDcFrameSection,
  decodeJpegXlMultiGroupModularDcFrameSections,
  decodeJpegXlNativeModularPlanesCancellable,
  iterateJpegXlFrameStructures,
  type JpegXlBlending,
  type JpegXlFrameStructure,
  jpegXlDecodedPixelFormat,
  jpegXlPixelColorSemantics,
  jpegXlSourceColorSemantics,
} from './jpegxl-decode.ts'
import type { JpegXlFrameFeatures } from './jpegxl-frame-features.ts'
import { type JpegXlLimitOptions, resolveJpegXlLimits } from './jpegxl-limits.ts'
import { applyJpegXlPatch } from './jpegxl-patch-blend.ts'
import { jpegXlEncodedPoint } from './jpegxl-progressive-plan.ts'
import { JpegXlVarDctMemoryLedger } from './jpegxl-vardct-memory.ts'
import {
  applyJpegXlModularFeatures,
  convertJpegXlNativeXybPlanes,
  decodeJpegXlDct8SectionCancellable,
  filterJpegXlModularPlanes,
  type JpegXlVarDctReference,
  jpegXlLinearToSrgb,
  upsampleJpegXlNativePlane,
} from './jpegxl-vardct-render.ts'

export interface OpenJpegXlSequenceOptions {
  /** Preserve encoded canvas coordinates by default; apply rotates displayed output only. */
  readonly orientation?: 'preserve' | 'apply'
  /** Total coded pixels admitted during one replay, including internal reference frames. */
  readonly maxDecodedPixels?: number
  readonly limits?: Readonly<ImageLimitOptions & JpegXlLimitOptions>
  readonly signal?: AbortSignal
}

export interface JpegXlSequenceFrame {
  readonly index: number
  readonly internalFrameIndex: number
  /** Decimal integer string preserves long rational timelines in JSON. */
  readonly startTicks: string
  readonly durationTicks: number
  readonly header: Readonly<JpegXlFrameStructure>
  readonly colorSemantics: PixelColorSemantics
  /** Independent caller-owned, normalized native color and extra-channel planes. */
  readonly planes: readonly Float64Array[]
  readonly width: number
  readonly height: number
}

export interface JpegXlNativeLayer {
  readonly frameFeatures?: Readonly<JpegXlFrameFeatures>
  readonly dcQuantization?: readonly [number, number, number]
  readonly internalFrameIndex: number
  readonly header: Readonly<JpegXlFrameStructure>
  /** Modular integer samples or reconstructed XYB color planes, followed by native integer extras. */
  readonly planes: readonly (Int32Array | Float64Array)[]
  readonly domain: 'modular' | 'xyb'
  readonly layouts: readonly Readonly<{
    width: number
    height: number
    hshift?: number
    vshift?: number
  }>[]
}

export interface JpegXlSequence {
  /** Headers include internal reference frames; progressive passes are not timed frames. */
  headers(signal?: AbortSignal): AsyncIterable<Readonly<JpegXlFrameStructure>>
  frames(signal?: AbortSignal): AsyncIterable<JpegXlSequenceFrame>
  layers(signal?: AbortSignal): AsyncIterable<JpegXlNativeLayer>
  /** Replays dependencies from the start without retaining a decoded sequence. */
  frame(index: number, signal?: AbortSignal): Promise<JpegXlSequenceFrame>
  /** Replays from the start to a tick in the first loop, without a checkpoint cache. */
  frameAtTicks(ticks: bigint | string, signal?: AbortSignal): Promise<JpegXlSequenceFrame>
  close(): Promise<void>
}

const copyHeader = (header: Readonly<JpegXlFrameStructure>): Readonly<JpegXlFrameStructure> =>
  Object.freeze({ ...header, iccProfile: header.iccProfile?.slice() })

const replace: JpegXlBlending = { mode: 0, source: 0, alphaChannel: 0, clamp: false }
const clampAlpha = (value: number): number => Math.max(0, Math.min(1, value))

const composite = (
  header: Readonly<JpegXlFrameStructure>,
  layer: readonly Float64Array[],
  references: readonly (readonly Float64Array[] | undefined)[],
  signal?: AbortSignal,
): readonly Float64Array[] => {
  const result: Float64Array[] = []
  const colorCount = header.colorChannels
  for (let channel = 0; channel < layer.length; channel++) {
    const blend =
      channel < colorCount
        ? (header.blending ?? replace)
        : (header.extraChannelBlending?.[channel - colorCount] ?? replace)
    const background = references[blend.source]
    const output = background?.[channel]?.slice() ?? new Float64Array(header.width * header.height)
    const foreground = layer[channel]
    if (!foreground) throw invalidInput('JPEG XL composition channel is missing')
    const alphaIndex = colorCount + blend.alphaChannel
    const alpha = layer[alphaIndex]
    const backgroundAlpha = background?.[alphaIndex]
    const associated = header.extraChannels[blend.alphaChannel]?.associatedAlpha ?? false
    if ((blend.mode === 2 || blend.mode === 3) && !alpha)
      throw invalidInput('JPEG XL composition alpha channel is missing')
    const firstX = Math.max(0, -header.frameOriginX)
    const lastX = Math.min(header.frameWidth, header.width - header.frameOriginX)
    const firstY = Math.max(0, -header.frameOriginY)
    const lastY = Math.min(header.frameHeight, header.height - header.frameOriginY)
    for (let y = firstY; y < lastY; y++) {
      throwIfAborted(signal)
      for (let x = firstX; x < lastX; x++) {
        const source = y * header.frameWidth + x
        const target = (y + header.frameOriginY) * header.width + x + header.frameOriginX
        const front = foreground[source] ?? 0
        const back = output[target] ?? 0
        let value: number
        if (blend.mode === 0) value = front
        else if (blend.mode === 1) value = back + front
        else if (blend.mode === 4) value = back * (blend.clamp ? clampAlpha(front) : front)
        else {
          const a = blend.clamp ? clampAlpha(alpha?.[source] ?? 0) : (alpha?.[source] ?? 0)
          const b = backgroundAlpha?.[target] ?? 0
          if (blend.mode === 3) value = channel === alphaIndex ? back : back + a * front
          else {
            const combined = a + b * (1 - a)
            value =
              channel === alphaIndex
                ? combined
                : associated
                  ? front + back * (1 - a)
                  : combined <= 0
                    ? 0
                    : (front * a + back * b * (1 - a)) / combined
          }
        }
        output[target] = value
      }
    }
    result.push(output)
  }
  return Object.freeze(result)
}

export const openJpegXlSequence = async (
  input: ImageInput,
  options: Readonly<OpenJpegXlSequenceOptions> = {},
): Promise<JpegXlSequence> => {
  const limits = resolveLimits(options.limits)
  const jpegLimits = resolveJpegXlLimits(options.limits)
  const maxDecodedPixels = options.maxDecodedPixels ?? limits.maxPixels
  if (!Number.isSafeInteger(maxDecodedPixels) || maxDecodedPixels < 1)
    throw invalidInput('JPEG XL maxDecodedPixels must be a positive safe integer')
  const source = await createImageSource(input, limits, options)
  const logical = new JpegXlCodestreamSource(
    source,
    await inspectJpegXlSource(source, jpegLimits, options),
  )
  const controller = new AbortController()
  const activeSignal = (signal?: AbortSignal) =>
    combineAbortSignals(combineAbortSignals(options.signal, controller.signal), signal) ??
    controller.signal
  const headers = (signal?: AbortSignal) =>
    iterateJpegXlFrameStructures(
      logical,
      limits,
      { signal: activeSignal(signal) },
      jpegLimits.maxHeaderBytes,
      jpegLimits,
    )
  async function* frames(signal?: AbortSignal): AsyncGenerator<JpegXlSequenceFrame> {
    const active = activeSignal(signal)
    const references: (readonly Float64Array[] | undefined)[] = new Array(4)
    const nativeReferences = new Map<
      number,
      { width: number; height: number; planes: readonly Float64Array[] }
    >()
    const xybReferences = new Map<number, JpegXlVarDctReference>()
    let dcPlanes: readonly [Float64Array, Float64Array, Float64Array] | undefined
    let decodedPixels = 0
    let index = 0,
      internalFrameIndex = 0,
      startTicks = 0n
    for await (const header of headers(active)) {
      const internal = internalFrameIndex++
      if (header.isPreview) continue
      decodedPixels += header.frameWidth * header.frameHeight
      if (!Number.isSafeInteger(decodedPixels) || decodedPixels > maxDecodedPixels)
        throw limitExceeded('JPEG XL sequence replay exceeds maxDecodedPixels')
      if (
        header.sampleFormat !== 'unsigned-integer' ||
        header.extraChannels.some((channel) => channel.bitDepth.sampleFormat !== 'unsigned-integer')
      )
        throw unsupportedOperation(
          'JPEG XL sequence native conversion is not supported for this frame',
        )
      if (
        header.encoding === 'modular' &&
        header.colorTransform === 'xyb' &&
        header.colorSemanticsTransfer.kind !== 'srgb' &&
        header.colorSemanticsTransfer.kind !== 'bt709' &&
        header.colorSemanticsTransfer.kind !== 'source-profile' &&
        header.colorSemanticsTransfer.kind !== 'gamma'
      )
        throw unsupportedOperation(
          'JPEG XL Modular XYB sequence rendering requires SDR sRGB output',
        )
      const referenceBytes = references.reduce(
        (sum, planes) => sum + (planes?.reduce((total, plane) => total + plane.byteLength, 0) ?? 0),
        0,
      )
      let nativeReferenceBytes = 0
      for (const reference of nativeReferences.values())
        for (const plane of reference.planes) nativeReferenceBytes += plane.byteLength
      for (const reference of xybReferences.values()) {
        for (const plane of reference.planes) nativeReferenceBytes += plane.byteLength
        nativeReferenceBytes += reference.alpha?.byteLength ?? 0
      }
      for (const plane of dcPlanes ?? []) nativeReferenceBytes += plane.byteLength
      const outputBytes = header.width * header.height * header.channelCount * 16
      const layerBytes = header.frameWidth * header.frameHeight * header.channelCount * 8
      const remaining =
        limits.maxDecodedBytes -
        referenceBytes -
        nativeReferenceBytes -
        outputBytes -
        layerBytes -
        (header.encoding === 'modular' && (header.frameFlags & 17) !== 0
          ? header.frameWidth * header.frameHeight * 32
          : 0)
      if (remaining < 1)
        throw limitExceeded('JPEG XL sequence references and output exceed maxDecodedBytes')
      if (
        header.encoding === 'modular' &&
        (header.gaborish || header.epfIterations > 0) &&
        header.codedWidth * header.codedHeight * 128 > remaining
      )
        throw limitExceeded('JPEG XL Modular filter planes exceed maxDecodedBytes')
      if (
        (header.upsampling !== 1 ||
          header.extraChannels.some(
            (channel, i) => channel.dimShift !== 0 || (header.extraChannelUpsampling[i] ?? 1) !== 1,
          )) &&
        header.frameWidth * header.frameHeight * header.channelCount * 24 > remaining
      )
        throw limitExceeded('JPEG XL reconstructed sequence planes exceed maxDecodedBytes')
      const sections: Uint8Array[] = []
      let compressedBytes = 0
      for (const section of header.sections) {
        compressedBytes += section.length
        if (compressedBytes > remaining)
          throw limitExceeded('JPEG XL sequence input exceeds maxDecodedBytes')
        sections.push(
          new Uint8Array(
            await readExactly(logical, section.offset, section.length, { signal: active }),
          ),
        )
      }
      let layer: readonly Float64Array[]
      if (header.frameType === 'dc') {
        const global = sections[0]
        if (!global) throw invalidInput('JPEG XL DC global section is missing')
        if (header.codedWidth * header.codedHeight * 128 + compressedBytes > remaining)
          throw limitExceeded('JPEG XL DC dependency exceeds maxDecodedBytes')
        if (header.encoding === 'modular') {
          dcPlanes = sections.slice(1).every((section) => section.length === 0)
            ? decodeJpegXlModularDcFrameSection(
                global,
                header.codedWidth,
                header.codedHeight,
                active,
              )
            : decodeJpegXlMultiGroupModularDcFrameSections(sections, header, active)
        } else {
          if (!dcPlanes) throw invalidInput('JPEG XL DC dependency is missing')
          const memory = new JpegXlVarDctMemoryLedger(remaining)
          try {
            const decoded = await decodeJpegXlDct8SectionCancellable(
              active,
              global,
              header,
              limits,
              memory,
              sections.length === 1 ? undefined : sections.slice(1),
              dcPlanes,
              true,
              xybReferences,
            )
            try {
              if (!decoded.dcPlanes)
                throw invalidInput('JPEG XL reconstructed DC dependency is missing')
              dcPlanes = decoded.dcPlanes
            } finally {
              decoded.release()
            }
          } finally {
            memory.releaseAll()
          }
        }
        continue
      }
      if (header.encoding === 'vardct') {
        if (
          (header.colorSemanticsTransfer.kind !== 'srgb' &&
            header.colorSemanticsTransfer.kind !== 'bt709' &&
            header.colorSemanticsTransfer.kind !== 'source-profile' &&
            header.colorSemanticsTransfer.kind !== 'gamma') ||
          header.extraChannels.some((channel) => channel.type !== 0) ||
          header.extraChannels.length > 1
        )
          throw unsupportedOperation(
            'JPEG XL sequence VarDCT native channels require SDR RGB and at most one alpha',
          )
        const global = sections[0]
        if (!global) throw invalidInput('JPEG XL VarDCT global section is missing')
        const memory = new JpegXlVarDctMemoryLedger(remaining)
        try {
          const decoded = await decodeJpegXlDct8SectionCancellable(
            active,
            global,
            {
              ...header,
              width: header.frameWidth,
              height: header.frameHeight,
              colorSemanticsTransfer: { kind: 'linear' },
            },
            { ...limits, maxDecodedBytes: remaining },
            memory,
            sections.length === 1 ? undefined : sections.slice(1),
            (header.frameFlags & 32) !== 0 ? dcPlanes : undefined,
            header.frameType === 'reference' || header.saveBeforeColorTransform,
            xybReferences,
          )
          try {
            if (header.frameType === 'reference' || header.saveBeforeColorTransform) {
              if (!decoded.dcPlanes)
                throw invalidInput('JPEG XL native reference output is missing')
              const encodedAlpha = decoded.nativeExtraPlanes?.[header.selectedAlphaChannel ?? 0]
              const alphaScale = 1 / (2 ** (header.alphaBitDepth ?? 8) - 1)
              const alpha =
                decoded.referenceAlpha ??
                (encodedAlpha
                  ? Float64Array.from(encodedAlpha, (value) => value * alphaScale)
                  : undefined)
              xybReferences.set(header.saveAsReference, {
                width: header.frameWidth,
                height: header.frameHeight,
                planes: decoded.dcPlanes,
                ...(alpha ? { alpha, associatedAlpha: header.alphaAssociated } : {}),
              })
              nativeReferences.delete(header.saveAsReference)
              references[header.saveAsReference] = undefined
              if (header.frameType === 'reference') continue
              const rgb = convertJpegXlNativeXybPlanes(
                decoded.dcPlanes,
                header.opsinInverse,
                active,
              )
              layer = [...rgb.slice(0, header.colorChannels), ...(alpha ? [alpha] : [])]
            } else {
              const channels = header.alphaBitDepth === undefined ? 3 : 4
              const view = new DataView(
                decoded.data.buffer,
                decoded.data.byteOffset,
                decoded.data.byteLength,
              )
              const output = Array.from(
                { length: header.channelCount },
                () => new Float64Array(header.frameWidth * header.frameHeight),
              )
              for (let channel = 0; channel < header.channelCount; channel++) {
                const plane = output[channel]
                if (!plane) throw invalidInput('JPEG XL VarDCT output channel is missing')
                for (let i = 0; i < plane.length; i++) {
                  const sourceChannel = channel < header.colorChannels ? channel : 3
                  const value = view.getFloat32((i * channels + sourceChannel) * 4, false)
                  plane[i] = channel >= header.colorChannels ? value : jpegXlLinearToSrgb(value)
                }
              }
              layer = output
            }
          } finally {
            decoded.release()
          }
        } finally {
          memory.releaseAll()
        }
      } else {
        const native = await decodeJpegXlNativeModularPlanesCancellable(
          sections,
          header,
          { ...limits, maxDecodedBytes: remaining },
          active,
          true,
        )
        const xyb = header.colorTransform === 'xyb'
        const colorCount = xyb ? 3 : header.colorChannels
        const working: Float64Array[] = []
        if (xyb) {
          const y = native.planes[0],
            x = native.planes[1],
            b = native.planes[2]
          if (!x || !y || !b) throw invalidInput('JPEG XL native XYB color planes are missing')
          const outputX = new Float64Array(x.length),
            outputY = new Float64Array(y.length),
            outputB = new Float64Array(b.length)
          for (let i = 0; i < y.length; i++) {
            outputX[i] = x[i]! * native.dcQuantization[0]
            outputY[i] = y[i]! * native.dcQuantization[1]
            outputB[i] = (b[i]! + y[i]!) * native.dcQuantization[2]
          }
          working.push(outputX, outputY, outputB)
        }
        for (let channel = xyb ? 3 : 0; channel < native.planes.length; channel++) {
          const plane = native.planes[channel]!
          const depth =
            channel < colorCount
              ? header.bitDepth
              : header.extraChannels[channel - colorCount]?.bitDepth.bits
          if (depth === undefined) throw invalidInput('JPEG XL native channel depth is missing')
          const scale = 1 / (2 ** depth - 1)
          const output = new Float64Array(plane.length)
          for (let i = 0; i < plane.length; i++) output[i] = plane[i]! * scale
          working.push(output)
        }
        if (header.colorTransform === 'ycbcr')
          for (let c = 0; c < colorCount; c++) {
            const plane = working[c],
              layout = native.layouts[c]
            if (!plane || !layout) throw invalidInput('JPEG XL native chroma layout is missing')
            working[c] = reconstructJpegXlChroma(
              plane,
              layout.width,
              layout.height,
              header.codedWidth,
              header.codedHeight,
              layout.hshift ?? 0,
              layout.vshift ?? 0,
              active,
            )
          }
        if (header.gaborish || header.epfIterations > 0)
          filterJpegXlModularPlanes(working, xyb ? { ...header, colorChannels: 3 } : header, active)
        const extraFactors = header.extraChannels.map(
          (channel, i) => (header.extraChannelUpsampling[i] ?? 1) * 2 ** channel.dimShift,
        )
        const lateExtras =
          header.upsampling !== 1 && extraFactors.every((factor) => factor === header.upsampling)
        if (!lateExtras)
          for (let i = 0; i < extraFactors.length; i++) {
            const factor = extraFactors[i]!,
              plane = working[colorCount + i]
            if (!plane) throw invalidInput('JPEG XL native extra plane is missing')
            working[colorCount + i] = upsampleJpegXlNativePlane(
              plane,
              Math.ceil(header.frameWidth / factor),
              Math.ceil(header.frameHeight / factor),
              factor,
              header.frameWidth,
              header.frameHeight,
              header,
              active,
            )
          }
        if (
          header.upsampling !== 1 &&
          !lateExtras &&
          (native.frameFeatures?.patches.length ?? 0) > 0
        )
          throw unsupportedOperation(
            'JPEG XL patches require matching color and extra-channel reconstruction grids',
          )
        for (const patch of native.frameFeatures?.patches ?? []) {
          const reference = xyb
            ? xybReferences.get(patch.referenceId)
            : nativeReferences.get(patch.referenceId)
          if (!reference) throw invalidInput('JPEG XL Modular patch reference is missing')
          const source =
            xyb && 'alpha' in reference && reference.alpha
              ? [...reference.planes, reference.alpha]
              : reference.planes
          applyJpegXlPatch(
            working,
            header.codedWidth,
            source,
            reference.width,
            reference.height,
            colorCount,
            header.extraChannels,
            patch,
            active,
          )
        }
        applyJpegXlModularFeatures(working, header, native.frameFeatures, 'splines', active)
        if (header.upsampling !== 1)
          for (let c = 0; c < (lateExtras ? working.length : colorCount); c++) {
            const plane = working[c]
            if (!plane) throw invalidInput('JPEG XL native upsampling input is missing')
            working[c] = upsampleJpegXlNativePlane(
              plane,
              header.codedWidth,
              header.codedHeight,
              header.upsampling,
              header.frameWidth,
              header.frameHeight,
              header,
              active,
            )
          }
        applyJpegXlModularFeatures(working, header, native.frameFeatures, 'noise', active)
        if (
          header.colorTransform === 'ycbcr' &&
          (header.frameType === 'reference' || header.saveBeforeColorTransform)
        ) {
          nativeReferences.set(header.saveAsReference, {
            width: header.frameWidth,
            height: header.frameHeight,
            planes: working,
          })
          if (header.frameType === 'reference') continue
        }
        if (xyb) {
          const first = working[0],
            second = working[1],
            third = working[2]
          if (!first || !second || !third)
            throw invalidInput('JPEG XL native XYB output is missing')
          const planes = [first, second, third] as const
          if (header.frameType === 'reference' || header.saveBeforeColorTransform) {
            const alpha = working[3 + (header.selectedAlphaChannel ?? 0)]
            xybReferences.set(header.saveAsReference, {
              width: header.frameWidth,
              height: header.frameHeight,
              planes,
              ...(alpha ? { alpha, associatedAlpha: header.alphaAssociated } : {}),
            })
            nativeReferences.delete(header.saveAsReference)
            references[header.saveAsReference] = undefined
            if (header.frameType === 'reference') continue
          }
          const rgb = convertJpegXlNativeXybPlanes(planes, header.opsinInverse, active)
          layer = [...rgb.slice(0, header.colorChannels), ...working.slice(3)]
        } else layer = header.colorTransform === 'ycbcr' ? jpegXlYcbcrToRgb(working) : working
      }
      if (header.frameType === 'reference') {
        if (header.colorTransform !== 'none')
          throw unsupportedOperation(
            'JPEG XL sequence transformed reference frames require native XYB storage',
          )
        nativeReferences.set(header.saveAsReference, {
          width: header.frameWidth,
          height: header.frameHeight,
          planes: layer,
        })
        references[header.saveAsReference] = undefined
        xybReferences.delete(header.saveAsReference)
        continue
      }
      const canvas = composite(header, layer, references, active)
      if (!header.isLast && (header.duration === 0 || header.saveAsReference !== 0)) {
        if (
          header.saveBeforeColorTransform &&
          header.colorTransform === 'xyb' &&
          !xybReferences.has(header.saveAsReference)
        )
          throw unsupportedOperation(
            'JPEG XL sequence pre-transform reference storage is not supported',
          )
        references[header.saveAsReference] = canvas
        if (header.saveBeforeColorTransform && header.colorTransform === 'none')
          nativeReferences.set(header.saveAsReference, {
            width: header.frameWidth,
            height: header.frameHeight,
            planes: layer,
          })
        else if (header.colorTransform !== 'ycbcr' || !header.saveBeforeColorTransform)
          nativeReferences.delete(header.saveAsReference)
        if (!header.saveBeforeColorTransform) xybReferences.delete(header.saveAsReference)
      }
      if (header.frameType !== 'regular' || ((header.duration ?? 0) === 0 && !header.isLast))
        continue
      if (index >= limits.maxFrames)
        throw limitExceeded('JPEG XL displayed frame count exceeds maxFrames')
      // Yield copies: a caller may mutate or retain a frame without altering reference state.
      const orientation = options.orientation === 'apply' ? header.orientation : 1
      const width = orientation >= 5 ? header.height : header.width
      const height = orientation >= 5 ? header.width : header.height
      const origin = jpegXlEncodedPoint(0, 0, header.width, header.height, orientation)
      const nextColumn = jpegXlEncodedPoint(1, 0, header.width, header.height, orientation)
      const nextRow = jpegXlEncodedPoint(0, 1, header.width, header.height, orientation)
      const firstIndex = origin[1] * header.width + origin[0]
      const columnStep = (nextColumn[1] - origin[1]) * header.width + nextColumn[0] - origin[0]
      const rowStep = (nextRow[1] - origin[1]) * header.width + nextRow[0] - origin[0]
      const output = canvas.map((plane) => {
        if (orientation === 1) return plane.slice()
        const rotated = new Float64Array(plane.length)
        for (let y = 0; y < height; y++) {
          throwIfAborted(active)
          let sourceIndex = firstIndex + y * rowStep
          for (let x = 0; x < width; x++, sourceIndex += columnStep)
            rotated[y * width + x] = plane[sourceIndex] ?? 0
        }
        return rotated
      })
      const sourceSemantics = jpegXlSourceColorSemantics(header)
      const colorSemantics: PixelColorSemantics =
        header.colorTransform === 'xyb'
          ? Object.freeze({
              ...sourceSemantics,
              family: header.colorChannels === 1 ? 'gray' : 'rgb',
              transfer: Object.freeze({ kind: 'srgb' }),
            })
          : sourceSemantics
      yield Object.freeze({
        index: index++,
        internalFrameIndex: internal,
        startTicks: startTicks.toString(),
        durationTicks: header.duration ?? 0,
        header: copyHeader(header),
        colorSemantics,
        planes: Object.freeze(output),
        width,
        height,
      })
      startTicks += BigInt(header.duration ?? 0)
    }
  }
  async function* layers(signal?: AbortSignal): AsyncGenerator<JpegXlNativeLayer> {
    const active = activeSignal(signal)
    const references = new Map<number, JpegXlVarDctReference>()
    let dcPlanes: readonly [Float64Array, Float64Array, Float64Array] | undefined
    let internalFrameIndex = 0,
      decodedPixels = 0
    for await (const header of headers(active)) {
      const index = internalFrameIndex++
      if (header.isPreview) continue
      decodedPixels += header.frameWidth * header.frameHeight
      if (!Number.isSafeInteger(decodedPixels) || decodedPixels > maxDecodedPixels)
        throw limitExceeded('JPEG XL native layer replay exceeds maxDecodedPixels')
      let retainedBytes = dcPlanes?.reduce((sum, plane) => sum + plane.byteLength, 0) ?? 0
      for (const reference of references.values()) {
        retainedBytes += reference.planes.reduce((sum, plane) => sum + plane.byteLength, 0)
        retainedBytes += reference.alpha?.byteLength ?? 0
      }
      const saving =
        header.frameType === 'reference' ||
        (!header.isLast &&
          header.saveBeforeColorTransform &&
          (header.duration === 0 || header.saveAsReference !== 0))
      const copyBytes =
        saving || header.frameType === 'dc' ? header.frameWidth * header.frameHeight * 32 : 0
      const available =
        limits.maxDecodedBytes -
        retainedBytes -
        copyBytes -
        2 * (header.iccProfile?.byteLength ?? 0)
      if (available < 1) throw limitExceeded('JPEG XL native references exceed maxDecodedBytes')
      const sections: Uint8Array[] = []
      let bytes = 0
      for (const section of header.sections) {
        bytes += section.length
        if (bytes * 2 > available)
          throw limitExceeded('JPEG XL native layer input exceeds maxDecodedBytes')
        sections.push(
          new Uint8Array(
            await readExactly(logical, section.offset, section.length, { signal: active }),
          ),
        )
      }
      if (header.encoding === 'vardct') {
        const global = sections[0]
        if (!global) throw invalidInput('JPEG XL native VarDCT global section is missing')
        const memory = new JpegXlVarDctMemoryLedger(available - bytes)
        try {
          const decoded = await decodeJpegXlDct8SectionCancellable(
            active,
            global,
            { ...header, width: header.frameWidth, height: header.frameHeight },
            { ...limits, maxDecodedBytes: available - bytes },
            memory,
            sections.length === 1 ? undefined : sections.slice(1),
            (header.frameFlags & 32) !== 0 ? dcPlanes : undefined,
            true,
            references,
          )
          try {
            if (!decoded.dcPlanes) throw invalidInput('JPEG XL native XYB output is missing')
            if (header.frameType === 'dc' || saving) {
              const copied = [
                decoded.dcPlanes[0].slice(),
                decoded.dcPlanes[1].slice(),
                decoded.dcPlanes[2].slice(),
              ] as const
              if (header.frameType === 'dc') dcPlanes = copied
              else {
                const encodedAlpha = decoded.nativeExtraPlanes?.[header.selectedAlphaChannel ?? 0]
                const scale = 1 / (2 ** (header.alphaBitDepth ?? 8) - 1)
                const alpha =
                  decoded.referenceAlpha?.slice() ??
                  (encodedAlpha
                    ? Float64Array.from(encodedAlpha, (value) => value * scale)
                    : undefined)
                references.set(header.saveAsReference, {
                  width: decoded.width,
                  height: decoded.height,
                  planes: copied,
                  ...(alpha ? { alpha, associatedAlpha: header.alphaAssociated } : {}),
                })
              }
            } else if (!header.isLast && (header.duration === 0 || header.saveAsReference !== 0))
              references.delete(header.saveAsReference)

            const layouts = [
              ...Array.from({ length: 3 }, () => ({
                width: decoded.width,
                height: decoded.height,
              })),
              ...header.extraChannels.map((channel, i) => {
                const factor = (header.extraChannelUpsampling[i] ?? 1) * 2 ** channel.dimShift
                return {
                  width: Math.ceil(header.frameWidth / factor),
                  height: Math.ceil(header.frameHeight / factor),
                }
              }),
            ]
            yield Object.freeze({
              internalFrameIndex: index,
              header: copyHeader(header),
              domain: 'xyb' as const,
              planes: Object.freeze([...decoded.dcPlanes, ...(decoded.nativeExtraPlanes ?? [])]),
              layouts: Object.freeze(layouts),
            })
          } finally {
            decoded.release()
          }
        } finally {
          memory.releaseAll()
        }
        continue
      }
      const decoded = await decodeJpegXlNativeModularPlanesCancellable(
        sections,
        header,
        { ...limits, maxDecodedBytes: available - bytes },
        active,
        true,
      )
      if (header.frameType === 'dc') {
        const global = sections[0]
        if (!global) throw invalidInput('JPEG XL native DC global section is missing')
        dcPlanes = sections.slice(1).every((section) => section.length === 0)
          ? decodeJpegXlModularDcFrameSection(global, header.codedWidth, header.codedHeight, active)
          : decodeJpegXlMultiGroupModularDcFrameSections(sections, header, active)
      } else if (saving && header.colorTransform === 'xyb') {
        const y = decoded.planes[0],
          x = decoded.planes[1],
          b = decoded.planes[2]
        if (!x || !y || !b) throw invalidInput('JPEG XL native reference planes are missing')
        const outputX = new Float64Array(x.length),
          outputY = new Float64Array(y.length),
          outputB = new Float64Array(b.length)
        for (let i = 0; i < y.length; i++) {
          outputX[i] = x[i]! * decoded.dcQuantization[0]
          outputY[i] = y[i]! * decoded.dcQuantization[1]
          outputB[i] = (b[i]! + y[i]!) * decoded.dcQuantization[2]
        }
        const planes: [Float64Array, Float64Array, Float64Array] = [outputX, outputY, outputB]
        if (header.gaborish || header.epfIterations > 0)
          filterJpegXlModularPlanes(planes, { ...header, colorChannels: 3 }, active)
        const encodedAlpha = decoded.planes[3 + (header.selectedAlphaChannel ?? 0)]
        const scale = 1 / (2 ** (header.alphaBitDepth ?? 8) - 1)
        let alpha: Float64Array | undefined = encodedAlpha
          ? Float64Array.from(encodedAlpha, (value) => value * scale)
          : undefined
        const alphaFactor =
          (header.extraChannelUpsampling[header.selectedAlphaChannel ?? 0] ?? 1) *
          2 ** (header.extraChannels[header.selectedAlphaChannel ?? 0]?.dimShift ?? 0)
        if (alpha && alphaFactor !== header.upsampling) {
          if (header.upsampling !== 1 && (decoded.frameFeatures?.patches.length ?? 0) > 0)
            throw unsupportedOperation('JPEG XL patches require matching reconstruction grids')
          alpha = upsampleJpegXlNativePlane(
            alpha,
            Math.ceil(header.frameWidth / alphaFactor),
            Math.ceil(header.frameHeight / alphaFactor),
            alphaFactor,
            header.frameWidth,
            header.frameHeight,
            header,
            active,
          )
        }
        for (const patch of decoded.frameFeatures?.patches ?? []) {
          const reference = references.get(patch.referenceId)
          if (!reference) throw invalidInput('JPEG XL native patch reference is missing')
          applyJpegXlPatch(
            alpha ? [...planes, alpha] : planes,
            header.codedWidth,
            reference.alpha ? [...reference.planes, reference.alpha] : reference.planes,
            reference.width,
            reference.height,
            3,
            header.extraChannels,
            patch,
            active,
          )
        }
        applyJpegXlModularFeatures(planes, header, decoded.frameFeatures, 'splines', active)
        if (header.upsampling !== 1) {
          for (let c = 0; c < 3; c++)
            planes[c] = upsampleJpegXlNativePlane(
              planes[c]!,
              header.codedWidth,
              header.codedHeight,
              header.upsampling,
              header.frameWidth,
              header.frameHeight,
              header,
              active,
            )
          if (alpha && alphaFactor === header.upsampling)
            alpha = upsampleJpegXlNativePlane(
              alpha,
              header.codedWidth,
              header.codedHeight,
              alphaFactor,
              header.frameWidth,
              header.frameHeight,
              header,
              active,
            )
        }
        applyJpegXlModularFeatures(planes, header, decoded.frameFeatures, 'noise', active)
        references.set(header.saveAsReference, {
          width: header.frameWidth,
          height: header.frameHeight,
          planes,
          ...(alpha ? { alpha, associatedAlpha: header.alphaAssociated } : {}),
        })
      } else if (!header.isLast && (header.duration === 0 || header.saveAsReference !== 0))
        references.delete(header.saveAsReference)
      yield Object.freeze({
        internalFrameIndex: index,
        header: copyHeader(header),
        domain: 'modular' as const,
        ...(decoded.frameFeatures ? { frameFeatures: decoded.frameFeatures } : {}),
        dcQuantization: decoded.dcQuantization,
        planes: decoded.planes,
        layouts: decoded.layouts,
      })
    }
  }
  let running: AsyncGenerator<unknown, void, unknown> | undefined
  const serialize = <T>(
    operation: () => AsyncGenerator<T, void, unknown>,
  ): AsyncGenerator<T, void, unknown> => {
    const iterator = (async function* () {
      throwIfAborted(controller.signal)
      if (running) throw unsupportedOperation('JPEG XL sequence already has an active iterator')
      const active = operation()
      running = active
      try {
        yield* active
      } finally {
        if (running === active) running = undefined
      }
    })()
    return iterator
  }
  const serialFrames = (signal?: AbortSignal) => serialize(() => frames(signal))
  return Object.freeze({
    headers: (signal?: AbortSignal) =>
      serialize(async function* () {
        for await (const header of headers(signal)) yield copyHeader(header)
      }),
    frames: serialFrames,
    layers: (signal?: AbortSignal) => serialize(() => layers(signal)),
    async frame(index: number, signal?: AbortSignal): Promise<JpegXlSequenceFrame> {
      if (!Number.isSafeInteger(index) || index < 0)
        throw invalidInput('JPEG XL frame index is invalid')
      for await (const frame of serialFrames(signal)) if (frame.index === index) return frame
      throw invalidInput('JPEG XL frame index is outside the sequence')
    },
    async frameAtTicks(ticks: bigint | string, signal?: AbortSignal): Promise<JpegXlSequenceFrame> {
      if (
        (typeof ticks !== 'bigint' &&
          (typeof ticks !== 'string' || !/^(0|[1-9][0-9]*)$/.test(ticks))) ||
        ticks.toString().length > 32
      )
        throw invalidInput('JPEG XL seek time must be a nonnegative integer tick count')
      const target = BigInt(ticks)
      if (target < 0n) throw invalidInput('JPEG XL seek time must be nonnegative')
      for await (const frame of serialFrames(signal)) {
        const start = BigInt(frame.startTicks)
        if (target >= start && target < start + BigInt(frame.durationTicks)) return frame
      }
      throw invalidInput('JPEG XL seek time is outside the first animation loop')
    },
    async close(): Promise<void> {
      controller.abort()
      await running?.return(undefined)
      running = undefined
    },
  })
}

/** Adapts an explicitly selected displayed frame to the existing still decoder contract. */
export const createJpegXlSequenceFrameDecoder = async (
  source: ImageSource,
  limits: Readonly<ImageLimits>,
  options: Readonly<DecoderOptions>,
  header: Readonly<JpegXlFrameStructure>,
): Promise<ImageDecoder> => {
  const index = options.frame
  if (index === undefined || !Number.isSafeInteger(index) || index < 0)
    throw invalidInput('JPEG XL animation requires an explicit nonnegative displayed frame index')
  if (header.extraChannels.length > 1 || header.extraChannels.some((channel) => channel.type !== 0))
    throw unsupportedOperation('JPEG XL animation extra channels require the explicit sequence API')
  const pixelFormat = jpegXlDecodedPixelFormat(header)
  if (pixelFormat.endsWith('f32'))
    throw unsupportedOperation('JPEG XL still animation HDR rendering is not supported')
  const colorSemantics = jpegXlPixelColorSemantics(header)
  const channels = pixelFormat.startsWith('gray') ? 1 : pixelFormat.startsWith('rgba') ? 4 : 3
  const bytes = pixelFormat.endsWith('16') ? 2 : 1
  const ranges = Array.from({ length: channels }, (_, channel) => ({
    black: 0,
    white: 2 ** (channel === 3 ? (header.alphaBitDepth ?? header.bitDepth) : header.bitDepth) - 1,
  }))
  return {
    width: header.width,
    height: header.height,
    pixelFormat,
    colorSemantics,
    capabilities: { sequential: true, regionDecode: true, scaledDecode: false, progressive: false },
    async *decode(request = {}) {
      if ((request.scaleDenominator ?? 1) !== 1)
        throw unsupportedOperation('JPEG XL sequence scaled decoding is unsupported')
      const x = request.x ?? 0,
        y = request.y ?? 0
      const width = request.width ?? header.width - x,
        height = request.height ?? header.height - y
      if (
        ![x, y, width, height].every(Number.isSafeInteger) ||
        x < 0 ||
        y < 0 ||
        width < 1 ||
        height < 1 ||
        x + width > header.width ||
        y + height > header.height
      )
        throw invalidInput('JPEG XL sequence crop is invalid')
      const signal = combineAbortSignals(options.signal, request.signal)
      const sequence = await openJpegXlSequence(source, { limits, ...(signal ? { signal } : {}) })
      try {
        const frame = await sequence.frame(index, signal)
        for (let row = 0; row < height; row++) {
          throwIfAborted(signal)
          const stride = width * channels * bytes
          const data = new Uint8Array(stride)
          const view = new DataView(data.buffer)
          for (let column = 0; column < width; column++)
            for (let channel = 0; channel < channels; channel++) {
              const nativeChannel =
                channel === 3
                  ? header.colorChannels + (header.selectedAlphaChannel ?? 0)
                  : header.colorChannels === 1
                    ? 0
                    : channel
              const normalized =
                frame.planes[nativeChannel]?.[(y + row) * header.width + x + column] ?? 0
              const value = Math.round(
                Math.max(0, Math.min(1, normalized)) * (ranges[channel]?.white ?? 255),
              )
              const offset = (column * channels + channel) * bytes
              if (bytes === 2) view.setUint16(offset, value, false)
              else data[offset] = value
            }
          yield {
            x: 0,
            y: row,
            width,
            height: 1,
            stride,
            format: pixelFormat,
            data,
            colorSemantics,
            ...(bytes === 2 ? { displayRanges: ranges } : {}),
          }
        }
      } finally {
        await sequence.close()
      }
    },
  }
}
