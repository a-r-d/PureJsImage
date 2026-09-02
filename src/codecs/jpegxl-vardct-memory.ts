import { limitExceeded } from '../errors.ts'
import type { EvidenceContext, EvidenceManagedLease } from '../evidence.ts'
import type { ImageLimits } from '../limits.ts'
import type { JpegXlFrameStructure } from './jpegxl-decode.ts'

export interface JpegXlVarDctWorkingMemoryEstimate {
  readonly retainedCompressedSectionsBytes: bigint
  readonly dcPlanesBytes: bigint
  readonly lfAndHfMetadataBytes: bigint
  readonly coefficientBlocksBytes: bigint
  readonly primaryPlanesBytes: bigint
  readonly gaborishScratchBytes: bigint
  readonly epfOutputPlaneSetsBytes: bigint
  readonly syntheticNoiseAndConvolutionBytes: bigint
  readonly outputBytes: bigint
  readonly rowBlockCopyBytes: bigint
  readonly progressiveAccumulationBytes: bigint
  readonly externalDcFrameStateBytes: bigint
  readonly transformScratchBytes: bigint
  readonly requiredBytes: bigint
}

export interface JpegXlVarDctMemoryLease {
  release(): void
}

export class JpegXlVarDctMemoryLedger {
  readonly #maximumBytes: number
  readonly #evidence: EvidenceContext | undefined
  readonly #leases = new Set<JpegXlVarDctMemoryLease>()
  #liveBytes = 0
  #peakBytes = 0

  constructor(maximumBytes: number, evidence?: EvidenceContext) {
    this.#maximumBytes = maximumBytes
    this.#evidence = evidence
  }

  get liveBytes(): number {
    return this.#liveBytes
  }

  get peakBytes(): number {
    return this.#peakBytes
  }

  retain(category: string, bytes: number): JpegXlVarDctMemoryLease {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw limitExceeded('JPEG XL VarDCT managed allocation size is invalid')
    }
    if (this.#liveBytes + bytes > this.#maximumBytes) {
      throw limitExceeded(
        `JPEG XL VarDCT managed memory requires ${this.#liveBytes + bytes} bytes while retaining ${category}; maxDecodedBytes is ${this.#maximumBytes}`,
      )
    }
    this.#liveBytes += bytes
    this.#peakBytes = Math.max(this.#peakBytes, this.#liveBytes)
    const evidenceLease: EvidenceManagedLease | undefined = this.#evidence?.allocate(
      category,
      bytes,
    )
    let released = false
    const lease: JpegXlVarDctMemoryLease = Object.freeze({
      release: (): void => {
        if (released) return
        released = true
        evidenceLease?.release()
        this.#liveBytes -= bytes
        this.#leases.delete(lease)
      },
    })
    this.#leases.add(lease)
    return lease
  }

  releaseAll(): void {
    for (const lease of [...this.#leases]) lease.release()
  }
}

export const retainedTypedArrayBytes = (value: unknown): number => {
  const seen = new WeakSet<object>()
  const visit = (current: unknown): number => {
    if (typeof current !== 'object' || current === null || seen.has(current)) return 0
    seen.add(current)
    if (ArrayBuffer.isView(current)) return current.byteLength
    if (current instanceof ArrayBuffer) return current.byteLength
    if (Array.isArray(current)) return current.reduce((total, item) => total + visit(item), 0)
    return Object.values(current).reduce((total, item) => total + visit(item), 0)
  }
  return visit(value)
}

// The selected decoder materializes every order for all 13 VarDCT strategy families.
const hfCoefficientOrderBytesPerPass = 1_563_648n
const transformScratchBytes = 65_536n

/**
 * Conservative selected-VarDCT preflight. Every item is derived from parsed frame geometry or
 * retained section sizes, and all possible synthetic-noise storage is included because the noise
 * flag is carried inside LF global data that has not been read at preflight time.
 */
export const estimateJpegXlVarDctWorkingMemory = (
  frame: Readonly<JpegXlFrameStructure>,
  externalDcSectionBytes = 0,
): Readonly<JpegXlVarDctWorkingMemoryEstimate> => {
  const blockWidth = BigInt(Math.ceil(frame.width / 8))
  const blockHeight = BigInt(Math.ceil(frame.height / 8))
  const blockCount = blockWidth * blockHeight
  const paddedPixels = blockCount * 64n
  const pixels = BigInt(frame.width) * BigInt(frame.height)
  const channels = BigInt(frame.colorChannels === 1 ? 1 : 3)
  const retainedCompressedSectionsBytes =
    frame.sections.reduce((total, section) => total + BigInt(section.length), 0n) +
    BigInt(externalDcSectionBytes)
  const externalDc = (frame.frameFlags & 32) !== 0

  // Non-external DC uses decoded Int32 planes, converted Float64 planes, and render DC planes.
  // External DC retains its three Float64 planes and their compressed source section.
  const dcPlanesBytes = externalDc ? 0n : blockCount * 60n
  const externalDcFrameStateBytes = externalDc ? blockCount * 24n : 0n
  const correlationTiles = ((blockWidth + 7n) / 8n) * ((blockHeight + 7n) / 8n)
  const lfAndHfMetadataBytes =
    retainedCompressedSectionsBytes * 8n +
    BigInt(frame.passCount) * hfCoefficientOrderBytesPerPass +
    blockCount * 64n +
    correlationTiles * 8n

  // One decoded pass retains the entropy coefficient planes, per-strategy coefficient blocks,
  // and component coefficient planes. A later progressive pass temporarily retains a second set.
  const coefficientBlocksBytes = blockCount * 64n * 4n * 3n * 3n
  const progressiveAccumulationBytes = frame.passCount > 1 ? coefficientBlocksBytes : 0n
  const primaryPlanesBytes = paddedPixels * 3n * 4n
  const gaborishScratchBytes = frame.gaborish ? blockWidth * 8n * BigInt(frame.height) * 4n : 0n
  const epfOutputPlaneSetsBytes = pixels * 3n * 4n * BigInt(frame.epfIterations)
  const syntheticNoiseAndConvolutionBytes = pixels * 4n * 4n
  const outputBytes = pixels * channels
  const rowBlockCopyBytes = BigInt(frame.width) * channels
  const requiredBytes =
    retainedCompressedSectionsBytes +
    dcPlanesBytes +
    lfAndHfMetadataBytes +
    coefficientBlocksBytes +
    primaryPlanesBytes +
    gaborishScratchBytes +
    epfOutputPlaneSetsBytes +
    syntheticNoiseAndConvolutionBytes +
    outputBytes +
    rowBlockCopyBytes +
    progressiveAccumulationBytes +
    externalDcFrameStateBytes +
    transformScratchBytes

  return Object.freeze({
    retainedCompressedSectionsBytes,
    dcPlanesBytes,
    lfAndHfMetadataBytes,
    coefficientBlocksBytes,
    primaryPlanesBytes,
    gaborishScratchBytes,
    epfOutputPlaneSetsBytes,
    syntheticNoiseAndConvolutionBytes,
    outputBytes,
    rowBlockCopyBytes,
    progressiveAccumulationBytes,
    externalDcFrameStateBytes,
    transformScratchBytes,
    requiredBytes,
  })
}

export const preflightJpegXlVarDctWorkingMemory = (
  frame: Readonly<JpegXlFrameStructure>,
  limits: Readonly<ImageLimits>,
  externalDcSectionBytes = 0,
): Readonly<JpegXlVarDctWorkingMemoryEstimate> => {
  const estimate = estimateJpegXlVarDctWorkingMemory(frame, externalDcSectionBytes)
  if (estimate.requiredBytes > BigInt(limits.maxDecodedBytes)) {
    throw limitExceeded(
      `JPEG XL VarDCT conservative working-memory preflight requires ${estimate.requiredBytes} bytes; maxDecodedBytes is ${limits.maxDecodedBytes}`,
    )
  }
  return estimate
}
