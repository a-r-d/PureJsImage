const losslessDcCounts = Uint8Array.of(0, 0, 0, 0, 1, 2, 4, 4, 4, 2, 0, 0, 0, 0, 0, 0)
const losslessDcValues = Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)

const writeUint16 = (output: number[], value: number): void => {
  output.push((value >>> 8) & 0xff, value & 0xff)
}

const huffmanCodes = (
  counts: Uint8Array,
  symbols: Uint8Array,
): ReadonlyMap<number, { readonly code: number; readonly length: number }> => {
  const codes = new Map<number, { readonly code: number; readonly length: number }>()
  let code = 0
  let symbol = 0
  for (let index = 0; index < 16; index += 1) {
    const count = counts[index] ?? 0
    for (let offset = 0; offset < count; offset += 1) {
      codes.set(symbols[symbol] ?? 0, { code, length: index + 1 })
      code += 1
      symbol += 1
    }
    code <<= 1
  }
  return codes
}

class BitWriter {
  readonly #bytes: number[] = []
  #bits = 0
  #bitCount = 0

  write(code: number, length: number): void {
    for (let index = length - 1; index >= 0; index -= 1) {
      this.#bits = (this.#bits << 1) | ((code >>> index) & 1)
      this.#bitCount += 1
      if (this.#bitCount === 8) this.#flushByte()
    }
  }

  #flushByte(): void {
    this.#bytes.push(this.#bits & 0xff)
    if ((this.#bits & 0xff) === 0xff) this.#bytes.push(0)
    this.#bits = 0
    this.#bitCount = 0
  }

  finish(): Uint8Array {
    if (this.#bitCount > 0) {
      this.#bits <<= 8 - this.#bitCount
      this.#bits |= (1 << (8 - this.#bitCount)) - 1
      this.#flushByte()
    }
    return Uint8Array.from(this.#bytes)
  }
}

const categoryOf = (value: number): number => {
  if (value === 0) return 0
  let magnitude = value < 0 ? -value : value
  let category = 0
  while (magnitude > 0) {
    magnitude >>= 1
    category += 1
  }
  return category
}

const extraBits = (value: number, category: number): number => {
  if (category === 0) return 0
  return value < 0 ? value + (1 << category) - 1 : value
}

const predict = (selection: number, ra: number, rb: number, rc: number): number => {
  switch (selection) {
    case 1:
      return ra
    case 2:
      return rb
    case 3:
      return rc
    case 4:
      return ra + rb - rc
    case 5:
      return ra + ((rb - rc) >> 1)
    case 6:
      return rb + ((ra - rc) >> 1)
    case 7:
      return (ra + rb) >> 1
    default:
      throw new Error(`unsupported lossless selection ${selection}`)
  }
}

export const encodeJpegLosslessGray = (
  width: number,
  height: number,
  samples: readonly number[],
  options: Readonly<{ readonly precision?: number; readonly selection?: number }> = {},
): Uint8Array => {
  const precision = options.precision ?? 8
  const selection = options.selection ?? 1
  if (samples.length !== width * height) throw new Error('lossless JPEG sample count is invalid')
  const header: number[] = [0xff, 0xd8, 0xff, 0xc4]
  const tableBytes = [0, ...losslessDcCounts, ...losslessDcValues]
  writeUint16(header, tableBytes.length + 2)
  header.push(...tableBytes)
  header.push(0xff, 0xc3)
  writeUint16(header, 11)
  header.push(precision)
  writeUint16(header, height)
  writeUint16(header, width)
  header.push(1, 1, 0x11, 0)
  header.push(0xff, 0xda)
  writeUint16(header, 8)
  header.push(1, 1, 0, selection, 0, 0)

  const codes = huffmanCodes(losslessDcCounts, losslessDcValues)
  const writer = new BitWriter()
  const firstPredictor = 1 << (precision - 1)
  for (let index = 0; index < samples.length; index += 1) {
    const x = index % width
    const y = Math.floor(index / width)
    let predicted: number
    if (index === 0) predicted = firstPredictor
    else if (y === 0) predicted = samples[index - 1] ?? 0
    else if (x === 0) predicted = samples[index - width] ?? 0
    else {
      predicted = predict(
        selection,
        samples[index - 1] ?? 0,
        samples[index - width] ?? 0,
        samples[index - width - 1] ?? 0,
      )
    }
    let diff = (samples[index] ?? 0) - predicted
    const half = 1 << (precision - 1)
    if (diff < -half) diff += 1 << precision
    if (diff >= half) diff -= 1 << precision
    const category = categoryOf(diff)
    const encoded = codes.get(category)
    if (encoded === undefined) throw new Error(`no Huffman code for category ${category}`)
    writer.write(encoded.code, encoded.length)
    if (category > 0) writer.write(extraBits(diff, category), category)
  }
  const entropy = writer.finish()
  return Uint8Array.from([...header, ...entropy, 0xff, 0xd9])
}
