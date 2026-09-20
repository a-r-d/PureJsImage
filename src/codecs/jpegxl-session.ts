import { combineAbortSignals, throwIfAborted } from '../abort.ts'
import type { PixelColorSemantics } from '../color.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { EvidenceContext } from '../evidence.ts'
import { directImageExecutionPlan } from '../execution-plan-contract.ts'
import { type ImageLimitOptions, type ImageLimits, resolveLimits } from '../limits.ts'
import { type PixelBlock, pixelBytesPerPixel } from '../pixel.ts'
import { createImageSource, type ImageInput, type ImageSource, readExactly } from '../source.ts'
import { inheritImageSourceIdentity } from '../source-identity-contract.ts'
import { jpegxlCodec } from './jpegxl.ts'
import { inspectJpegXlSource, JpegXlCodestreamSource } from './jpegxl-container.ts'
import {
  decodeJpegXlFrameSource,
  decodeJpegXlModularDcFrameSection,
  decodeJpegXlMultiGroupModularDcFrameSections,
  type JpegXlFrameStructure,
  jpegXlDecodedPixelFormat,
  jpegXlPixelColorSemantics,
  jpegXlXybOutputIsLinear,
  readJpegXlSourceFrameStructures,
} from './jpegxl-decode.ts'
import { type JpegXlLimitOptions, resolveJpegXlLimits } from './jpegxl-limits.ts'
import {
  type JpegXlProgressivePlan,
  type JpegXlProgressiveRequest,
  jpegXlEncodedPoint,
  planJpegXlProgressive,
} from './jpegxl-progressive-plan.ts'
import {
  type JpegXlVarDctMemoryLease,
  JpegXlVarDctMemoryLedger,
  retainedTypedArrayBytes,
} from './jpegxl-vardct-memory.ts'
import {
  decodeJpegXlDct8SectionCancellable,
  type JpegXlVarDctLowFrequencyState,
  type JpegXlVarDctPixels,
  prepareJpegXlVarDctLowFrequency,
  renderJpegXlVarDctLowFrequencyCancellable,
} from './jpegxl-vardct-render.ts'

export interface OpenJpegXlSessionOptions {
  readonly limits?: Readonly<ImageLimitOptions & JpegXlLimitOptions>
  readonly maxCachedBytes?: number
  readonly signal?: AbortSignal
  readonly evidence?: EvidenceContext
}

export interface JpegXlProgressiveStage {
  readonly id: string
  readonly frameIndex: number
  readonly kind: 'embedded-preview' | 'dc' | 'pass' | 'final'
  readonly completedPasses: number
  readonly intendedDownsampling: 1 | 2 | 4 | 8
  readonly width: number
  readonly height: number
  readonly colorSemantics: PixelColorSemantics
  readonly displayRanges?: NonNullable<PixelBlock['displayRanges']>
  readonly plan: JpegXlProgressivePlan
}

export interface JpegXlStageAvailability {
  readonly kind: 'embedded-preview' | 'dc' | 'pass' | 'final'
  readonly completedPasses: number
  readonly status: 'available' | 'unavailable' | 'requires-validation'
  readonly reason?: string
}

export type JpegXlProgressiveEvent =
  | {
      readonly type: 'metadata'
      readonly width: number
      readonly height: number
      readonly orientation: number
      readonly stages: readonly JpegXlStageAvailability[]
    }
  | {
      readonly type: 'stage-start' | 'stage-complete' | 'final'
      readonly stage: JpegXlProgressiveStage
    }
  | { readonly type: 'block'; readonly stage: JpegXlProgressiveStage; readonly block: PixelBlock }

interface CachedSection {
  readonly data: Uint8Array
  readonly lease: JpegXlVarDctMemoryLease
}

/**
 * Borrows its input for its lifetime. One iterator may be active at a time, including while
 * suspended at a yielded block. Closing cancels that iterator and releases session-owned data.
 * Output rows are separate immutable snapshots; release relinquishes accounting, not their bytes.
 */
export class JpegXlSession {
  readonly width: number
  readonly height: number
  readonly orientation: number
  readonly #source: ImageSource
  readonly #logical: ImageSource
  readonly #frames: readonly Readonly<JpegXlFrameStructure>[]
  readonly #frame: Readonly<JpegXlFrameStructure>
  readonly #limits: ImageLimits
  readonly #memory: JpegXlVarDctMemoryLedger
  readonly #maxCachedBytes: number
  readonly #sourceIdentity: string
  readonly #evidence: EvidenceContext | undefined
  readonly #signal: AbortSignal
  readonly #controller = new AbortController()
  readonly #sections = new Map<string, CachedSection>()
  readonly #temporaryLeases: JpegXlVarDctMemoryLease[] = []
  #cachedSectionBytes = 0
  #state: JpegXlVarDctLowFrequencyState | undefined
  #dcPlanes: readonly [Float64Array, Float64Array, Float64Array] | undefined
  #dcLease: JpegXlVarDctMemoryLease | undefined
  #active: AsyncGenerator<JpegXlProgressiveEvent, void, undefined> | undefined
  #closePromise: Promise<void> | undefined
  #sourceBytes = 0
  #cacheHits = 0
  #fallbackPeak = 0
  #unmeasuredFallback = false

  constructor(
    source: ImageSource,
    logical: ImageSource,
    frames: readonly Readonly<JpegXlFrameStructure>[],
    limits: ImageLimits,
    maxCachedBytes: number,
    sourceIdentity: string,
    options: Readonly<OpenJpegXlSessionOptions>,
  ) {
    const frame = frames.at(-1)
    if (!frame || frame.frameType !== 'regular')
      throw unsupportedOperation('JPEG XL session requires a static display frame')
    this.width = frame.width
    this.height = frame.height
    this.orientation = frame.orientation
    this.#source = source
    this.#logical = logical
    this.#frames = frames
    this.#frame = frame
    this.#limits = limits
    this.#maxCachedBytes = maxCachedBytes
    this.#sourceIdentity = sourceIdentity
    this.#evidence = options.evidence
    this.#memory = new JpegXlVarDctMemoryLedger(limits.maxDecodedBytes, options.evidence)
    this.#signal = combineAbortSignals(this.#controller.signal, options.signal)
  }

  get managedPeakBytes(): number | null {
    return this.#unmeasuredFallback ? null : Math.max(this.#memory.peakBytes, this.#fallbackPeak)
  }
  get managedLiveBytes(): number {
    return this.#memory.liveBytes
  }
  get sourceSectionBytes(): number {
    return this.#sourceBytes
  }
  get sectionCacheHits(): number {
    return this.#cacheHits
  }

  plan(request: Readonly<JpegXlProgressiveRequest> = {}): JpegXlProgressivePlan {
    throwIfAborted(this.#signal)
    const dependencies = this.#frames.slice(0, -1).filter((entry) => !entry.isPreview)
    const plan = planJpegXlProgressive(this.#frame, request, this.#state, dependencies)
    return Object.freeze({
      ...plan,
      internalFrameSections: Object.freeze(
        plan.internalFrameSections.map((section) => {
          const dependency = dependencies[section.frameIndex]
          if (!dependency) throw invalidInput('JPEG XL dependency frame is missing')
          return Object.freeze({ ...section, frameIndex: this.#frames.indexOf(dependency) })
        }),
      ),
    })
  }

  get stages(): readonly JpegXlStageAvailability[] {
    const plan = this.plan()
    const reason = plan.fallbackReasons.join('; ')
    const status = reason ? 'unavailable' : this.#state ? 'available' : 'requires-validation'
    const stages: JpegXlStageAvailability[] = [
      Object.freeze({
        kind: 'embedded-preview',
        completedPasses: 0,
        status: this.#frames[0]?.isPreview ? 'available' : 'unavailable',
        ...(!this.#frames[0]?.isPreview ? { reason: 'No embedded preview is encoded' } : {}),
      }),
      Object.freeze({ kind: 'dc', completedPasses: 0, status, ...(reason ? { reason } : {}) }),
    ]
    for (let passes = 1; passes < this.#frame.passCount; passes++)
      stages.push(
        Object.freeze({
          kind: 'pass',
          completedPasses: passes,
          status,
          ...(reason ? { reason } : {}),
        }),
      )
    stages.push(
      Object.freeze({
        kind: 'final',
        completedPasses: this.#frame.passCount,
        status: 'requires-validation',
        reason: reason || 'Final compressed sections must decode successfully',
      }),
    )
    return Object.freeze(stages)
  }

  [directImageExecutionPlan](
    request: Readonly<JpegXlProgressiveRequest> = {},
  ): JpegXlProgressivePlan {
    return this.plan(request)
  }

  /** Stop at the codestream's native resolution boundary, without substituting final resampling. */
  native(
    request: Readonly<Omit<JpegXlProgressiveRequest, 'until'>> = {},
  ): AsyncGenerator<JpegXlProgressiveEvent, void, undefined> {
    const scale = request.scaleDenominator ?? 1
    this.plan({ ...request, until: 'dc' })
    if (scale === 8) return this.progressive({ ...request, until: 'dc' })
    if (scale === 1) return this.progressive({ ...request, until: 'final' })
    const resolution = this.#frame.progressiveResolutions.find(
      (entry) => entry.downsampling === scale,
    )
    if (!resolution)
      throw unsupportedOperation('JPEG XL has no native pass boundary for this resolution')
    return this.progressive({ ...request, until: resolution.lastPass + 1 })
  }

  progressive(
    request: Readonly<JpegXlProgressiveRequest> = {},
  ): AsyncGenerator<JpegXlProgressiveEvent, void, undefined> {
    return this.#begin(request, 'all')
  }

  /** Decode only the requested completed stage. Generic resampling does not select an earlier pass. */
  decode(
    request: Readonly<JpegXlProgressiveRequest> = {},
  ): AsyncGenerator<JpegXlProgressiveEvent, void, undefined> {
    return this.#begin(request, 'target')
  }

  /** Emit the separately encoded embedded image at its own dimensions. */
  preview(
    request: Readonly<{ signal?: AbortSignal }> = {},
  ): AsyncGenerator<JpegXlProgressiveEvent, void, undefined> {
    if (!this.#frames[0]?.isPreview) throw unsupportedOperation('JPEG XL has no embedded preview')
    return this.#begin(request, 'preview')
  }

  #begin(
    request: Readonly<JpegXlProgressiveRequest>,
    mode: 'all' | 'target' | 'preview',
  ): AsyncGenerator<JpegXlProgressiveEvent, void, undefined> {
    this.plan(request)
    throwIfAborted(request.signal)
    if (this.#active) throw unsupportedOperation('JPEG XL session already has an active request')
    const snapshot = Object.freeze({
      ...request,
      ...(request.region ? { region: Object.freeze({ ...request.region }) } : {}),
    })
    const iterator = this.#run(snapshot, mode)
    const finish = iterator.return.bind(iterator)
    iterator.return = async (value) => {
      try {
        return await finish(value)
      } finally {
        if (this.#active === iterator) this.#active = undefined
      }
    }
    const fail = iterator.throw.bind(iterator)
    iterator.throw = async (error: unknown) => {
      try {
        return await fail(error)
      } finally {
        if (this.#active === iterator) this.#active = undefined
      }
    }
    this.#active = iterator
    return iterator
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise
    this.#controller.abort()
    const active = this.#active
    this.#closePromise = (async () => {
      try {
        await active?.return(undefined)
      } finally {
        this.#clear()
        this.#active = undefined
      }
    })()
    return this.#closePromise
  }

  #clear(): void {
    this.#state?.release()
    this.#state = undefined
    this.#dcLease?.release()
    this.#dcLease = undefined
    this.#dcPlanes = undefined
    for (const entry of this.#sections.values()) entry.lease.release()
    this.#sections.clear()
    this.#cachedSectionBytes = 0
    for (const lease of this.#temporaryLeases) lease.release()
    this.#temporaryLeases.length = 0
    this.#memory.releaseAll()
  }

  async #section(frameIndex: number, sectionId: number, signal: AbortSignal): Promise<Uint8Array> {
    throwIfAborted(signal)
    const key = `${frameIndex}:${sectionId}`
    const cached = this.#sections.get(key)
    if (cached) {
      this.#cacheHits += 1
      return cached.data
    }
    const part = this.#frames[frameIndex]?.sections[sectionId]
    if (!part) throw invalidInput('JPEG XL planned section is missing')
    const lease = this.#memory.retain('jpegxl-session-compressed-section', part.length)
    try {
      // ImageSource buffers may be recycled by the next read.
      const data = new Uint8Array(
        await readExactly(this.#logical, part.offset, part.length, { signal }),
      )
      this.#sourceBytes += data.length
      if (this.#cachedSectionBytes + data.length <= this.#maxCachedBytes) {
        this.#sections.set(key, { data, lease })
        this.#cachedSectionBytes += data.length
      } else this.#temporaryLeases.push(lease)
      return data
    } catch (error) {
      lease.release()
      throw error
    }
  }

  async #prepare(signal: AbortSignal): Promise<JpegXlVarDctLowFrequencyState> {
    if (this.#state) return this.#state
    const frame = this.#frame
    if (
      frame.encoding !== 'vardct' ||
      frame.colorTransform !== 'xyb' ||
      frame.extraChannels.length !== 0 ||
      frame.bitDepth !== 8 ||
      jpegXlXybOutputIsLinear(frame) ||
      frame.upsampling !== 1
    )
      throw unsupportedOperation(
        'Progressive JPEG XL sessions currently require 8-bit SDR XYB without extra channels or upsampling',
      )
    const dependencies = this.#frames.slice(0, -1).filter((entry) => !entry.isPreview)
    if (
      dependencies.length > 1 ||
      dependencies.some(
        (entry) => entry.frameType !== 'dc' || entry.encoding !== 'modular' || entry.dcLevel !== 1,
      )
    )
      throw unsupportedOperation(
        'Progressive JPEG XL session requires at most one Modular DC dependency',
      )
    const dependency = dependencies[0]
    if (dependency) {
      const sections: Uint8Array[] = []
      for (let id = 0; id < dependency.sections.length; id += 1)
        sections.push(await this.#section(this.#frames.indexOf(dependency), id, signal))
      const first = sections[0]
      if (!first) throw invalidInput('JPEG XL internal DC section is missing')
      const samples = dependency.codedWidth * dependency.codedHeight * 3
      this.#dcLease = this.#memory.retain('jpegxl-session-external-dc-planes', samples * 8)
      const temporary = this.#memory.retain(
        'jpegxl-session-external-dc-integer-planes-and-transform-scratch',
        samples * 8,
      )
      try {
        this.#dcPlanes = sections.slice(1).every((part) => part.length === 0)
          ? decodeJpegXlModularDcFrameSection(
              first,
              dependency.codedWidth,
              dependency.codedHeight,
              signal,
            )
          : decodeJpegXlMultiGroupModularDcFrameSections(sections, dependency, signal)
      } finally {
        temporary.release()
      }
    }
    if (((frame.frameFlags & 32) !== 0) !== (this.#dcPlanes !== undefined))
      throw invalidInput('JPEG XL session has inconsistent DC dependencies')
    const lowSections: Uint8Array[] = []
    const lowCount = frame.sections.length === 1 ? 1 : 1 + frame.dcGroupCount
    for (let id = 0; id < lowCount; id += 1)
      lowSections.push(await this.#section(this.#frames.length - 1, id, signal))
    this.#state = prepareJpegXlVarDctLowFrequency(lowSections, frame, this.#memory, this.#dcPlanes)
    return this.#state
  }

  async *#run(
    request: Readonly<JpegXlProgressiveRequest>,
    mode: 'all' | 'target' | 'preview',
  ): AsyncGenerator<JpegXlProgressiveEvent, void, undefined> {
    const signal = combineAbortSignals(this.#signal, request.signal)
    let succeeded = false
    try {
      throwIfAborted(signal)
      if (JSON.stringify(await inheritImageSourceIdentity(this.#source)) !== this.#sourceIdentity)
        throw invalidInput('JPEG XL source identity changed during the session')
      yield Object.freeze({
        type: 'metadata',
        width: this.width,
        height: this.height,
        orientation: this.orientation,
        stages: this.stages,
      })
      if (mode !== 'target' && this.#frames[0]?.isPreview) yield* this.#embeddedPreview(signal)
      if (mode === 'preview') {
        succeeded = true
        return
      }
      const initial = this.plan(request)
      if (initial.fallbackReasons.length) {
        yield* this.#fallback(initial, signal)
        succeeded = true
        return
      }
      const state = await this.#prepare(signal)
      for (const lease of this.#temporaryLeases) lease.release()
      this.#temporaryLeases.length = 0
      const target = this.plan(request)
      const frame = this.#frame
      if (target.fallbackReasons.length) {
        yield* this.#fallback(target, signal)
        succeeded = true
        return
      }
      for (
        let passes = mode === 'target' ? target.passes : 0;
        passes <= target.passes;
        passes += 1
      ) {
        throwIfAborted(signal)
        const plan = this.plan({ ...request, until: passes === 0 ? 'dc' : passes })
        const stage: JpegXlProgressiveStage = Object.freeze({
          id: `${this.#frames.length - 1}:${passes}`,
          frameIndex: this.#frames.length - 1,
          kind: passes === 0 ? 'dc' : passes === frame.passCount ? 'final' : 'pass',
          completedPasses: passes,
          intendedDownsampling:
            passes === 0
              ? 8
              : (frame.progressiveResolutions.find((entry) => entry.lastPass === passes - 1)
                  ?.downsampling ?? 1),
          width: Math.ceil(plan.outputRegion.width / plan.scaleDenominator),
          height: Math.ceil(plan.outputRegion.height / plan.scaleDenominator),
          colorSemantics: jpegXlPixelColorSemantics(frame),
          plan,
        })
        yield Object.freeze({ type: 'stage-start', stage })
        let pixels: JpegXlVarDctPixels
        if (passes === 0)
          pixels = await renderJpegXlVarDctLowFrequencyCancellable(
            signal,
            state,
            plan.scaleDenominator,
            request,
          )
        else {
          const sections: Uint8Array[] = Array.from(
            { length: frame.sections.length },
            () => new Uint8Array(),
          )
          for (const id of plan.sectionIds) {
            if (frame.sections.length > 1 && id <= frame.dcGroupCount) continue
            sections[id] = await this.#section(this.#frames.length - 1, id, signal)
          }
          const first = sections[0]
          if (!first) throw invalidInput('JPEG XL global section is missing')
          pixels = await decodeJpegXlDct8SectionCancellable(
            signal,
            first,
            frame,
            this.#limits,
            this.#memory,
            sections.length > 1 ? sections.slice(1) : undefined,
            this.#dcPlanes,
            false,
            new Map(),
            state,
            passes,
            plan.fallbackReasons.length ? undefined : new Set(plan.groupIds),
          )
        }
        for (const lease of this.#temporaryLeases) lease.release()
        this.#temporaryLeases.length = 0
        try {
          yield* this.#blocks(pixels, stage, signal)
          yield Object.freeze({ type: 'stage-complete', stage })
          if (stage.kind === 'final') yield Object.freeze({ type: 'final', stage })
        } finally {
          pixels.release()
        }
      }
      succeeded = true
    } finally {
      for (const lease of this.#temporaryLeases) lease.release()
      this.#temporaryLeases.length = 0
      if (!succeeded || this.#maxCachedBytes === 0) this.#clear()
      else if (
        this.#state &&
        retainedTypedArrayBytes([this.#state.lfGlobal, this.#state.dcGroup, this.#state.dcPlanes]) +
          this.#cachedSectionBytes >
          this.#maxCachedBytes
      ) {
        this.#state.release()
        this.#state = undefined
        this.#dcLease?.release()
        this.#dcLease = undefined
        this.#dcPlanes = undefined
      }
      this.#active = undefined
    }
  }

  async *#embeddedPreview(
    signal: AbortSignal,
  ): AsyncGenerator<JpegXlProgressiveEvent, void, undefined> {
    const frame = this.#frames[0]
    if (!frame?.isPreview) return
    const plan = planJpegXlProgressive(frame, { coordinateSpace: 'encoded' })
    const stage: JpegXlProgressiveStage = Object.freeze({
      id: '0:embedded-preview',
      frameIndex: 0,
      kind: 'embedded-preview',
      completedPasses: frame.passCount,
      intendedDownsampling: 1,
      width: frame.width,
      height: frame.height,
      colorSemantics: jpegXlPixelColorSemantics(frame),
      plan,
    })
    yield Object.freeze({ type: 'stage-start', stage })
    if (frame.encoding === 'modular') {
      const decoded = await decodeJpegXlFrameSource(this.#logical, frame, this.#limits, { signal })
      this.#unmeasuredFallback = true
      for await (const block of decoded.decoder.decode({ signal })) {
        const lease = this.#memory.retain('jpegxl-session-preview-block', block.data.byteLength)
        try {
          const data = block.data.slice()
          block.release?.()
          yield Object.freeze({
            type: 'block',
            stage,
            block: Object.freeze({ ...block, data, release: lease.release }),
          })
        } finally {
          block.release?.()
          lease.release()
        }
      }
    } else {
      const sections: Uint8Array[] = []
      for (let id = 0; id < frame.sections.length; id++)
        sections.push(await this.#section(0, id, signal))
      const first = sections[0]
      if (!first) throw invalidInput('JPEG XL preview global section is missing')
      const pixels = await decodeJpegXlDct8SectionCancellable(
        signal,
        first,
        frame,
        this.#limits,
        this.#memory,
        sections.length > 1 ? sections.slice(1) : undefined,
      )
      try {
        yield* this.#blocks(pixels, stage, signal)
      } finally {
        pixels.release()
      }
    }
    yield Object.freeze({ type: 'stage-complete', stage })
  }

  async *#fallback(
    plan: JpegXlProgressivePlan,
    signal: AbortSignal,
  ): AsyncGenerator<JpegXlProgressiveEvent, void, undefined> {
    if (plan.passes !== this.#frame.passCount)
      throw unsupportedOperation(
        `JPEG XL cannot substitute final output for this native stage: ${plan.fallbackReasons.join('; ')}`,
      )
    this.#clear()
    const format = jpegXlDecodedPixelFormat(this.#frame)
    const bytesPerPixel = pixelBytesPerPixel(format)
    const lease = this.#memory.retain(
      'jpegxl-session-static-fallback-output',
      this.width * this.height * bytesPerPixel,
    )
    try {
      const data = new Uint8Array(this.width * this.height * bytesPerPixel)
      const remaining = this.#limits.maxDecodedBytes - this.#memory.liveBytes
      if (remaining < 1)
        throw limitExceeded('JPEG XL static fallback has no remaining working-memory budget')
      const previouslyUnmeasured = this.#unmeasuredFallback
      this.#unmeasuredFallback = true
      const decoder = await jpegxlCodec.createDecoder?.(
        this.#source,
        { ...this.#limits, maxDecodedBytes: remaining },
        {
          signal,
          colorOutput: 'preserve',
          ...(this.#evidence ? { evidence: this.#evidence } : {}),
        },
      )
      if (decoder && 'managedPeakBytes' in decoder && typeof decoder.managedPeakBytes === 'number')
        this.#unmeasuredFallback = previouslyUnmeasured
      if (!decoder || decoder.pixelFormat !== format)
        throw unsupportedOperation(
          'JPEG XL static fallback sample format differs from its native frame contract',
        )
      let displayRanges: PixelBlock['displayRanges']
      const colorSemantics = decoder.colorSemantics ?? jpegXlPixelColorSemantics(this.#frame)
      const stage: JpegXlProgressiveStage = Object.freeze({
        id: `${this.#frames.length - 1}:final`,
        frameIndex: this.#frames.length - 1,
        kind: 'final',
        completedPasses: this.#frame.passCount,
        intendedDownsampling: 1,
        width: Math.ceil(plan.outputRegion.width / plan.scaleDenominator),
        height: Math.ceil(plan.outputRegion.height / plan.scaleDenominator),
        colorSemantics,
        plan,
      })
      yield Object.freeze({ type: 'stage-start', stage })
      try {
        for await (const block of decoder.decode({ signal })) {
          try {
            displayRanges ??= block.displayRanges
            for (let row = 0; row < block.height; row += 1)
              data.set(
                block.data.subarray(
                  row * block.stride,
                  row * block.stride + block.width * bytesPerPixel,
                ),
                ((block.y + row) * this.width + block.x) * bytesPerPixel,
              )
          } finally {
            block.release?.()
          }
        }
      } finally {
        if ('managedPeakBytes' in decoder && typeof decoder.managedPeakBytes === 'number')
          this.#fallbackPeak = Math.max(
            this.#fallbackPeak,
            data.byteLength + decoder.managedPeakBytes,
          )
      }
      const completed = Object.freeze({ ...stage, ...(displayRanges ? { displayRanges } : {}) })
      yield* this.#blocks(
        {
          width: this.width,
          height: this.height,
          format,
          data,
          managedPeakBytes: this.#memory.peakBytes,
          release: lease.release,
        },
        completed,
        signal,
      )
      yield Object.freeze({ type: 'stage-complete', stage: completed })
      yield Object.freeze({ type: 'final', stage: completed })
    } finally {
      lease.release()
    }
  }

  async *#blocks(
    pixels: JpegXlVarDctPixels,
    stage: JpegXlProgressiveStage,
    signal: AbortSignal,
  ): AsyncGenerator<JpegXlProgressiveEvent, void, undefined> {
    const bytesPerPixel = pixelBytesPerPixel(pixels.format)
    const stride = stage.width * bytesPerPixel
    const plan = stage.plan
    const region = plan.outputRegion
    const orientation = plan.coordinateSpace === 'display' ? this.orientation : 1
    // Resolve coordinate axes once. Each pixel loop uses stable numeric arrays and byte copies.
    const first = jpegXlEncodedPoint(0, 0, pixels.width, pixels.height, orientation)
    const xStep = jpegXlEncodedPoint(1, 0, pixels.width, pixels.height, orientation)
    const yStep = jpegXlEncodedPoint(0, 1, pixels.width, pixels.height, orientation)
    const ax = xStep[0] - first[0],
      ay = xStep[1] - first[1]
    const bx = yStep[0] - first[0],
      by = yStep[1] - first[1]
    const half = Math.floor(plan.scaleDenominator / 2)
    for (let row = 0; row < stage.height; row += 1) {
      throwIfAborted(signal)
      const lease = this.#memory.retain('jpegxl-session-output-row', stride)
      try {
        const data = new Uint8Array(stride)
        if (stage.kind === 'dc') data.set(pixels.data.subarray(row * stride, (row + 1) * stride))
        else {
          const y = region.y + Math.min(region.height - 1, row * plan.scaleDenominator + half)
          for (let column = 0; column < stage.width; column += 1) {
            const x = region.x + Math.min(region.width - 1, column * plan.scaleDenominator + half)
            const sourceX = ax * x + bx * y + first[0],
              sourceY = ay * x + by * y + first[1]
            const source = (sourceY * pixels.width + sourceX) * bytesPerPixel
            for (let channel = 0; channel < bytesPerPixel; channel += 1)
              data[column * bytesPerPixel + channel] = pixels.data[source + channel] ?? 0
          }
        }
        yield Object.freeze({
          type: 'block',
          stage,
          block: Object.freeze({
            x: 0,
            y: row,
            width: stage.width,
            height: 1,
            stride,
            format: pixels.format,
            data,
            colorSemantics: stage.colorSemantics,
            ...(stage.displayRanges ? { displayRanges: stage.displayRanges } : {}),
            release: lease.release,
          }),
        })
      } finally {
        lease.release()
      }
    }
  }
}

export const openJpegXlSession = async (
  input: ImageInput,
  options: Readonly<OpenJpegXlSessionOptions> = {},
): Promise<JpegXlSession> => {
  const limits = resolveLimits(options.limits)
  const jpegXlLimits = resolveJpegXlLimits(options.limits)
  const maxCachedBytes = options.maxCachedBytes ?? Math.min(16_777_216, limits.maxDecodedBytes)
  if (
    !Number.isSafeInteger(maxCachedBytes) ||
    maxCachedBytes < 0 ||
    maxCachedBytes > limits.maxDecodedBytes
  )
    throw invalidInput('JPEG XL cache budget must be between zero and maxDecodedBytes')
  const source = await createImageSource(input, limits, { ...options, buffering: 'none' })
  const structure = await inspectJpegXlSource(source, jpegXlLimits, options)
  if (structure.metadataBoxes.some((box) => box.type === 'jbrd'))
    throw unsupportedOperation('JPEG-derived JPEG XL uses its existing reduced-IDCT decoder')
  const logical = new JpegXlCodestreamSource(source, structure)
  const frames = await readJpegXlSourceFrameStructures(
    logical,
    limits,
    options,
    jpegXlLimits.maxHeaderBytes,
    jpegXlLimits,
  )
  return new JpegXlSession(
    source,
    logical,
    frames,
    limits,
    maxCachedBytes,
    JSON.stringify(await inheritImageSourceIdentity(source)),
    options,
  )
}
