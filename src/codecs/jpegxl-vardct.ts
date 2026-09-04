import { throwIfAborted } from '../abort.ts'
import type { DecodeRequest, DecoderOptions, ImageDecoder } from '../codec.ts'
import type { PixelColorSemantics } from '../color.ts'
import { ImageError, invalidInput, unsupportedOperation } from '../errors.ts'
import type { EvidenceContext } from '../evidence.ts'
import type { ImageLimits } from '../limits.ts'
import type { PixelBlock } from '../pixel.ts'
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
import { decodeJpegXlJpegCoefficientImage } from './jpegxl-jpeg-reconstruct-source.ts'
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
  readonly pixelFormat = 'rgb8' as const
  readonly colorSemantics: PixelColorSemantics
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: true,
    scaledDecode: true,
    progressive: false,
  })
  readonly #image: JpegCoefficientImage
  readonly #signal: AbortSignal | undefined

  constructor(
    image: JpegCoefficientImage,
    colorSemantics: PixelColorSemantics,
    signal: AbortSignal | undefined,
  ) {
    this.width = image.width
    this.height = image.height
    this.colorSemantics = colorSemantics
    this.#image = image
    this.#signal = signal
  }

  async *decode(request: Readonly<DecodeRequest> = {}): AsyncGenerator<PixelBlock> {
    const scale = scaleDenominator(request)
    const outputWidth = Math.ceil(this.width / scale)
    const outputHeight = Math.ceil(this.height / scale)
    const region = decodeRegion(outputWidth, outputHeight, request)
    throwIfAborted(this.#signal)
    throwIfAborted(request.signal)
    for await (const block of decodeJpegCoefficientImage(this.#image, region, scale)) {
      throwIfAborted(this.#signal)
      throwIfAborted(request.signal)
      yield block
    }
  }
}

export const createJpegDerivedJpegXlDecoder = async (
  source: ImageSource,
  logical: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
): Promise<ImageDecoder> => {
  const frames = await readJpegXlSourceFrameStructures(logical, limits, options)
  const displayFrame = frames.at(-1)
  if (!displayFrame) throw invalidInput('JPEG XL display frame is missing')
  const image = await decodeJpegXlJpegCoefficientImage(source, {
    limits,
    ...(options.signal ? { signal: options.signal } : {}),
  })
  return new JpegDerivedJpegXlDecoder(
    image,
    Object.freeze({
      ...jpegXlPixelColorSemantics(displayFrame),
      provenance: 'decoder-converted',
    }),
    options.signal,
  )
}

class VarDctJpegXlDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: 'gray8' | 'rgb8' | 'rgba8'
  readonly colorSemantics: PixelColorSemantics
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: false,
    scaledDecode: false,
    progressive: false,
  })
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
  ) {
    this.width = pixels.width
    this.height = pixels.height
    this.pixelFormat = pixels.format
    this.colorSemantics = colorSemantics
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
    const channels = this.pixelFormat === 'gray8' ? 1 : this.pixelFormat === 'rgb8' ? 3 : 4
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
