const markerOffset = (data: Uint8Array, marker: number, start = 0): number => {
  for (let offset = start; offset + 1 < data.byteLength; offset += 1) {
    if (data[offset] === 0xff && data[offset + 1] === marker) return offset
  }
  return -1
}

const insertBytes = (data: Uint8Array, offset: number, inserted: Uint8Array): Uint8Array => {
  const output = new Uint8Array(data.byteLength + inserted.byteLength)
  output.set(data.subarray(0, offset), 0)
  output.set(inserted, offset)
  output.set(data.subarray(offset), offset + inserted.byteLength)
  return output
}

const replaceRange = (
  data: Uint8Array,
  offset: number,
  length: number,
  replacement: Uint8Array,
): Uint8Array => {
  const output = new Uint8Array(data.byteLength - length + replacement.byteLength)
  output.set(data.subarray(0, offset), 0)
  output.set(replacement, offset)
  output.set(data.subarray(offset + length), offset + replacement.byteLength)
  return output
}

/**
 * Insert a component-0 COC that selects the irreversible 9/7 transform while
 * leaving the default COD reversible. Built from `lossless-gray8.j2k`.
 */
export const jpeg2000WithIrreversibleComponentCoc = (codestream: Uint8Array): Uint8Array => {
  const codingStyle = markerOffset(codestream, 0x52)
  if (codingStyle < 0) throw new Error('JPEG 2000 COD marker is missing')
  const length = (codestream[codingStyle + 2] ?? 0) * 256 + (codestream[codingStyle + 3] ?? 0)
  const afterCod = codingStyle + 2 + length
  return insertBytes(
    codestream,
    afterCod,
    Uint8Array.of(0xff, 0x53, 0x00, 0x09, 0x00, 0x00, 0x01, 0x04, 0x04, 0x00, 0x00),
  )
}

/**
 * Rewrite the main QCD from reversible style 0 to scalar-expounded style 2,
 * keeping the same exponents and a zero mantissa. Built from `lossless-gray8.j2k`.
 */
export const jpeg2000WithScalarQuantization = (codestream: Uint8Array): Uint8Array => {
  const quantization = markerOffset(codestream, 0x5c)
  if (quantization < 0) throw new Error('JPEG 2000 QCD marker is missing')
  const length = (codestream[quantization + 2] ?? 0) * 256 + (codestream[quantization + 3] ?? 0)
  const payload = codestream.subarray(quantization + 4, quantization + 2 + length)
  const sq = payload[0]
  if (sq === undefined || (sq & 0x1f) !== 0) {
    throw new Error('JPEG 2000 QCD fixture is not unquantized style 0')
  }
  const expanded = new Uint8Array(1 + (payload.byteLength - 1) * 2)
  expanded[0] = (sq & 0xe0) | 2
  for (let index = 1; index < payload.byteLength; index += 1) {
    const exponent = (payload[index] ?? 0) >>> 3
    const offset = 1 + (index - 1) * 2
    expanded[offset] = (exponent << 3) & 0xff
    expanded[offset + 1] = 0
  }
  const replacement = new Uint8Array(4 + expanded.byteLength)
  replacement[0] = 0xff
  replacement[1] = 0x5c
  replacement[2] = (expanded.byteLength + 2) >>> 8
  replacement[3] = (expanded.byteLength + 2) & 0xff
  replacement.set(expanded, 4)
  return replaceRange(codestream, quantization, 2 + length, replacement)
}

/**
 * Reduce the first included HL code-block from 19 coding passes to 16 without
 * changing packet layout. 16 and 19 share the same packet-header bit widths on
 * this OpenJPEG 2x2 stream, so the body stays valid while the pass count is
 * rate-truncated. Built from `lossless-gray8.j2k`.
 */
export const jpeg2000WithTruncatedCodingPasses = (codestream: Uint8Array): Uint8Array => {
  const startOfData = markerOffset(codestream, 0x93)
  if (startOfData < 0) throw new Error('JPEG 2000 SOD marker is missing')
  const packet = startOfData + 2
  if (codestream[packet + 2] !== 0xda) {
    throw new Error('JPEG 2000 truncated-pass fixture layout is unexpected')
  }
  const output = Uint8Array.from(codestream)
  output[packet + 2] = 0xd4
  return output
}
