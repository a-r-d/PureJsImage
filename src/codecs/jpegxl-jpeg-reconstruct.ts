import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { JpegCoefficientComponent, JpegCoefficientImage } from './jpeg-coefficients.ts'
import type {
  JpegXlJpegHuffmanTable,
  JpegXlJpegReconstructionBlobs,
  JpegXlJpegReconstructionHeader,
  JpegXlJpegScan,
} from './jpegxl-jpeg-reconstruction.ts'

export interface JpegXlJpegReconstructionMetadata {
  readonly exif?: Uint8Array
  readonly xmp?: Uint8Array
}

interface HuffmanCode {
  readonly bits: number
  readonly code: number
}

const naturalOrder = new Uint8Array([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
  13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52,
  45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
])

const exifPrefix = Uint8Array.of(0x45, 0x78, 0x69, 0x66, 0, 0)
const xmpPrefix = Uint8Array.from('http://ns.adobe.com/xap/1.0/\0', (value) => value.charCodeAt(0))

class BoundedJpegWriter {
  readonly #maximumBytes: number
  #data: Uint8Array
  #length = 0

  constructor(maximumBytes: number) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw invalidInput('JPEG reconstruction output limit must be a positive safe integer')
    }
    this.#maximumBytes = maximumBytes
    this.#data = new Uint8Array(Math.min(maximumBytes, 4_096))
  }

  get length(): number {
    return this.#length
  }

  writeByte(value: number): void {
    this.#reserve(1)
    this.#data[this.#length] = value
    this.#length += 1
  }

  writeBytes(value: Uint8Array): void {
    this.#reserve(value.byteLength)
    this.#data.set(value, this.#length)
    this.#length += value.byteLength
  }

  writeUint16(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 65_535) {
      throw invalidInput('JPEG reconstruction 16-bit value is invalid')
    }
    this.writeByte(value >>> 8)
    this.writeByte(value)
  }

  finish(): Uint8Array {
    return this.#data.slice(0, this.#length)
  }

  #reserve(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.#length > this.#maximumBytes - bytes) {
      throw limitExceeded(`JPEG reconstruction exceeds the ${this.#maximumBytes}-byte output limit`)
    }
    const required = this.#length + bytes
    if (required <= this.#data.byteLength) return
    let capacity = Math.max(1, this.#data.byteLength)
    while (capacity < required) capacity = Math.min(this.#maximumBytes, capacity * 2)
    const expanded = new Uint8Array(capacity)
    expanded.set(this.#data.subarray(0, this.#length))
    this.#data = expanded
  }
}

class JpegEntropyWriter {
  readonly #output: BoundedJpegWriter
  readonly #paddingBits: readonly number[]
  #paddingPosition: number
  #byte = 0
  #bits = 0

  constructor(output: BoundedJpegWriter, paddingBits: readonly number[], paddingPosition: number) {
    this.#output = output
    this.#paddingBits = paddingBits
    this.#paddingPosition = paddingPosition
  }

  get paddingPosition(): number {
    return this.#paddingPosition
  }

  writeBits(value: number, count: number): void {
    if (!Number.isInteger(count) || count < 0 || count > 31) {
      throw invalidInput('JPEG reconstruction entropy bit count is invalid')
    }
    for (let shift = count - 1; shift >= 0; shift -= 1) {
      this.#byte = (this.#byte << 1) | ((value >>> shift) & 1)
      this.#bits += 1
      if (this.#bits === 8) this.#flushByte()
    }
  }

  align(): void {
    while (this.#bits !== 0) {
      const padding =
        this.#paddingBits.length === 0 ? 1 : (this.#paddingBits[this.#paddingPosition++] ?? -1)
      if (padding !== 0 && padding !== 1) {
        throw invalidInput('JPEG reconstruction entropy padding is incomplete')
      }
      this.writeBits(padding, 1)
    }
  }

  writeRestart(marker: number): void {
    this.align()
    this.#output.writeByte(0xff)
    this.#output.writeByte(marker)
  }

  #flushByte(): void {
    this.#output.writeByte(this.#byte)
    if (this.#byte === 0xff) this.#output.writeByte(0)
    this.#byte = 0
    this.#bits = 0
  }
}

const writeMarker = (output: BoundedJpegWriter, marker: number): void => {
  output.writeByte(0xff)
  output.writeByte(marker)
}

const writeSegment = (output: BoundedJpegWriter, marker: number, payload: Uint8Array): void => {
  if (payload.byteLength > 65_533) throw invalidInput('JPEG reconstruction segment is too large')
  writeMarker(output, marker)
  output.writeUint16(payload.byteLength + 2)
  output.writeBytes(payload)
}

const buildHuffmanCodes = (table: JpegXlJpegHuffmanTable): ReadonlyMap<number, HuffmanCode> => {
  const codes = new Map<number, HuffmanCode>()
  let code = 0
  let valueIndex = 0
  for (let bits = 1; bits <= 16; bits += 1) {
    const count = table.counts[bits] ?? 0
    for (let index = 0; index < count; index += 1) {
      const symbol = table.values[valueIndex]
      if (symbol === undefined) throw invalidInput('JPEG reconstruction Huffman value is missing')
      codes.set(symbol, Object.freeze({ bits, code }))
      code += 1
      valueIndex += 1
    }
    if (code > 2 ** bits) throw invalidInput('JPEG reconstruction Huffman code is oversubscribed')
    code *= 2
  }
  if (valueIndex !== table.values.length || !codes.has(256)) {
    throw invalidInput('JPEG reconstruction Huffman terminal symbol is missing')
  }
  return codes
}

const writeHuffmanSymbol = (
  output: JpegEntropyWriter,
  table: ReadonlyMap<number, HuffmanCode>,
  symbol: number,
): void => {
  const entry = table.get(symbol)
  if (!entry || symbol === 256) {
    throw invalidInput(`JPEG reconstruction Huffman symbol ${symbol} is unavailable`)
  }
  output.writeBits(entry.code, entry.bits)
}

const magnitudeBits = (value: number): number =>
  value === 0 ? 0 : Math.floor(Math.log2(Math.abs(value))) + 1

const magnitudeValue = (value: number, bits: number): number =>
  value < 0 ? value + 2 ** bits - 1 : value

const componentFor = (image: JpegCoefficientImage, index: number): JpegCoefficientComponent => {
  const component = image.components[index]
  if (!component) throw invalidInput('JPEG reconstruction scan component is missing')
  return component
}

const coefficient = (
  component: JpegCoefficientComponent,
  block: number,
  zigZag: number,
): number => {
  const natural = naturalOrder[zigZag]
  if (natural === undefined) throw invalidInput('JPEG reconstruction coefficient order is invalid')
  const offset = block * 64 + natural
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= component.coefficients.length) {
    throw invalidInput('JPEG reconstruction coefficient index is invalid')
  }
  return component.coefficients[offset] ?? 0
}

const writeDcFirst = (
  output: JpegEntropyWriter,
  component: JpegCoefficientComponent,
  block: number,
  low: number,
  predictor: Int32Array,
  componentIndex: number,
  dcTable: ReadonlyMap<number, HuffmanCode>,
): void => {
  const dc = coefficient(component, block, 0) >> low
  const difference = dc - (predictor[componentIndex] ?? 0)
  predictor[componentIndex] = dc
  const bits = magnitudeBits(difference)
  writeHuffmanSymbol(output, dcTable, bits)
  if (bits !== 0) output.writeBits(magnitudeValue(difference, bits), bits)
}

const flushEobRun = (
  output: JpegEntropyWriter,
  acTable: ReadonlyMap<number, HuffmanCode>,
  run: number,
): void => {
  if (run < 1 || run > 32_767) throw invalidInput('JPEG reconstruction EOB run is invalid')
  const bits = Math.floor(Math.log2(run))
  writeHuffmanSymbol(output, acTable, bits << 4)
  if (bits !== 0) output.writeBits(run - 2 ** bits, bits)
}

const writeAcBlock = (
  output: JpegEntropyWriter,
  component: JpegCoefficientComponent,
  block: number,
  scan: JpegXlJpegScan,
  acTable: ReadonlyMap<number, HuffmanCode>,
): boolean => {
  let lastNonzero = scan.spectralEnd
  while (
    lastNonzero >= scan.spectralStart &&
    coefficient(component, block, lastNonzero) >> scan.successiveLow === 0
  ) {
    lastNonzero -= 1
  }
  if (lastNonzero < scan.spectralStart) return true
  let zeros = 0
  for (let zigZag = scan.spectralStart; zigZag <= lastNonzero; zigZag += 1) {
    const value = coefficient(component, block, zigZag) >> scan.successiveLow
    if (value === 0) {
      zeros += 1
      continue
    }
    while (zeros > 15) {
      writeHuffmanSymbol(output, acTable, 0xf0)
      zeros -= 16
    }
    const bits = magnitudeBits(value)
    writeHuffmanSymbol(output, acTable, (zeros << 4) | bits)
    output.writeBits(magnitudeValue(value, bits), bits)
    zeros = 0
  }
  return lastNonzero < scan.spectralEnd
}

const scanBlockIndexes = (
  image: JpegCoefficientImage,
  scan: JpegXlJpegScan,
  visit: (componentIndex: number, block: number, mcu: number) => void,
): number => {
  const single = scan.components.length === 1 ? scan.components[0] : undefined
  const firstComponent = single ? componentFor(image, single.component) : undefined
  const mcusAcross = firstComponent?.blocksPerLine ?? image.mcusPerLine
  const mcusDown = firstComponent?.blocksPerColumn ?? image.mcusPerColumn
  let visited = 0
  for (let mcuY = 0; mcuY < mcusDown; mcuY += 1) {
    for (let mcuX = 0; mcuX < mcusAcross; mcuX += 1) {
      const mcu = mcuY * mcusAcross + mcuX
      for (const selected of scan.components) {
        const component = componentFor(image, selected.component)
        const blocksWide = single ? 1 : component.horizontalSampling
        const blocksHigh = single ? 1 : component.verticalSampling
        for (let y = 0; y < blocksHigh; y += 1) {
          for (let x = 0; x < blocksWide; x += 1) {
            const blockX = single ? mcuX : mcuX * blocksWide + x
            const blockY = single ? mcuY : mcuY * blocksHigh + y
            const block = blockY * component.blocksPerLineForMcu + blockX
            visit(selected.component, block, mcu)
            visited += 1
          }
        }
      }
    }
  }
  return visited
}

const encodeScan = (
  output: BoundedJpegWriter,
  image: JpegCoefficientImage,
  scan: JpegXlJpegScan,
  dcTables: ReadonlyMap<number, ReadonlyMap<number, HuffmanCode>>,
  acTables: ReadonlyMap<number, ReadonlyMap<number, HuffmanCode>>,
  restartInterval: number,
  paddingBits: readonly number[],
  paddingPosition: number,
): number => {
  if (scan.successiveHigh !== 0) {
    throw unsupportedOperation('JPEG reconstruction progressive refinement scans are not supported')
  }
  const entropy = new JpegEntropyWriter(output, paddingBits, paddingPosition)
  const predictors = new Int32Array(image.components.length)
  let pendingEob = 0
  let blockIndex = 0
  let previousMcu = -1
  let restart = 0
  let resetPosition = 0
  let extraZeroPosition = 0

  const flushPending = (selected: (typeof scan.components)[number]): void => {
    if (pendingEob === 0) return
    const table = acTables.get(selected.acTable)
    if (!table) throw invalidInput('JPEG reconstruction AC Huffman table is missing')
    flushEobRun(entropy, table, pendingEob)
    pendingEob = 0
  }

  scanBlockIndexes(image, scan, (componentIndex, block, mcu) => {
    const selected = scan.components.find(({ component }) => component === componentIndex)
    if (!selected) throw invalidInput('JPEG reconstruction scan selector is missing')
    if (mcu !== previousMcu) {
      if (restartInterval > 0 && mcu > 0 && mcu % restartInterval === 0) {
        flushPending(selected)
        entropy.writeRestart(0xd0 + (restart & 7))
        restart += 1
        predictors.fill(0)
      }
      previousMcu = mcu
    }
    if (scan.resetPoints[resetPosition] === blockIndex) {
      flushPending(selected)
      resetPosition += 1
    }
    const component = componentFor(image, componentIndex)
    if (scan.spectralStart === 0) {
      const dcTable = dcTables.get(selected.dcTable)
      if (!dcTable) throw invalidInput('JPEG reconstruction DC Huffman table is missing')
      writeDcFirst(
        entropy,
        component,
        block,
        scan.successiveLow,
        predictors,
        componentIndex,
        dcTable,
      )
    }
    if (scan.spectralEnd > 0) {
      const acTable = acTables.get(selected.acTable)
      if (!acTable) throw invalidInput('JPEG reconstruction AC Huffman table is missing')
      if (scan.spectralStart === 0 && scan.spectralEnd === 63 && scan.successiveLow === 0) {
        let zeros = 0
        for (let zigZag = 1; zigZag < 64; zigZag += 1) {
          const value = coefficient(component, block, zigZag)
          if (value === 0) {
            zeros += 1
            continue
          }
          while (zeros > 15) {
            writeHuffmanSymbol(entropy, acTable, 0xf0)
            zeros -= 16
          }
          const bits = magnitudeBits(value)
          writeHuffmanSymbol(entropy, acTable, (zeros << 4) | bits)
          entropy.writeBits(magnitudeValue(value, bits), bits)
          zeros = 0
        }
        const extra = scan.extraZeroRuns[extraZeroPosition]
        if (extra?.block === blockIndex) {
          for (let index = 0; index < extra.runs; index += 1) {
            writeHuffmanSymbol(entropy, acTable, 0xf0)
          }
          extraZeroPosition += 1
        }
        if (zeros > 0) writeHuffmanSymbol(entropy, acTable, 0)
      } else if (scan.spectralStart > 0) {
        let lastNonzero = scan.spectralEnd
        while (
          lastNonzero >= scan.spectralStart &&
          coefficient(component, block, lastNonzero) >> scan.successiveLow === 0
        ) {
          lastNonzero -= 1
        }
        if (lastNonzero >= scan.spectralStart) flushPending(selected)
        const buffersEndOfBand = writeAcBlock(entropy, component, block, scan, acTable)
        if (buffersEndOfBand) {
          pendingEob += 1
          if (pendingEob === 32_767) flushPending(selected)
        }
      }
    }
    blockIndex += 1
  })
  const lastSelected = scan.components.at(-1)
  if (!lastSelected) throw invalidInput('JPEG reconstruction scan is empty')
  flushPending(lastSelected)
  entropy.align()
  if (
    resetPosition !== scan.resetPoints.length ||
    extraZeroPosition !== scan.extraZeroRuns.length
  ) {
    throw invalidInput('JPEG reconstruction scan exactness indexes are out of range')
  }
  return entropy.paddingPosition
}

const quantizationFor = (image: JpegCoefficientImage, index: number): Int32Array => {
  const component = image.components.find(({ quantizationTable }) => quantizationTable === index)
  if (!component) throw invalidInput('JPEG reconstruction quantization table is unavailable')
  return component.quantization
}

const createMetadataMarker = (
  marker: number,
  prefix: Uint8Array,
  metadata: Uint8Array,
  skip: number,
  expectedBytes: number,
): Uint8Array => {
  if (metadata.byteLength < skip) throw invalidInput('JPEG reconstruction metadata is truncated')
  const payloadBytes = prefix.byteLength + metadata.byteLength - skip
  const output = new Uint8Array(payloadBytes + 3)
  output[0] = marker
  const length = payloadBytes + 2
  output[1] = length >>> 8
  output[2] = length
  output.set(prefix, 3)
  output.set(metadata.subarray(skip), 3 + prefix.byteLength)
  if (output.byteLength !== expectedBytes) {
    throw invalidInput('JPEG reconstruction metadata size does not match its descriptor')
  }
  return output
}

export const reconstructJpegFromCoefficientImage = (
  header: JpegXlJpegReconstructionHeader,
  blobs: JpegXlJpegReconstructionBlobs,
  image: JpegCoefficientImage,
  metadata: Readonly<JpegXlJpegReconstructionMetadata>,
  maximumOutputBytes: number,
): Uint8Array => {
  if (image.components.length !== header.componentIds.length) {
    throw invalidInput('JPEG reconstruction component count does not match image coefficients')
  }
  for (let index = 0; index < image.components.length; index += 1) {
    const component = componentFor(image, index)
    if (
      component.id !== header.componentIds[index] ||
      component.quantizationTable !== header.componentQuantizationTables[index]
    ) {
      throw invalidInput(
        'JPEG reconstruction component descriptors do not match image coefficients',
      )
    }
  }

  const output = new BoundedJpegWriter(maximumOutputBytes)
  writeMarker(output, 0xd8)
  const installedDc = new Map<number, ReadonlyMap<number, HuffmanCode>>()
  const installedAc = new Map<number, ReadonlyMap<number, HuffmanCode>>()
  let appIndex = 0
  let unknownAppIndex = 0
  let commentIndex = 0
  let quantizationIndex = 0
  let huffmanIndex = 0
  let scanIndex = 0
  let interMarkerIndex = 0
  let paddingPosition = 0

  for (const marker of header.markerOrder) {
    if ((marker & 0xf0) === 0xe0) {
      const descriptor = header.appMarkers[appIndex++]
      if (!descriptor) throw invalidInput('JPEG reconstruction APP descriptor is missing')
      let bytes: Uint8Array
      if (descriptor.type === 'unknown') {
        bytes = blobs.unknownAppMarkers[unknownAppIndex++] ?? new Uint8Array()
      } else if (descriptor.type === 'exif') {
        if (!metadata.exif) throw invalidInput('JPEG reconstruction Exif box is missing')
        bytes = createMetadataMarker(marker, exifPrefix, metadata.exif, 4, descriptor.byteLength)
      } else if (descriptor.type === 'xmp') {
        if (!metadata.xmp) throw invalidInput('JPEG reconstruction XMP box is missing')
        bytes = createMetadataMarker(marker, xmpPrefix, metadata.xmp, 0, descriptor.byteLength)
      } else {
        throw unsupportedOperation('JPEG reconstruction ICC marker assembly is not implemented')
      }
      if (bytes.byteLength !== descriptor.byteLength || bytes[0] !== marker) {
        throw invalidInput('JPEG reconstruction APP marker data does not match its descriptor')
      }
      output.writeByte(0xff)
      output.writeBytes(bytes)
      continue
    }
    if (marker === 0xfe) {
      const bytes = blobs.comments[commentIndex++]
      const expected = header.commentByteLengths[commentIndex - 1]
      if (!bytes || bytes.byteLength !== expected || bytes[0] !== marker) {
        throw invalidInput('JPEG reconstruction COM marker data does not match its descriptor')
      }
      output.writeByte(0xff)
      output.writeBytes(bytes)
      continue
    }
    if (marker === 0xff) {
      const bytes = blobs.interMarkerData[interMarkerIndex++]
      if (!bytes) throw invalidInput('JPEG reconstruction inter-marker data is missing')
      output.writeBytes(bytes)
      continue
    }
    if (marker === 0xdb) {
      const payload: number[] = []
      while (true) {
        const descriptor = header.quantizationTables[quantizationIndex++]
        if (!descriptor)
          throw invalidInput('JPEG reconstruction quantization descriptor is missing')
        payload.push((descriptor.precision === 16 ? 16 : 0) | descriptor.index)
        const table = quantizationFor(image, descriptor.index)
        for (const natural of naturalOrder) {
          const value = table[natural] ?? 0
          if (descriptor.precision === 16) payload.push(value >>> 8)
          payload.push(value & 255)
        }
        if (descriptor.lastInMarker) break
      }
      writeSegment(output, marker, Uint8Array.from(payload))
      continue
    }
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const payload = new Uint8Array(6 + image.components.length * 3)
      payload[0] = 8
      payload[1] = image.height >>> 8
      payload[2] = image.height
      payload[3] = image.width >>> 8
      payload[4] = image.width
      payload[5] = image.components.length
      for (let index = 0; index < image.components.length; index += 1) {
        const component = componentFor(image, index)
        const offset = 6 + index * 3
        payload[offset] = component.id
        payload[offset + 1] = (component.horizontalSampling << 4) | component.verticalSampling
        payload[offset + 2] = component.quantizationTable
      }
      writeSegment(output, marker, payload)
      continue
    }
    if (marker === 0xc4) {
      const payload: number[] = []
      while (true) {
        const table = header.huffmanTables[huffmanIndex++]
        if (!table) throw invalidInput('JPEG reconstruction Huffman descriptor is missing')
        const codes = buildHuffmanCodes(table)
        ;(table.kind === 'dc' ? installedDc : installedAc).set(table.slot, codes)
        payload.push((table.kind === 'ac' ? 0x10 : 0) | table.slot)
        let terminalLength = 0
        for (let bits = 16; bits >= 1; bits -= 1) {
          if ((table.counts[bits] ?? 0) !== 0) {
            terminalLength = bits
            break
          }
        }
        if (terminalLength === 0 || table.values.at(-1) !== 256) {
          throw invalidInput('JPEG reconstruction Huffman terminal descriptor is invalid')
        }
        for (let bits = 1; bits <= 16; bits += 1) {
          payload.push((table.counts[bits] ?? 0) - (bits === terminalLength ? 1 : 0))
        }
        for (const value of table.values.slice(0, -1)) payload.push(value)
        if (table.lastInMarker) break
      }
      writeSegment(output, marker, Uint8Array.from(payload))
      continue
    }
    if (marker === 0xdd) {
      const restartInterval = header.restartInterval
      if (restartInterval === undefined)
        throw invalidInput('JPEG reconstruction DRI value is missing')
      writeSegment(output, marker, Uint8Array.of(restartInterval >>> 8, restartInterval))
      continue
    }
    if (marker === 0xda) {
      const scan = header.scans[scanIndex++]
      if (!scan) throw invalidInput('JPEG reconstruction scan descriptor is missing')
      const payload = new Uint8Array(4 + scan.components.length * 2)
      payload[0] = scan.components.length
      for (let index = 0; index < scan.components.length; index += 1) {
        const selected = scan.components[index]
        if (!selected) throw invalidInput('JPEG reconstruction scan component is missing')
        payload[1 + index * 2] = componentFor(image, selected.component).id
        payload[2 + index * 2] = (selected.dcTable << 4) | selected.acTable
      }
      const spectralOffset = 1 + scan.components.length * 2
      payload[spectralOffset] = scan.spectralStart
      payload[spectralOffset + 1] = scan.spectralEnd
      payload[spectralOffset + 2] = (scan.successiveHigh << 4) | scan.successiveLow
      writeSegment(output, marker, payload)
      paddingPosition = encodeScan(
        output,
        image,
        scan,
        installedDc,
        installedAc,
        header.restartInterval ?? 0,
        header.paddingBits,
        paddingPosition,
      )
      continue
    }
    if (marker === 0xd9) {
      writeMarker(output, marker)
      output.writeBytes(blobs.tail)
      continue
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      writeMarker(output, marker)
      continue
    }
    throw unsupportedOperation(
      `JPEG reconstruction marker 0x${marker.toString(16).padStart(2, '0')} is not supported`,
    )
  }

  if (
    appIndex !== header.appMarkers.length ||
    unknownAppIndex !== blobs.unknownAppMarkers.length ||
    commentIndex !== header.commentByteLengths.length ||
    quantizationIndex !== header.quantizationTables.length ||
    huffmanIndex !== header.huffmanTables.length ||
    scanIndex !== header.scans.length ||
    interMarkerIndex !== header.interMarkerByteLengths.length ||
    paddingPosition !== header.paddingBits.length
  ) {
    throw invalidInput('JPEG reconstruction descriptors were not consumed exactly')
  }
  return output.finish()
}
