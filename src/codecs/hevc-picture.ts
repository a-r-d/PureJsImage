import { ImageError, invalidInput, unsupportedOperation } from '../errors.ts'
import { type HevcPpsInspection, type HevcSpsInspection, readHevcSliceData } from './hevc.ts'
import { HevcCabacDecoder } from './hevc-cabac.ts'
import { HevcIntraCabacContexts } from './hevc-contexts.ts'
import { applyHevcDeblocking, type HevcDeblockEdges } from './hevc-deblock.ts'
import {
  deriveHevcChromaMode,
  deriveHevcLumaCandidates,
  deriveHevcLumaMode,
  predictHevcIntra,
  prepareHevcIntraReferences,
} from './hevc-intra.ts'
import { decodeHevcResidual } from './hevc-residual.ts'
import { applyHevcSao, type HevcSaoComponent, type HevcSaoCtb } from './hevc-sao.ts'
import { inverseHevcTransform } from './hevc-transform.ts'

type SamplePlane = {
  readonly data: Uint16Array
  readonly height: number
  readonly reconstructed: Uint8Array
  readonly width: number
}

export interface DecodedHevcPicture {
  readonly bitDepth: 8 | 10
  readonly chromaFormat: 1
  readonly height: number
  readonly u: Uint16Array
  readonly v: Uint16Array
  readonly width: number
  readonly y: Uint16Array
}

const sampleAt = (plane: SamplePlane, x: number, y: number): number | undefined => {
  if (x < 0 || y < 0 || x >= plane.width || y >= plane.height) return undefined
  const unitWidth = Math.ceil(plane.width / 4)
  if (plane.reconstructed[(y >>> 2) * unitWidth + (x >>> 2)] !== 1) return undefined
  return plane.data[y * plane.width + x]
}

const createPlane = (width: number, height: number): SamplePlane => ({
  data: new Uint16Array(width * height),
  height,
  reconstructed: new Uint8Array(Math.ceil(width / 4) * Math.ceil(height / 4)),
  width,
})

const markReconstructed = (plane: SamplePlane, x: number, y: number, size: number): void => {
  const unitWidth = Math.ceil(plane.width / 4)
  const right = Math.min(plane.width, x + size)
  const bottom = Math.min(plane.height, y + size)
  for (let unitY = y >>> 2; unitY < Math.ceil(bottom / 4); unitY += 1) {
    for (let unitX = x >>> 2; unitX < Math.ceil(right / 4); unitX += 1) {
      plane.reconstructed[unitY * unitWidth + unitX] = 1
    }
  }
}

const chromaQp = (lumaQp: number, offset: number, bitDepth: 8 | 10): number => {
  const depthOffset = 6 * (bitDepth - 8)
  const input = Math.max(-depthOffset, Math.min(57, lumaQp + offset))
  let mapped = input
  if (input >= 30 && input <= 43) {
    mapped = [29, 30, 31, 32, 33, 33, 34, 34, 35, 35, 36, 36, 37, 37][input - 30] ?? input
  } else if (input > 43) {
    mapped = input - 6
  }
  return mapped + depthOffset
}

class RestrictedHevcPictureDecoder {
  #cabac: HevcCabacDecoder
  #contexts: HevcIntraCabacContexts
  readonly #ctDepth: Int8Array
  readonly #cbQpOffset: number
  readonly #crQpOffset: number
  readonly #deblockingDisabled: boolean
  readonly #deblockEdges: HevcDeblockEdges
  readonly #deblockBetaOffset: number
  readonly #deblockTcOffset: number
  readonly #depthWidth: number
  readonly #lumaModes: Int8Array
  readonly #modeWidth: number
  readonly #pps: HevcPpsInspection
  readonly #qpMap: Int16Array
  readonly #qpWidth: number
  readonly #saoChroma: boolean
  readonly #saoLuma: boolean
  readonly #saoParameters: HevcSaoCtb[]
  readonly #sliceQp: number
  readonly #sps: HevcSpsInspection
  readonly #substreamByteOffsets: readonly number[]
  readonly #sliceRbsp: Uint8Array
  readonly #u: SamplePlane
  readonly #v: SamplePlane
  readonly #y: SamplePlane
  #currentQp: number
  #previousQp: number
  #qpDeltaCoded = false
  #wppSyncContexts: HevcIntraCabacContexts | undefined

  constructor(
    nalUnit: Uint8Array,
    nalUnitType: number,
    sps: HevcSpsInspection,
    pps: HevcPpsInspection,
  ) {
    const slice = readHevcSliceData(nalUnit, nalUnitType, { pps: [pps], sps: [sps] })
    if (!slice.firstInPicture || slice.address !== 0 || slice.dependent) {
      throw unsupportedOperation(
        'HEVC picture decode currently requires one independent leading slice',
      )
    }
    if (slice.sliceQp === undefined) throw invalidInput('HEVC intra slice has no quantizer')
    if (sps.chromaFormat !== 1 || sps.separateColorPlane) {
      throw unsupportedOperation('HEVC picture decode currently supports YUV 4:2:0 only')
    }
    if (sps.bitDepth !== 8 && sps.bitDepth !== 10) {
      throw unsupportedOperation(`Unsupported HEVC picture bit depth: ${sps.bitDepth}`)
    }
    if (pps.tilesEnabled) {
      throw unsupportedOperation('HEVC tiles inside a coded picture are not decoded yet')
    }
    if (
      pps.entropyCodingSynchronization &&
      (sps.ctbWidth < 2 || slice.entryPointOffsets !== sps.ctbHeight - 1)
    ) {
      throw invalidInput('HEVC WPP entry points do not match the CTB rows')
    }
    if (!pps.entropyCodingSynchronization && slice.entryPointOffsets !== 0) {
      throw invalidInput('HEVC slice has entry points without tiles or WPP')
    }
    this.#sps = sps
    this.#pps = pps
    this.#sliceRbsp = slice.rbsp
    this.#substreamByteOffsets = slice.substreamByteOffsets
    this.#sliceQp = slice.sliceQp
    this.#currentQp = slice.sliceQp
    this.#previousQp = slice.sliceQp
    this.#cbQpOffset = slice.cbQpOffset
    this.#crQpOffset = slice.crQpOffset
    this.#deblockingDisabled = slice.deblockingFilterDisabled
    this.#deblockBetaOffset = slice.betaOffset
    this.#deblockTcOffset = slice.tcOffset
    this.#saoLuma = slice.sampleAdaptiveOffsetLuma
    this.#saoChroma = slice.sampleAdaptiveOffsetChroma
    if ((this.#saoLuma || this.#saoChroma) && pps.transquantBypassEnabled) {
      throw unsupportedOperation('HEVC SAO with transquant-bypass coding units is not decoded yet')
    }
    const noSao: HevcSaoComponent = {
      bandPosition: 0,
      edgeClass: 0,
      offsets: [0, 0, 0, 0, 0],
      type: 0,
    }
    this.#saoParameters = Array.from({ length: sps.ctbCount }, () => ({
      components: [noSao, noSao, noSao],
    }))
    this.#cabac = new HevcCabacDecoder(slice.rbsp, slice.cabacBitOffset)
    this.#contexts = new HevcIntraCabacContexts(slice.sliceQp)
    this.#depthWidth = Math.ceil(sps.codedWidth / 2 ** sps.log2MinCodingBlockSize)
    this.#ctDepth = new Int8Array(
      this.#depthWidth * Math.ceil(sps.codedHeight / 2 ** sps.log2MinCodingBlockSize),
    )
    this.#ctDepth.fill(-1)
    const minQpSize = 1 << this.#log2MinQpSize()
    this.#qpWidth = Math.ceil(sps.codedWidth / minQpSize)
    this.#qpMap = new Int16Array(this.#qpWidth * Math.ceil(sps.codedHeight / minQpSize))
    this.#qpMap.fill(-128)
    this.#modeWidth = Math.ceil(sps.codedWidth / 4)
    const edgeWidth = Math.ceil(sps.codedWidth / 4)
    const edgeHeight = Math.ceil(sps.codedHeight / 4)
    this.#deblockEdges = {
      widthIn4x4: edgeWidth,
      heightIn4x4: edgeHeight,
      vertical: new Uint8Array(edgeWidth * edgeHeight),
      horizontal: new Uint8Array(edgeWidth * edgeHeight),
    }
    this.#lumaModes = new Int8Array(this.#modeWidth * Math.ceil(sps.codedHeight / 4))
    this.#lumaModes.fill(-1)
    this.#y = createPlane(sps.codedWidth, sps.codedHeight)
    this.#u = createPlane(Math.ceil(sps.codedWidth / 2), Math.ceil(sps.codedHeight / 2))
    this.#v = createPlane(Math.ceil(sps.codedWidth / 2), Math.ceil(sps.codedHeight / 2))
  }

  decode(): DecodedHevcPicture {
    const ctbSize = 1 << this.#sps.log2CtbSize
    let address = 0
    while (address < this.#sps.ctbCount) {
      const ctbX = address % this.#sps.ctbWidth
      const ctbY = Math.floor(address / this.#sps.ctbWidth)
      if (this.#pps.entropyCodingSynchronization && ctbX === 0 && ctbY > 0) {
        const byteOffset = this.#substreamByteOffsets[ctbY]
        if (byteOffset === undefined || !this.#wppSyncContexts) {
          throw invalidInput('HEVC WPP row initialization is missing')
        }
        this.#cabac = new HevcCabacDecoder(this.#sliceRbsp, byteOffset * 8)
        this.#contexts = new HevcIntraCabacContexts(this.#sliceQp)
        this.#contexts.copyFrom(this.#wppSyncContexts)
      }
      const x = ctbX * ctbSize
      const y = ctbY * ctbSize
      try {
        if (this.#saoLuma || this.#saoChroma) this.#decodeSao(address)
        this.#codingQuadtree(x, y, this.#sps.log2CtbSize, 0)
      } catch (error) {
        if (error instanceof ImageError) {
          throw new ImageError(error.code, `${error.message} at HEVC CTB ${address}`, {
            cause: error,
          })
        }
        throw error
      }
      if (this.#pps.entropyCodingSynchronization && ctbX === 1) {
        const snapshot = new HevcIntraCabacContexts(this.#sliceQp)
        snapshot.copyFrom(this.#contexts)
        this.#wppSyncContexts = snapshot
      }
      address += 1
      const ended = this.#cabac.decodeTerminate() === 1
      const expectedEnd = address === this.#sps.ctbCount
      if (ended !== expectedEnd) {
        throw unsupportedOperation(
          `HEVC slice segmentation does not match the coded picture at CTB ${address - 1}`,
        )
      }
      if (
        this.#pps.entropyCodingSynchronization &&
        ctbX === this.#sps.ctbWidth - 1 &&
        ctbY + 1 < this.#sps.ctbHeight
      ) {
        const nextOffset = this.#substreamByteOffsets[ctbY + 1]
        if (nextOffset === undefined || this.#cabac.bitsRead > nextOffset * 8) {
          throw invalidInput(
            `HEVC WPP substream ${ctbY} exceeds its entry-point boundary at bit ${this.#cabac.bitsRead}`,
          )
        }
      }
    }
    const bitDepth = this.#sps.bitDepth === 10 ? 10 : 8
    if (!this.#deblockingDisabled) {
      applyHevcDeblocking(
        this.#y.data,
        this.#u.data,
        this.#v.data,
        this.#sps.codedWidth,
        this.#sps.codedHeight,
        this.#deblockEdges,
        {
          bitDepth,
          qp: this.#sliceQp,
          betaOffset: this.#deblockBetaOffset,
          tcOffset: this.#deblockTcOffset,
          cbQpOffset: this.#pps.cbQpOffset,
          crQpOffset: this.#pps.crQpOffset,
        },
      )
    }
    const y = this.#saoLuma
      ? applyHevcSao(
          this.#y.data,
          this.#y.width,
          this.#y.height,
          bitDepth,
          this.#sps.ctbWidth,
          this.#sps.ctbHeight,
          ctbSize,
          0,
          this.#saoParameters,
        )
      : this.#y.data
    const chromaCtbSize = ctbSize >> 1
    const u = this.#saoChroma
      ? applyHevcSao(
          this.#u.data,
          this.#u.width,
          this.#u.height,
          bitDepth,
          this.#sps.ctbWidth,
          this.#sps.ctbHeight,
          chromaCtbSize,
          1,
          this.#saoParameters,
        )
      : this.#u.data
    const v = this.#saoChroma
      ? applyHevcSao(
          this.#v.data,
          this.#v.width,
          this.#v.height,
          bitDepth,
          this.#sps.ctbWidth,
          this.#sps.ctbHeight,
          chromaCtbSize,
          2,
          this.#saoParameters,
        )
      : this.#v.data
    return {
      bitDepth,
      chromaFormat: 1,
      height: this.#sps.codedHeight,
      u,
      v,
      width: this.#sps.codedWidth,
      y,
    }
  }

  #decodeSao(address: number): void {
    const x = address % this.#sps.ctbWidth
    const y = Math.floor(address / this.#sps.ctbWidth)
    let mergeLeft = false
    if (x > 0) {
      mergeLeft =
        this.#cabac.decodeDecision(
          this.#contexts.context(this.#contexts.saoMerge, 0, 'SAO merge-left'),
        ) === 1
    }
    let mergeUp = false
    if (y > 0 && !mergeLeft) {
      mergeUp =
        this.#cabac.decodeDecision(
          this.#contexts.context(this.#contexts.saoMerge, 0, 'SAO merge-up'),
        ) === 1
    }
    if (mergeLeft || mergeUp) {
      const sourceAddress = mergeLeft ? address - 1 : address - this.#sps.ctbWidth
      const source = this.#saoParameters[sourceAddress]
      if (!source) throw invalidInput('HEVC merged SAO parameters are unavailable')
      this.#saoParameters[address] = source
      return
    }

    const components: HevcSaoComponent[] = []
    let chromaType: 0 | 1 | 2 = 0
    let chromaEdgeClass = 0
    for (let component = 0; component < 3; component += 1) {
      const enabled = component === 0 ? this.#saoLuma : this.#saoChroma
      if (!enabled) {
        components.push({ type: 0, offsets: [0, 0, 0, 0, 0], bandPosition: 0, edgeClass: 0 })
        continue
      }
      let type: 0 | 1 | 2 = chromaType
      if (component < 2) {
        const first = this.#cabac.decodeDecision(
          this.#contexts.context(this.#contexts.saoType, 0, 'SAO type'),
        )
        type = first === 0 ? 0 : this.#cabac.decodeBypass() === 0 ? 1 : 2
        if (component === 1) chromaType = type
      }
      if (type === 0) {
        components.push({ type, offsets: [0, 0, 0, 0, 0], bandPosition: 0, edgeClass: 0 })
        continue
      }
      const maximumOffset = (1 << (Math.min(this.#sps.bitDepth, 10) - 5)) - 1
      const absolute = [0, 0, 0, 0]
      for (let index = 0; index < 4; index += 1) {
        let magnitude = absolute[index] ?? 0
        while (magnitude < maximumOffset && this.#cabac.decodeBypass() === 1) {
          magnitude += 1
        }
        absolute[index] = magnitude
      }
      const offsets: [number, number, number, number, number] = [0, 0, 0, 0, 0]
      for (let index = 0; index < 4; index += 1) {
        const magnitude = absolute[index] ?? 0
        const negative = type === 1 ? magnitude > 0 && this.#cabac.decodeBypass() === 1 : index >= 2
        offsets[index + 1] = negative ? -magnitude : magnitude
      }
      let bandPosition = 0
      let edgeClass = chromaEdgeClass
      if (type === 1) bandPosition = this.#cabac.decodeBypassBits(5)
      else if (component < 2) {
        edgeClass = this.#cabac.decodeBypassBits(2)
        if (component === 1) chromaEdgeClass = edgeClass
      }
      components.push({ type, offsets, bandPosition, edgeClass })
    }
    const luma = components[0]
    const cb = components[1]
    const cr = components[2]
    if (!luma || !cb || !cr) throw invalidInput('HEVC SAO component parameters are missing')
    this.#saoParameters[address] = { components: [luma, cb, cr] }
  }

  #depthAt(x: number, y: number): number | undefined {
    if (x < 0 || y < 0 || x >= this.#sps.codedWidth || y >= this.#sps.codedHeight) return undefined
    const shift = this.#sps.log2MinCodingBlockSize
    const value = this.#ctDepth[(y >> shift) * this.#depthWidth + (x >> shift)]
    return value === undefined || value < 0 ? undefined : value
  }

  #codingQuadtree(x: number, y: number, log2Size: number, depth: number): void {
    const size = 1 << log2Size
    let split = false
    if (x + size > this.#sps.codedWidth || y + size > this.#sps.codedHeight) {
      split = log2Size > this.#sps.log2MinCodingBlockSize
    } else if (log2Size > this.#sps.log2MinCodingBlockSize) {
      const left = this.#depthAt(x - 1, y)
      const top = this.#depthAt(x, y - 1)
      const contextIndex =
        Number(left !== undefined && left > depth) + Number(top !== undefined && top > depth)
      split =
        this.#cabac.decodeDecision(
          this.#contexts.context(this.#contexts.splitCodingUnit, contextIndex, 'split coding unit'),
        ) === 1
    }
    const minQpLog2 = this.#log2MinQpSize()
    const managesQpGroup =
      this.#pps.cuQpDeltaEnabled && (log2Size === minQpLog2 || (!split && log2Size > minQpLog2))
    if (managesQpGroup) this.#beginQpGroup(x, y)
    if (split) {
      const half = size >> 1
      const childLog2 = log2Size - 1
      this.#codingQuadtree(x, y, childLog2, depth + 1)
      if (x + half < this.#sps.codedWidth) this.#codingQuadtree(x + half, y, childLog2, depth + 1)
      if (y + half < this.#sps.codedHeight) this.#codingQuadtree(x, y + half, childLog2, depth + 1)
      if (x + half < this.#sps.codedWidth && y + half < this.#sps.codedHeight) {
        this.#codingQuadtree(x + half, y + half, childLog2, depth + 1)
      }
      if (managesQpGroup) this.#finishQpGroup(x, y, size)
      return
    }
    const minShift = this.#sps.log2MinCodingBlockSize
    const right = Math.min(this.#sps.codedWidth, x + size)
    const bottom = Math.min(this.#sps.codedHeight, y + size)
    for (let unitY = y >> minShift; unitY < Math.ceil(bottom / 2 ** minShift); unitY += 1) {
      for (let unitX = x >> minShift; unitX < Math.ceil(right / 2 ** minShift); unitX += 1) {
        this.#ctDepth[unitY * this.#depthWidth + unitX] = depth
      }
    }
    this.#codingUnit(x, y, log2Size)
    if (managesQpGroup) this.#finishQpGroup(x, y, size)
  }

  #log2MinQpSize(): number {
    return this.#sps.log2CtbSize - (this.#pps.cuQpDeltaDepth ?? 0)
  }

  #beginQpGroup(x: number, y: number): void {
    const log2Size = this.#log2MinQpSize()
    const size = 1 << log2Size
    const ctbSize = 1 << this.#sps.log2CtbSize
    if (x === 0 && (y === 0 || (this.#pps.entropyCodingSynchronization && y % ctbSize === 0))) {
      this.#previousQp = this.#sliceQp
    }
    const sameCtbQp = (sampleX: number, sampleY: number): number | undefined => {
      if (
        sampleX < 0 ||
        sampleY < 0 ||
        Math.floor(sampleX / ctbSize) !== Math.floor(x / ctbSize) ||
        Math.floor(sampleY / ctbSize) !== Math.floor(y / ctbSize)
      ) {
        return undefined
      }
      const value =
        this.#qpMap[Math.floor(sampleY / size) * this.#qpWidth + Math.floor(sampleX / size)]
      return value === undefined || value === -128 ? undefined : value
    }
    const left = sameCtbQp(x - 1, y) ?? this.#previousQp
    const top = sameCtbQp(x, y - 1) ?? this.#previousQp
    this.#currentQp = (left + top + 1) >> 1
    this.#qpDeltaCoded = false
  }

  #finishQpGroup(x: number, y: number, size: number): void {
    const minSize = 1 << this.#log2MinQpSize()
    const right = Math.min(this.#sps.codedWidth, x + size)
    const bottom = Math.min(this.#sps.codedHeight, y + size)
    for (let groupY = y; groupY < bottom; groupY += minSize) {
      for (let groupX = x; groupX < right; groupX += minSize) {
        this.#qpMap[Math.floor(groupY / minSize) * this.#qpWidth + Math.floor(groupX / minSize)] =
          this.#currentQp
      }
    }
    this.#previousQp = this.#currentQp
  }

  #decodeQpDelta(): void {
    if (!this.#pps.cuQpDeltaEnabled || this.#qpDeltaCoded) return
    this.#qpDeltaCoded = true
    let absolute = 0
    while (absolute < 5) {
      const bin = this.#cabac.decodeDecision(
        this.#contexts.context(
          this.#contexts.cuQpDeltaAbsolute,
          Math.min(absolute, 1),
          'CU QP delta',
        ),
      )
      if (bin === 0) break
      absolute += 1
    }
    if (absolute === 5) {
      let prefix = 0
      while (this.#cabac.decodeBypass() === 1) {
        prefix += 1
        if (prefix > 24) throw invalidInput('HEVC CU QP delta is unreasonably large')
      }
      absolute += (1 << prefix) - 1 + this.#cabac.decodeBypassBits(prefix)
    }
    const delta = absolute === 0 || this.#cabac.decodeBypass() === 0 ? absolute : -absolute
    const qpOffset = 6 * (this.#sps.bitDepth - 8)
    this.#currentQp = ((this.#currentQp + delta + 52 + 2 * qpOffset) % (52 + qpOffset)) - qpOffset
  }

  #modeAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.#sps.codedWidth || y >= this.#sps.codedHeight) return 1
    const value = this.#lumaModes[(y >>> 2) * this.#modeWidth + (x >>> 2)]
    return value === undefined || value < 0 ? 1 : value
  }

  #setMode(x: number, y: number, size: number, mode: number): void {
    const right = Math.min(this.#sps.codedWidth, x + size)
    const bottom = Math.min(this.#sps.codedHeight, y + size)
    for (let unitY = y >>> 2; unitY < Math.ceil(bottom / 4); unitY += 1) {
      for (let unitX = x >>> 2; unitX < Math.ceil(right / 4); unitX += 1) {
        this.#lumaModes[unitY * this.#modeWidth + unitX] = mode
      }
    }
  }

  #codingUnit(x: number, y: number, log2Size: number): void {
    const transquantBypass =
      this.#pps.transquantBypassEnabled &&
      this.#cabac.decodeDecision(
        this.#contexts.context(this.#contexts.transquantBypass, 0, 'transquant bypass'),
      ) === 1
    const size = 1 << log2Size
    let intraSplit = false
    if (log2Size === this.#sps.log2MinCodingBlockSize) {
      intraSplit =
        this.#cabac.decodeDecision(
          this.#contexts.context(this.#contexts.partMode, 0, 'intra part mode'),
        ) === 0
    }
    if (this.#sps.pcmEnabled && !intraSplit) {
      if (this.#cabac.decodeTerminate() === 1) {
        throw unsupportedOperation('HEVC PCM coding units are not decoded yet')
      }
    }
    const predictionSize = intraSplit ? size >> 1 : size
    const positions: readonly (readonly [number, number])[] = intraSplit
      ? [
          [x, y],
          [x + predictionSize, y],
          [x, y + predictionSize],
          [x + predictionSize, y + predictionSize],
        ]
      : [[x, y]]
    const previousFlags = positions.map(
      () =>
        this.#cabac.decodeDecision(
          this.#contexts.context(
            this.#contexts.previousIntraLumaPrediction,
            0,
            'previous intra luma prediction',
          ),
        ) === 1,
    )
    const lumaModes: number[] = []
    for (let index = 0; index < positions.length; index += 1) {
      const position = positions[index]
      if (!position) throw invalidInput('HEVC prediction position is missing')
      const leftMode = this.#modeAt(position[0] - 1, position[1])
      const atCtbTop = (position[1] & ((1 << this.#sps.log2CtbSize) - 1)) === 0
      const topMode = atCtbTop ? 1 : this.#modeAt(position[0], position[1] - 1)
      const candidates = deriveHevcLumaCandidates(leftMode, topMode)
      let mode: number
      if (previousFlags[index]) {
        const first = this.#cabac.decodeBypass()
        const selected = first === 0 ? 0 : 1 + this.#cabac.decodeBypass()
        mode = deriveHevcLumaMode(candidates, selected, undefined)
      } else {
        mode = deriveHevcLumaMode(candidates, undefined, this.#cabac.decodeBypassBits(5))
      }
      lumaModes.push(mode)
      this.#setMode(position[0], position[1], predictionSize, mode)
    }
    let codedChromaMode = 4
    const derivedFlag =
      this.#cabac.decodeDecision(
        this.#contexts.context(this.#contexts.intraChromaPredictionMode, 0, 'intra chroma mode'),
      ) === 0
    if (!derivedFlag) codedChromaMode = this.#cabac.decodeBypassBits(2)
    const chromaMode = deriveHevcChromaMode(codedChromaMode, lumaModes[0] ?? 1)
    this.#transformTree(
      x,
      y,
      x,
      y,
      log2Size,
      0,
      0,
      intraSplit,
      transquantBypass,
      true,
      true,
      chromaMode,
    )
  }

  #transformTree(
    x: number,
    y: number,
    baseX: number,
    baseY: number,
    log2Size: number,
    depth: number,
    blockIndex: number,
    intraSplit: boolean,
    transquantBypass: boolean,
    parentCbfCb: boolean,
    parentCbfCr: boolean,
    chromaMode: number,
  ): void {
    let split: boolean
    if (log2Size > this.#sps.log2MaxTransformBlockSize || (intraSplit && depth === 0)) split = true
    else if (
      log2Size <= this.#sps.log2MinTransformBlockSize ||
      depth >= this.#sps.maxTransformHierarchyDepthIntra
    ) {
      split = false
    } else {
      split =
        this.#cabac.decodeDecision(
          this.#contexts.context(this.#contexts.splitTransform, 5 - log2Size, 'split transform'),
        ) === 1
    }
    let cbfCb = parentCbfCb
    let cbfCr = parentCbfCr
    if (log2Size > 2) {
      cbfCb =
        parentCbfCb &&
        this.#cabac.decodeDecision(
          this.#contexts.context(this.#contexts.chromaCbf, depth, 'Cb coded block'),
        ) === 1
      cbfCr =
        parentCbfCr &&
        this.#cabac.decodeDecision(
          this.#contexts.context(this.#contexts.chromaCbf, depth, 'Cr coded block'),
        ) === 1
    }
    if (split) {
      const half = 1 << (log2Size - 1)
      this.#transformTree(
        x,
        y,
        x,
        y,
        log2Size - 1,
        depth + 1,
        0,
        intraSplit,
        transquantBypass,
        cbfCb,
        cbfCr,
        chromaMode,
      )
      this.#transformTree(
        x + half,
        y,
        x,
        y,
        log2Size - 1,
        depth + 1,
        1,
        intraSplit,
        transquantBypass,
        cbfCb,
        cbfCr,
        chromaMode,
      )
      this.#transformTree(
        x,
        y + half,
        x,
        y,
        log2Size - 1,
        depth + 1,
        2,
        intraSplit,
        transquantBypass,
        cbfCb,
        cbfCr,
        chromaMode,
      )
      this.#transformTree(
        x + half,
        y + half,
        x,
        y,
        log2Size - 1,
        depth + 1,
        3,
        intraSplit,
        transquantBypass,
        cbfCb,
        cbfCr,
        chromaMode,
      )
      return
    }
    const cbfLuma =
      this.#cabac.decodeDecision(
        this.#contexts.context(this.#contexts.lumaCbf, depth === 0 ? 1 : 0, 'luma coded block'),
      ) === 1
    if (cbfLuma || cbfCb || cbfCr) this.#decodeQpDelta()
    this.#markTransformEdges(x, y, 1 << log2Size)
    const lumaMode = this.#modeAt(x, y)
    this.#reconstructBlock(
      this.#y,
      x,
      y,
      log2Size,
      0,
      lumaMode,
      cbfLuma,
      transquantBypass,
      this.#currentQp + 6 * (this.#sps.bitDepth - 8),
    )

    if (log2Size > 2) {
      const chromaLog2 = log2Size - 1
      const chromaX = x >> 1
      const chromaY = y >> 1
      const qpCb = chromaQp(this.#currentQp, this.#cbQpOffset, this.#sps.bitDepth === 10 ? 10 : 8)
      const qpCr = chromaQp(this.#currentQp, this.#crQpOffset, this.#sps.bitDepth === 10 ? 10 : 8)
      this.#reconstructBlock(
        this.#u,
        chromaX,
        chromaY,
        chromaLog2,
        1,
        chromaMode,
        cbfCb,
        transquantBypass,
        qpCb,
      )
      this.#reconstructBlock(
        this.#v,
        chromaX,
        chromaY,
        chromaLog2,
        2,
        chromaMode,
        cbfCr,
        transquantBypass,
        qpCr,
      )
    } else if (blockIndex === 3) {
      const qpCb = chromaQp(this.#currentQp, this.#cbQpOffset, this.#sps.bitDepth === 10 ? 10 : 8)
      const qpCr = chromaQp(this.#currentQp, this.#crQpOffset, this.#sps.bitDepth === 10 ? 10 : 8)
      this.#reconstructBlock(
        this.#u,
        baseX >> 1,
        baseY >> 1,
        2,
        1,
        chromaMode,
        cbfCb,
        transquantBypass,
        qpCb,
      )
      this.#reconstructBlock(
        this.#v,
        baseX >> 1,
        baseY >> 1,
        2,
        2,
        chromaMode,
        cbfCr,
        transquantBypass,
        qpCr,
      )
    }
  }

  #markTransformEdges(x: number, y: number, size: number): void {
    if (x > 0 && x < this.#sps.codedWidth) {
      const unitX = x >>> 2
      const bottom = Math.min(this.#sps.codedHeight, y + size)
      for (let unitY = y >>> 2; unitY < Math.ceil(bottom / 4); unitY += 1) {
        this.#deblockEdges.vertical[unitY * this.#deblockEdges.widthIn4x4 + unitX] = 1
      }
    }
    if (y > 0 && y < this.#sps.codedHeight) {
      const unitY = y >>> 2
      const right = Math.min(this.#sps.codedWidth, x + size)
      for (let unitX = x >>> 2; unitX < Math.ceil(right / 4); unitX += 1) {
        this.#deblockEdges.horizontal[unitY * this.#deblockEdges.widthIn4x4 + unitX] = 1
      }
    }
  }

  #reconstructBlock(
    plane: SamplePlane,
    x: number,
    y: number,
    log2Size: number,
    component: 0 | 1 | 2,
    mode: number,
    coded: boolean,
    transquantBypass: boolean,
    qp: number,
  ): void {
    const size = 1 << log2Size
    const top: (number | undefined)[] = [sampleAt(plane, x - 1, y - 1)]
    const left: (number | undefined)[] = [top[0]]
    for (let index = 0; index < size * 2; index += 1) {
      top.push(sampleAt(plane, x + index, y - 1))
      left.push(sampleAt(plane, x - 1, y + index))
    }
    const bitDepth = this.#sps.bitDepth === 10 ? 10 : 8
    const prediction = predictHevcIntra(prepareHevcIntraReferences(top, left, size, bitDepth), {
      bitDepth,
      component,
      mode,
      size: size === 4 ? 4 : size === 8 ? 8 : size === 16 ? 16 : 32,
      strongIntraSmoothing: this.#sps.strongIntraSmoothing,
    })
    let residual: Int32Array | undefined
    if (coded) {
      const block = decodeHevcResidual(this.#cabac, this.#contexts, {
        component,
        intraMode: mode,
        log2Size,
        signDataHiding: this.#pps.signDataHiding,
        transformSkipEnabled: this.#pps.transformSkipEnabled,
        transquantBypass,
      })
      const scalingFactors = this.#scalingFactors(log2Size, component)
      residual = inverseHevcTransform(block.coefficients, size, {
        bitDepth,
        component,
        intra: true,
        qp,
        ...(scalingFactors ? { scalingFactors } : {}),
        transformSkipped: block.transformSkipped,
        transquantBypass,
      })
    }
    const maximum = (1 << bitDepth) - 1
    const right = Math.min(plane.width, x + size)
    const bottom = Math.min(plane.height, y + size)
    for (let sampleY = y; sampleY < bottom; sampleY += 1) {
      for (let sampleX = x; sampleX < right; sampleX += 1) {
        const index = (sampleY - y) * size + sampleX - x
        const value = (prediction[index] ?? 0) + (residual?.[index] ?? 0)
        plane.data[sampleY * plane.width + sampleX] = Math.max(0, Math.min(maximum, value))
      }
    }
    markReconstructed(plane, x, y, size)
  }

  #scalingFactors(log2Size: number, component: 0 | 1 | 2): Int16Array | undefined {
    const lists = this.#pps.scalingLists ?? this.#sps.scalingLists
    if (!lists) return undefined
    const sizeId = log2Size - 2
    const list = lists.get(sizeId * 6 + component)
    if (!list) throw invalidInput('HEVC scaling list is missing for a transform block')
    const size = 1 << log2Size
    const sourceSize = sizeId === 0 ? 4 : 8
    const ratio = size / sourceSize
    const output = new Int16Array(size * size)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        output[y * size + x] =
          list.coefficients[Math.floor(y / ratio) * sourceSize + Math.floor(x / ratio)] ?? 16
      }
    }
    if (ratio > 1) output[0] = list.dc
    return output
  }
}

export const decodeHevcIntraPicture = (
  nalUnit: Uint8Array,
  nalUnitType: number,
  parameterSets: {
    readonly pps: readonly HevcPpsInspection[]
    readonly sps: readonly HevcSpsInspection[]
  },
): DecodedHevcPicture => {
  const slice = readHevcSliceData(nalUnit, nalUnitType, parameterSets)
  const pps = parameterSets.pps.find((candidate) => candidate.id === slice.ppsId)
  const sps = parameterSets.sps.find((candidate) => candidate.id === slice.spsId)
  if (!pps || !sps) throw invalidInput('HEVC picture parameter sets are missing')
  return new RestrictedHevcPictureDecoder(nalUnit, nalUnitType, sps, pps).decode()
}
