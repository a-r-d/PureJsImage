const writeUint32Le = (output: Uint8Array, offset: number, value: number): void => {
  output[offset] = value & 0xff
  output[offset + 1] = (value >>> 8) & 0xff
  output[offset + 2] = (value >>> 16) & 0xff
  output[offset + 3] = (value >>> 24) & 0xff
}

const encodeRleSegment = (input: Uint8Array, columns: number): Uint8Array => {
  const output: number[] = []
  let index = 0
  while (index < input.byteLength) {
    const rowEnd = Math.min(input.byteLength, index + columns - (index % columns))
    while (index < rowEnd) {
      const value = input[index]
      if (value === undefined) break
      let run = 1
      while (index + run < rowEnd && input[index + run] === value && run < 128) run += 1
      if (run >= 2) {
        output.push(257 - run, value)
        index += run
        continue
      }
      const literalStart = index
      index += 1
      while (index < rowEnd && index - literalStart < 128) {
        const next = input[index]
        const following = input[index + 1]
        if (next !== undefined && index + 1 < rowEnd && next === following) break
        index += 1
      }
      const count = index - literalStart
      output.push(count - 1)
      for (let offset = 0; offset < count; offset += 1)
        output.push(input[literalStart + offset] ?? 0)
    }
  }
  return Uint8Array.from(output)
}

export const encodeDicomRleFrame = (
  nativeLittleEndian: Uint8Array,
  bitsAllocated: 8 | 16,
  columns: number,
): Uint8Array => {
  const planes: Uint8Array[] = []
  if (bitsAllocated === 8) {
    planes.push(nativeLittleEndian)
  } else {
    const samples = nativeLittleEndian.byteLength / 2
    const high = new Uint8Array(samples)
    const low = new Uint8Array(samples)
    for (let index = 0; index < samples; index += 1) {
      low[index] = nativeLittleEndian[index * 2] ?? 0
      high[index] = nativeLittleEndian[index * 2 + 1] ?? 0
    }
    planes.push(high, low)
  }
  const encodedPlanes = planes.map((plane) => encodeRleSegment(plane, columns))
  const header = new Uint8Array(64)
  writeUint32Le(header, 0, encodedPlanes.length)
  let offset = 64
  for (let index = 0; index < encodedPlanes.length; index += 1) {
    writeUint32Le(header, (index + 1) * 4, offset)
    offset += encodedPlanes[index]?.byteLength ?? 0
  }
  const output = new Uint8Array(offset)
  output.set(header)
  let cursor = 64
  for (const plane of encodedPlanes) {
    output.set(plane, cursor)
    cursor += plane.byteLength
  }
  return output
}
