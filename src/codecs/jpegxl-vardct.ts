import { combineAbortSignals, throwIfAborted } from '../abort.ts'
import type { DecodeRequest, DecoderOptions, ImageDecoder } from '../codec.ts'
import type { PixelColorSemantics } from '../color.ts'
import { ImageError, invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { EvidenceContext } from '../evidence.ts'
import type { ImageLimits } from '../limits.ts'
import { pixelBytesPerPixel, type PixelBlock } from '../pixel.ts'
import { type ImageSource, readExactly } from '../source.ts'
import { decodeJpegCoefficientImage, type JpegRegion } from './jpeg-baseline.ts'
import type { JpegCoefficientImage } from './jpeg-coefficients.ts'
import { inspectJpegXlSource, JpegXlCodestreamSource } from './jpegxl-container.ts'
import {
  decodeJpegXlModularDcFrameSection,
  decodeJpegXlMultiGroupModularDcFrameSections,
  jpegXlPixelColorSemantics,
  readJpegXlSourceFrameStructures,
} from './jpegxl-decode.ts'
import { decodeJpegXlJpegPixelImage } from './jpegxl-jpeg-reconstruct-source.ts'
import { decodeJpegXlJpegPixels } from './jpegxl-jpeg-pixels.ts'
import { resolveJpegXlLimits } from './jpegxl-limits.ts'
import {
  JpegXlVarDctMemoryLedger,
  preflightJpegXlVarDctWorkingMemory,
  retainedTypedArrayBytes,
} from './jpegxl-vardct-memory.ts'
import {
  decodeJpegXlDct8Section,
  type JpegXlVarDctPixels,
  type JpegXlVarDctReference,
} from './jpegxl-vardct-render.ts'

const scaleDenominator = (request: Readonly<DecodeRequest>): 1 | 2 | 4 | 8 => {
  const scale = request.scaleDenominator ?? 1
  if (scale !== 1 && scale !== 2 && scale !== 4 && scale !== 8) {
    throw invalidInput('JPEG XL decode scale denominator must be 1, 2, 4, or 8')
  }
  return scale
}

const decodeRegion = (
  width: number,
  height: number,
  request: Readonly<DecodeRequest>,
): JpegRegion => {
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
    throw invalidInput('JPEG XL decode region is invalid')
  }
  return Object.freeze({ x, y, width: outputWidth, height: outputHeight })
}

class JpegDerivedJpegXlDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: 'rgb8' | 'gray8'
  readonly colorSemantics: PixelColorSemantics
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: true,
    scaledDecode: true,
    progressive: false,
  })
  readonly #colorMaps: readonly [Int32Array, Int32Array]
  readonly #image: JpegCoefficientImage
  readonly #signal: AbortSignal | undefined

  constructor(
    image: JpegCoefficientImage,
    colorMaps: readonly [Int32Array, Int32Array],
    colorSemantics: PixelColorSemantics,
    signal: AbortSignal | undefined,
    grayscale = false,
  ) {
    this.#colorMaps = colorMaps
    this.width = image.width
    this.height = image.height
    this.colorSemantics = colorSemantics
    this.pixelFormat = grayscale || image.components.length === 1 ? 'gray8' : 'rgb8'
    this.#image = grayscale
      ? { ...image, colorTransform: 'gray', components: image.components.slice(0, 1) }
      : image
    this.#signal = signal
  }

  async *decode(request: Readonly<DecodeRequest> = {}): AsyncGenerator<PixelBlock> {
    const scale = scaleDenominator(request)
    const outputWidth = Math.ceil(this.width / scale)
    const outputHeight = Math.ceil(this.height / scale)
    const region = decodeRegion(outputWidth, outputHeight, request)
    throwIfAborted(this.#signal)
    throwIfAborted(request.signal)
    if (scale === 1) {
      const signal = combineAbortSignals(this.#signal, request.signal)
      yield* decodeJpegXlJpegPixels(
        this.#image,
        { ...region, ...(signal ? { signal } : {}) },
        this.#colorMaps,
      )
      return
    }
    for await (const block of decodeJpegCoefficientImage(this.#image, region, scale)) {
      throwIfAborted(this.#signal)
      throwIfAborted(request.signal)
      if (this.pixelFormat === 'gray8') {
        const data = new Uint8Array(block.width * block.height)
        for (let y = 0; y < block.height; y += 1)
          for (let x = 0; x < block.width; x += 1)
            data[y * block.width + x] = block.data[y * block.stride + x * 3] ?? 0
        block.release?.()
        yield {
          x: block.x,
          y: block.y,
          width: block.width,
          height: block.height,
          data,
          format: 'gray8',
          stride: block.width,
        }
      } else yield block
    }
  }
}

export const createJpegDerivedJpegXlDecoder = async (
  source: ImageSource,
  logical: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
): Promise<ImageDecoder> => {
  const jpegXlLimits = resolveJpegXlLimits()
  const frames = await readJpegXlSourceFrameStructures(
    logical,
    limits,
    options,
    jpegXlLimits.maxHeaderBytes,
    jpegXlLimits,
  )
  const displayFrame = frames.at(-1)
  if (!displayFrame) throw invalidInput('JPEG XL display frame is missing')
  const { image, colorMaps } = await decodeJpegXlJpegPixelImage(source, {
    limits,
    ...(options.signal ? { signal: options.signal } : {}),
  })
  const rowWorkingBytes = image.width * (3 * (16 * 4 + 12 + 4) + 3)
  if (
    image.coefficientBytes + colorMaps[0].byteLength + colorMaps[1].byteLength + rowWorkingBytes >
    limits.maxDecodedBytes
  )
    throw limitExceeded('JPEG XL JPEG coefficient and row working storage exceeds maxDecodedBytes')
  return new JpegDerivedJpegXlDecoder(
    image,
    colorMaps,
    Object.freeze({
      ...jpegXlPixelColorSemantics(displayFrame),
      provenance: 'decoder-converted',
    }),
    options.signal,
    displayFrame.colorChannels === 1,
  )
}

class VarDctJpegXlDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: JpegXlVarDctPixels['format']
  readonly colorSemantics: PixelColorSemantics
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: false,
    scaledDecode: false,
    progressive: false,
  })
  readonly #displayRanges: readonly { readonly black: number; readonly white: number }[]
  #pixels: JpegXlVarDctPixels | undefined
  readonly #signal: AbortSignal | undefined
  readonly #memory: JpegXlVarDctMemoryLedger
  readonly #evidence: EvidenceContext | undefined

  constructor(
    pixels: JpegXlVarDctPixels,
    colorSemantics: PixelColorSemantics,
    signal: AbortSignal | undefined,
    memory: JpegXlVarDctMemoryLedger,
    evidence: EvidenceContext | undefined,
    bitDepth = 8,
    alphaBitDepth?: number,
    floatPeak = 1,
  ) {
    this.width = pixels.width
    this.height = pixels.height
    this.pixelFormat = pixels.format
    this.colorSemantics = colorSemantics
    this.#displayRanges = Object.freeze(
      Array.from(
        { length: pixels.format.startsWith('gray') ? 1 : pixels.format.startsWith('rgba') ? 4 : 3 },
        (_, index) =>
          Object.freeze({
            black: 0,
            white: pixels.format.endsWith('f32')
              ? index === 3
                ? 1
                : floatPeak
              : 2 ** (index === 3 ? (alphaBitDepth ?? bitDepth) : bitDepth) - 1,
          }),
      ),
    )
    this.#pixels = pixels
    this.#signal = signal
    this.#memory = memory
    this.#evidence = evidence
  }

  get managedPeakBytes(): number {
    return this.#memory.peakBytes
  }

  async *decode(request: Readonly<DecodeRequest> = {}): AsyncGenerator<PixelBlock> {
    if ((request.scaleDenominator ?? 1) !== 1) {
      throw unsupportedOperation('JPEG XL VarDCT scaled decode is not supported yet')
    }
    const region = decodeRegion(this.width, this.height, request)
    const pixels = this.#pixels
    if (!pixels) {
      throw unsupportedOperation('JPEG XL selected VarDCT decoder output was already consumed')
    }
    const channels = pixelBytesPerPixel(this.pixelFormat)
    const stride = region.width * channels
    const sourceStride = this.width * channels
    let complete = false
    this.#evidence?.operation({ operationId: 'selected-vardct-row-emission', phase: 'start' })
    try {
      throwIfAborted(this.#signal)
      throwIfAborted(request.signal)
      for (let row = 0; row < region.height; row += 1) {
        throwIfAborted(this.#signal)
        throwIfAborted(request.signal)
        const rowLease = this.#memory.retain('jpegxl-vardct-row-block-copy', stride)
        const sourceOffset = (region.y + row) * sourceStride + region.x * channels
        let data: Uint8Array
        try {
          data = pixels.data.slice(sourceOffset, sourceOffset + stride)
        } catch (error) {
          rowLease.release()
          throw error
        }
        this.#evidence?.block({
          stage: 'decoded',
          blockId: `jpegxl-vardct-row-${row}`,
          width: region.width,
          height: 1,
        })
        yield Object.freeze({
          x: 0,
          y: row,
          width: region.width,
          height: 1,
          stride,
          format: this.pixelFormat,
          data,
          colorSemantics: this.colorSemantics,
          ...(this.pixelFormat.endsWith('16') || this.pixelFormat.endsWith('f32')
            ? { displayRanges: this.#displayRanges }
            : {}),
          release: rowLease.release,
        })
      }
      complete = true
      this.#evidence?.operation({
        operationId: 'selected-vardct-row-emission',
        phase: 'complete',
      })
    } finally {
      if (!complete) {
        this.#evidence?.cancellation('selected-vardct-row-emission')
        this.#evidence?.operation({
          operationId: 'selected-vardct-row-emission',
          phase: 'cancelled',
        })
      }
      if (this.#pixels === pixels) this.#pixels = undefined
      pixels.release()
    }
  }
}

const evidenceFailureCode = (error: unknown): string =>
  error instanceof ImageError ? error.code : 'UNKNOWN'

export const createJpegXlVarDctDecoder = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
): Promise<ImageDecoder> => {
  const jpegXlLimits = resolveJpegXlLimits()
  const structure = await inspectJpegXlSource(source, jpegXlLimits, options)
  if (structure.metadataBoxes.some(({ type }) => type === 'jbrd')) {
    return createJpegDerivedJpegXlDecoder(
      source,
      new JpegXlCodestreamSource(source, structure),
      limits,
      options,
    )
  }
  const logical = new JpegXlCodestreamSource(source, structure)
  const frames = await readJpegXlSourceFrameStructures(
    logical,
    limits,
    options,
    jpegXlLimits.maxHeaderBytes,
    jpegXlLimits,
  )
  const frame = frames.at(-1)
  if (frame?.frameType !== 'regular') {
    throw unsupportedOperation('JPEG XL static VarDCT final frame is missing')
  }
  const evidence = options.evidence?.child('jpegxl-selected-vardct')
  const memory = new JpegXlVarDctMemoryLedger(limits.maxDecodedBytes, evidence)
  evidence?.operation({ operationId: 'selected-vardct-materialization', phase: 'start' })
  try {
    const dependencyFrames = frames.slice(0, -1)
    const dcFrameCount = dependencyFrames.filter(({ frameType }) => frameType === 'dc').length
    let remainingDcFrames = dcFrameCount
    for (const dependency of dependencyFrames) {
      if (dependency.frameType === 'reference') {
        if (
          dependency.saveAsReference === 0 ||
          !dependency.saveBeforeColorTransform ||
          (dependency.frameFlags & 32) !== 0
        ) {
          throw unsupportedOperation('JPEG XL reference frame dependency is not supported')
        }
        continue
      }
      if (
        dependency.frameType !== 'dc' ||
        dependency.dcLevel !== remainingDcFrames ||
        (remainingDcFrames === dcFrameCount
          ? dependency.encoding !== 'modular' || (dependency.frameFlags & 32) !== 0
          : dependency.encoding !== 'vardct' || (dependency.frameFlags & 32) === 0)
      ) {
        throw unsupportedOperation('JPEG XL internal DC frame dependency is not supported')
      }
      remainingDcFrames -= 1
    }
    if (((frame.frameFlags & 32) !== 0) !== dcFrameCount > 0) {
      throw unsupportedOperation('JPEG XL final frame DC dependency is invalid')
    }
    const dependencyBytes = dependencyFrames.reduce(
      (total, dependency) =>
        total + dependency.sections.reduce((sum, section) => sum + section.length, 0),
      0,
    )
    preflightJpegXlVarDctWorkingMemory(frame, limits, dependencyBytes)
    let dcPlanes: readonly [Float64Array, Float64Array, Float64Array] | undefined
    let dcPlanesLease: ReturnType<JpegXlVarDctMemoryLedger['retain']> | undefined
    const references = new Map<number, JpegXlVarDctReference>()
    const referenceLeases: ReturnType<JpegXlVarDctMemoryLedger['retain']>[] = []
    for (let index = 0; index < dependencyFrames.length; index += 1) {
      const dependency = dependencyFrames[index]
      if (!dependency) throw invalidInput('JPEG XL internal DC frame is missing')
      const sections: Uint8Array[] = []
      const sectionLeases = []
      for (const section of dependency.sections) {
        throwIfAborted(options.signal)
        sectionLeases.push(
          memory.retain('jpegxl-vardct-external-dc-compressed-section', section.length),
        )
        sections.push(await readExactly(logical, section.offset, section.length, options))
      }
      const firstSection = sections[0]
      if (!firstSection) throw invalidInput('JPEG XL internal DC frame section is missing')
      if (dependency.frameType === 'reference') {
        let referencePlanes: readonly [Float64Array, Float64Array, Float64Array]
        if (dependency.encoding === 'modular') {
          if (sections.length !== 1 || dependency.colorTransform !== 'xyb') {
            throw unsupportedOperation('JPEG XL Modular reference frame layout is not supported')
          }
          referencePlanes = decodeJpegXlModularDcFrameSection(
            firstSection,
            dependency.codedWidth,
            dependency.codedHeight,
            options.signal,
          )
        } else {
          const decoded = decodeJpegXlDct8Section(
            firstSection,
            dependency,
            limits,
            memory,
            sections.length === 1 ? undefined : sections.slice(1),
            undefined,
            true,
            references,
          )
          if (!decoded.dcPlanes) throw invalidInput('JPEG XL reference frame output is missing')
          referencePlanes = decoded.dcPlanes
        }
        references.set(
          dependency.saveAsReference,
          Object.freeze({
            width: dependency.codedWidth,
            height: dependency.codedHeight,
            planes: referencePlanes,
          }),
        )
        referenceLeases.push(
          memory.retain('jpegxl-vardct-reference-planes', retainedTypedArrayBytes(referencePlanes)),
        )
      } else if (dependency.encoding === 'modular') {
        dcPlanes = sections.slice(1).every((section) => section.length === 0)
          ? decodeJpegXlModularDcFrameSection(
              firstSection,
              dependency.codedWidth,
              dependency.codedHeight,
              options.signal,
            )
          : decodeJpegXlMultiGroupModularDcFrameSections(sections, dependency, options.signal)
      } else {
        if (!dcPlanes) throw invalidInput('JPEG XL VarDCT DC frame dependency is missing')
        const decoded = decodeJpegXlDct8Section(
          firstSection,
          dependency,
          limits,
          memory,
          sections.slice(1),
          dcPlanes,
          true,
        )
        if (!decoded.dcPlanes) throw invalidInput('JPEG XL VarDCT DC frame output is missing')
        dcPlanes = decoded.dcPlanes
      }
      for (const lease of sectionLeases) lease.release()
      if (dependency.frameType === 'dc') {
        if (!dcPlanes) throw invalidInput('JPEG XL internal DC frame output is missing')
        dcPlanesLease?.release()
        dcPlanesLease = memory.retain(
          'jpegxl-vardct-external-dc-planes',
          retainedTypedArrayBytes(dcPlanes),
        )
      }
    }
    const sections: Uint8Array[] = []
    const sectionLeases = []
    for (const section of frame.sections) {
      throwIfAborted(options.signal)
      sectionLeases.push(memory.retain('jpegxl-vardct-compressed-section', section.length))
      sections.push(await readExactly(logical, section.offset, section.length, options))
    }
    const firstSection = sections[0]
    if (!firstSection) throw invalidInput('JPEG XL VarDCT global section is missing')
    const pixels = decodeJpegXlDct8Section(
      firstSection,
      frame,
      limits,
      memory,
      sections.length === 1 ? undefined : sections.slice(1),
      dcPlanes,
      false,
      references,
    )
    for (const lease of sectionLeases) lease.release()
    dcPlanesLease?.release()
    for (const lease of referenceLeases) lease.release()
    evidence?.operation({
      operationId: 'selected-vardct-materialization',
      phase: 'complete',
      detail: `managed peak ${memory.peakBytes} bytes`,
    })
    return new VarDctJpegXlDecoder(
      pixels,
      jpegXlPixelColorSemantics(frame),
      options.signal,
      memory,
      evidence,
      frame.bitDepth,
      frame.alphaBitDepth,
      frame.colorSemanticsTransfer.kind === 'pq' || frame.colorSemanticsTransfer.kind === 'hlg'
        ? Math.max(1, frame.toneMapping.intensityTarget / 203)
        : 1,
    )
  } catch (error) {
    memory.releaseAll()
    evidence?.operation({
      operationId: 'selected-vardct-materialization',
      phase: 'failed',
      failureCode: evidenceFailureCode(error),
    })
    throw error
  }
}
