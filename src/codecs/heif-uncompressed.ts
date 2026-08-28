import { ImageError, invalidInput, unsupportedOperation } from '../errors.ts'

export interface UncompressedComponent {
  readonly alignSize: number
  readonly bitDepth: number
  readonly format: number
  readonly index: number
  readonly type: number
}

export interface UncompressedConfig {
  readonly blockSize: number
  readonly components: readonly UncompressedComponent[]
  readonly compressedExtents?: readonly number[]
  readonly compressedUnit?: 0 | 1 | 2
  readonly compression: 'brotli' | 'deflate' | 'none' | 'zlib'
  readonly interleave: number
  readonly pixelSize: number
  readonly profile: number
  readonly rowAlignSize: number
  readonly sampling: number
  readonly tileAlignSize: number
  readonly tileColumns: number
  readonly tileRows: number
}

const uint16 = (data: Uint8Array, offset: number): number =>
  ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0)

const uint32 = (data: Uint8Array, offset: number): number =>
  ((data[offset] ?? 0) * 0x1000000 +
    (data[offset + 1] ?? 0) * 0x10000 +
    (data[offset + 2] ?? 0) * 0x100 +
    (data[offset + 3] ?? 0)) >>>
  0

const fourcc = (data: Uint8Array, offset: number): string =>
  String.fromCharCode(
    data[offset] ?? 0,
    data[offset + 1] ?? 0,
    data[offset + 2] ?? 0,
    data[offset + 3] ?? 0,
  )

export const parseCmpd = (data: Uint8Array): readonly number[] => {
  if (data.byteLength < 4) throw invalidInput('HEIF cmpd property is truncated')
  const count = uint32(data, 0)
  if (count < 1 || count > 16) throw invalidInput('HEIF cmpd component count is invalid')
  const types: number[] = []
  let offset = 4
  for (let index = 0; index < count; index += 1) {
    if (offset + 2 > data.byteLength) throw invalidInput('HEIF cmpd property is truncated')
    const type = uint16(data, offset)
    offset += 2
    if (type >= 0x8000) throw unsupportedOperation('HEIF cmpd URI component types are unsupported')
    types.push(type)
  }
  if (offset !== data.byteLength) throw invalidInput('HEIF cmpd property has trailing data')
  return types
}

export const parseUncC = (
  data: Uint8Array,
  componentTypes: readonly number[],
): UncompressedConfig => {
  if (data.byteLength < 8) throw invalidInput('HEIF uncC property is truncated')
  const version = data[0] ?? 0
  const profile = uint32(data, 4)
  if (version === 1) {
    throw unsupportedOperation('HEIF uncC version 1 profiles are not decoded yet')
  }
  if (version !== 0) throw unsupportedOperation(`Unsupported HEIF uncC version ${version}`)
  if (data.byteLength < 12) throw invalidInput('HEIF uncC property is truncated')
  const count = uint32(data, 8)
  if (count < 1 || count > 16) throw invalidInput('HEIF uncC component count is invalid')
  let offset = 12
  const components: UncompressedComponent[] = []
  for (let index = 0; index < count; index += 1) {
    if (offset + 5 > data.byteLength) throw invalidInput('HEIF uncC component record is truncated')
    const componentIndex = uint16(data, offset)
    const bitDepth = (data[offset + 2] ?? 0) + 1
    const format = data[offset + 3] ?? 0
    const alignSize = data[offset + 4] ?? 0
    offset += 5
    const type = componentTypes[componentIndex]
    if (type === undefined) throw invalidInput('HEIF uncC component index is out of range')
    if (format !== 0)
      throw unsupportedOperation('HEIF uncompressed signed or float samples are unsupported')
    if (bitDepth < 1 || bitDepth > 16) {
      throw unsupportedOperation(`Unsupported HEIF uncompressed bit depth ${bitDepth}`)
    }
    components.push({ index: componentIndex, bitDepth, format, alignSize, type })
  }
  if (offset + 24 > data.byteLength) throw invalidInput('HEIF uncC tiling fields are truncated')
  const sampling = data[offset] ?? 0
  const interleave = data[offset + 1] ?? 0
  const blockSize = data[offset + 2] ?? 0
  offset += 4
  const pixelSize = uint32(data, offset)
  const rowAlignSize = uint32(data, offset + 4)
  const tileAlignSize = uint32(data, offset + 8)
  const tileColumns = uint32(data, offset + 12) + 1
  const tileRows = uint32(data, offset + 16) + 1
  if (sampling > 2) throw unsupportedOperation(`Unsupported HEIF uncompressed sampling ${sampling}`)
  if (interleave > 5)
    throw unsupportedOperation(`Unsupported HEIF uncompressed interleave ${interleave}`)
  if (tileColumns > 64 || tileRows > 64)
    throw invalidInput('HEIF uncompressed tile grid is unreasonably large')
  return {
    profile,
    components,
    sampling,
    interleave,
    blockSize,
    pixelSize,
    rowAlignSize,
    tileAlignSize,
    tileColumns,
    tileRows,
    compression: 'none',
  }
}

export const parseCmpC = (
  data: Uint8Array,
): Pick<UncompressedConfig, 'compression' | 'compressedUnit'> => {
  if (data.byteLength < 8) throw invalidInput('HEIF cmpC property is truncated')
  const encoding = fourcc(data, 4)
  let compression: UncompressedConfig['compression']
  if (encoding === 'zlib') compression = 'zlib'
  else if (encoding === 'defl') compression = 'deflate'
  else if (encoding === 'brot') compression = 'brotli'
  else throw unsupportedOperation(`Unsupported HEIF generic compression ${encoding}`)
  const unit = data[8] ?? 0
  if (unit > 2) throw unsupportedOperation(`Unsupported HEIF compressed unit type ${unit}`)
  return { compression, compressedUnit: unit as 0 | 1 | 2 }
}

export const parseIcef = (data: Uint8Array): readonly number[] => {
  let offset = data.byteLength >= 4 && data[0] === 0 ? 4 : 0
  if (offset + 5 <= data.byteLength && uint32(data, offset) === 0) {
    const fieldSize = data[offset + 4] ?? 0
    offset += 5
    if (fieldSize === 0) return []
    if (fieldSize !== 8 && fieldSize !== 16 && fieldSize !== 32) {
      throw invalidInput(`HEIF icef field size ${fieldSize} is invalid`)
    }
    const width = fieldSize / 8
    if ((data.byteLength - offset) % width !== 0)
      throw invalidInput('HEIF icef property is truncated')
    const sizes: number[] = []
    for (; offset < data.byteLength; offset += width) {
      const size =
        width === 1
          ? (data[offset] ?? 0)
          : width === 2
            ? uint16(data, offset)
            : uint32(data, offset)
      if (size === 0) throw invalidInput('HEIF icef compressed extent is empty')
      sizes.push(size)
    }
    return sizes
  }
  return []
}

const align = (value: number, size: number): number => {
  if (size <= 1) return value
  const extra = value % size
  return extra === 0 ? value : value + (size - extra)
}

const sampleWidth = (width: number, type: number, sampling: number): number => {
  if ((type === 2 || type === 3) && sampling !== 0) return Math.ceil(width / 2)
  return width
}

const sampleHeight = (height: number, type: number, sampling: number): number => {
  if ((type === 2 || type === 3) && sampling === 2) return Math.ceil(height / 2)
  return height
}

const toByte = (value: number, bitDepth: number): number => {
  if (bitDepth <= 8) return Math.max(0, Math.min(255, value << (8 - bitDepth)))
  return Math.max(0, Math.min(255, value >> (bitDepth - 8)))
}

const readSample = (
  data: Uint8Array,
  offset: number,
  bitDepth: number,
  alignSize: number,
): { readonly offset: number; readonly value: number } => {
  const bytes = alignSize > 0 ? alignSize : Math.ceil(bitDepth / 8)
  if (offset + bytes > data.byteLength) throw invalidInput('HEIF uncompressed payload is truncated')
  let value = 0
  for (let index = 0; index < bytes; index += 1) value = (value << 8) | (data[offset + index] ?? 0)
  if (bitDepth < bytes * 8) value >>>= bytes * 8 - bitDepth
  return { offset: offset + bytes, value }
}

interface SampleCursor {
  bit: number
  offset: number
}

const alignCursor = (cursor: SampleCursor, size: number): void => {
  if (cursor.bit !== 0) {
    cursor.bit = 0
    cursor.offset += 1
  }
  cursor.offset = align(cursor.offset, size)
}

const readCursorSample = (
  data: Uint8Array,
  cursor: SampleCursor,
  bitDepth: number,
  alignSize: number,
): number => {
  const packed = alignSize === 0 && bitDepth % 8 !== 0
  if (!packed) {
    alignCursor(cursor, 1)
    const read = readSample(data, cursor.offset, bitDepth, alignSize)
    cursor.offset = read.offset
    return read.value
  }
  let value = 0
  for (let index = 0; index < bitDepth; index += 1) {
    if (cursor.offset >= data.byteLength)
      throw invalidInput('HEIF uncompressed payload is truncated')
    const byte = data[cursor.offset] ?? 0
    value = (value << 1) | ((byte >> (7 - cursor.bit)) & 1)
    cursor.bit += 1
    if (cursor.bit === 8) {
      cursor.bit = 0
      cursor.offset += 1
    }
  }
  return value
}

const yuvToRgb = (
  y: number,
  cb: number,
  cr: number,
  fullRange: boolean,
): readonly [number, number, number] => {
  const lumaOffset = fullRange ? 0 : 16
  const lumaRange = fullRange ? 255 : 219
  const chromaCenter = 128
  const chromaRange = fullRange ? 255 : 224
  const luma = (y - lumaOffset) / lumaRange
  const u = (cb - chromaCenter) / chromaRange
  const v = (cr - chromaCenter) / chromaRange
  const red = luma + 1.402 * v
  const green = luma - 0.344136 * u - 0.714136 * v
  const blue = luma + 1.772 * u
  return [
    Math.max(0, Math.min(255, Math.round(red * 255))),
    Math.max(0, Math.min(255, Math.round(green * 255))),
    Math.max(0, Math.min(255, Math.round(blue * 255))),
  ]
}

const writePixel = (
  output: Uint8Array,
  x: number,
  y: number,
  width: number,
  samples: ReadonlyMap<number, number>,
  components: readonly UncompressedComponent[],
  fullRange: boolean,
): void => {
  const depthFor = (type: number): number =>
    components.find((component) => component.type === type)?.bitDepth ?? 8
  const sample = (type: number, fallback: number): number =>
    toByte(samples.get(type) ?? fallback, depthFor(type))
  const target = (y * width + x) * 4
  if (samples.has(4) || samples.has(5) || samples.has(6)) {
    output[target] = sample(4, 0)
    output[target + 1] = sample(5, 0)
    output[target + 2] = sample(6, 0)
  } else if (samples.has(1) || samples.has(2) || samples.has(3)) {
    const rgb = yuvToRgb(sample(1, 0), sample(2, 128), sample(3, 128), fullRange)
    output[target] = rgb[0]
    output[target + 1] = rgb[1]
    output[target + 2] = rgb[2]
  } else {
    const gray = sample(0, 0)
    output[target] = gray
    output[target + 1] = gray
    output[target + 2] = gray
  }
  output[target + 3] = samples.has(7) ? sample(7, 255) : 255
}

const inflate = async (data: Uint8Array, encoding: 'deflate' | 'zlib'): Promise<Uint8Array> => {
  if (typeof DecompressionStream !== 'function') {
    throw unsupportedOperation('HEIF generic compression requires DecompressionStream')
  }
  const inflateOnce = async (format: CompressionFormat): Promise<Uint8Array> => {
    const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream(format))
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      let result: ReadableStreamReadResult<Uint8Array>
      try {
        result = await reader.read()
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        if (total > 0 && /trailing junk/i.test(message)) break
        throw error
      }
      if (result.done) break
      const chunk = result.value
      if (!(chunk instanceof Uint8Array)) throw invalidInput('HEIF inflated payload is invalid')
      chunks.push(chunk)
      total += chunk.byteLength
      if (total > 128 * 1024 * 1024)
        throw invalidInput('HEIF uncompressed payload is unreasonably large')
    }
    const output = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      output.set(chunk, offset)
      offset += chunk.byteLength
    }
    return output
  }

  const primary: CompressionFormat = encoding === 'zlib' ? 'deflate' : 'deflate-raw'
  const fallback: CompressionFormat = encoding === 'zlib' ? 'deflate-raw' : 'deflate'
  try {
    return await inflateOnce(primary)
  } catch (error) {
    if (error instanceof ImageError) throw error
    try {
      return await inflateOnce(fallback)
    } catch {
      throw invalidInput('HEIF compressed uncompressed payload is invalid')
    }
  }
}

const decodeTile = (
  data: Uint8Array,
  start: number,
  config: UncompressedConfig,
  tileX: number,
  tileY: number,
  tileWidth: number,
  tileHeight: number,
  imageWidth: number,
  _imageHeight: number,
  output: Uint8Array,
  fullRange: boolean,
): number => {
  const cursor: SampleCursor = { offset: start, bit: 0 }
  const components = config.components
  if (config.interleave === 1) {
    for (let y = 0; y < tileHeight; y += 1) {
      const rowStart = cursor.offset
      for (let x = 0; x < tileWidth; x += 1) {
        const samples = new Map<number, number>()
        for (const component of components) {
          samples.set(
            component.type,
            readCursorSample(data, cursor, component.bitDepth, component.alignSize),
          )
        }
        writePixel(output, tileX + x, tileY + y, imageWidth, samples, components, fullRange)
      }
      alignCursor(cursor, config.rowAlignSize)
      if (config.pixelSize > 0) {
        const rowBytes = config.pixelSize * tileWidth
        cursor.offset = Math.max(cursor.offset, rowStart + rowBytes)
        cursor.bit = 0
      }
    }
    alignCursor(cursor, config.tileAlignSize)
    return cursor.offset
  }
  if (config.interleave === 0 || config.interleave === 4) {
    const planes = new Map<number, Uint16Array>()
    for (const component of components) {
      const width = sampleWidth(tileWidth, component.type, config.sampling)
      const height = sampleHeight(tileHeight, component.type, config.sampling)
      const plane = new Uint16Array(width * height)
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          plane[y * width + x] = readCursorSample(
            data,
            cursor,
            component.bitDepth,
            component.alignSize,
          )
        }
        alignCursor(cursor, config.rowAlignSize)
      }
      planes.set(component.type, plane)
    }
    for (let y = 0; y < tileHeight; y += 1) {
      for (let x = 0; x < tileWidth; x += 1) {
        const samples = new Map<number, number>()
        for (const component of components) {
          const width = sampleWidth(tileWidth, component.type, config.sampling)
          const height = sampleHeight(tileHeight, component.type, config.sampling)
          const sx = Math.min(width - 1, config.sampling === 0 ? x : x >> 1)
          const sy = Math.min(
            height - 1,
            config.sampling === 2 && (component.type === 2 || component.type === 3) ? y >> 1 : y,
          )
          const plane = planes.get(component.type)
          samples.set(component.type, plane?.[sy * width + sx] ?? 0)
        }
        writePixel(output, tileX + x, tileY + y, imageWidth, samples, components, fullRange)
      }
    }
    alignCursor(cursor, config.tileAlignSize)
    return cursor.offset
  }
  if (config.interleave === 3) {
    for (let y = 0; y < tileHeight; y += 1) {
      const rowSamples = new Map<number, Uint16Array>()
      for (const component of components) {
        const width = sampleWidth(tileWidth, component.type, config.sampling)
        const row = new Uint16Array(width)
        for (let x = 0; x < width; x += 1) {
          row[x] = readCursorSample(data, cursor, component.bitDepth, component.alignSize)
        }
        rowSamples.set(component.type, row)
        alignCursor(cursor, config.rowAlignSize)
      }
      for (let x = 0; x < tileWidth; x += 1) {
        const samples = new Map<number, number>()
        for (const component of components) {
          const width = sampleWidth(tileWidth, component.type, config.sampling)
          const sx = Math.min(width - 1, config.sampling === 0 ? x : x >> 1)
          samples.set(component.type, rowSamples.get(component.type)?.[sx] ?? 0)
        }
        writePixel(output, tileX + x, tileY + y, imageWidth, samples, components, fullRange)
      }
    }
    alignCursor(cursor, config.tileAlignSize)
    return cursor.offset
  }
  if (config.interleave === 2) {
    const luma = components.find((component) => component.type === 1)
    const chroma = components.filter((component) => component.type === 2 || component.type === 3)
    if (!luma || chroma.length !== 2) {
      throw unsupportedOperation('HEIF mixed uncompressed interleave requires YCbCr')
    }
    const yPlane = new Uint16Array(tileWidth * tileHeight)
    for (let y = 0; y < tileHeight; y += 1) {
      for (let x = 0; x < tileWidth; x += 1) {
        yPlane[y * tileWidth + x] = readCursorSample(data, cursor, luma.bitDepth, luma.alignSize)
      }
      alignCursor(cursor, config.rowAlignSize)
    }
    const chromaWidth = sampleWidth(tileWidth, 2, config.sampling)
    const chromaHeight = sampleHeight(tileHeight, 2, config.sampling)
    const cb = new Uint16Array(chromaWidth * chromaHeight)
    const cr = new Uint16Array(chromaWidth * chromaHeight)
    for (let y = 0; y < chromaHeight; y += 1) {
      for (let x = 0; x < chromaWidth; x += 1) {
        const first = readCursorSample(
          data,
          cursor,
          chroma[0]?.bitDepth ?? 8,
          chroma[0]?.alignSize ?? 0,
        )
        const second = readCursorSample(
          data,
          cursor,
          chroma[1]?.bitDepth ?? 8,
          chroma[1]?.alignSize ?? 0,
        )
        const dest = y * chromaWidth + x
        if ((chroma[0]?.type ?? 2) === 2) {
          cb[dest] = first
          cr[dest] = second
        } else {
          cr[dest] = first
          cb[dest] = second
        }
      }
      alignCursor(cursor, config.rowAlignSize)
    }
    for (let y = 0; y < tileHeight; y += 1) {
      for (let x = 0; x < tileWidth; x += 1) {
        const sx = Math.min(chromaWidth - 1, config.sampling === 0 ? x : x >> 1)
        const sy = Math.min(chromaHeight - 1, config.sampling === 2 ? y >> 1 : y)
        writePixel(
          output,
          tileX + x,
          tileY + y,
          imageWidth,
          new Map([
            [1, yPlane[y * tileWidth + x] ?? 0],
            [2, cb[sy * chromaWidth + sx] ?? 128],
            [3, cr[sy * chromaWidth + sx] ?? 128],
          ]),
          components,
          fullRange,
        )
      }
    }
    alignCursor(cursor, config.tileAlignSize)
    return cursor.offset
  }
  if (config.interleave === 5) {
    for (let y = 0; y < tileHeight; y += 1) {
      for (let x = 0; x < tileWidth; x += 1) {
        if (cursor.offset + 2 > data.byteLength)
          throw invalidInput('HEIF uncompressed packed pixel is truncated')
        const packed = uint16(data, cursor.offset)
        cursor.offset += 2
        const red = (packed >> 11) & 0x1f
        const green = (packed >> 5) & 0x3f
        const blue = packed & 0x1f
        const target = ((tileY + y) * imageWidth + (tileX + x)) * 4
        output[target] = Math.round((red * 255) / 31)
        output[target + 1] = Math.round((green * 255) / 63)
        output[target + 2] = Math.round((blue * 255) / 31)
        output[target + 3] = 255
      }
      alignCursor(cursor, config.rowAlignSize)
    }
    alignCursor(cursor, config.tileAlignSize)
    return cursor.offset
  }
  throw unsupportedOperation(`Unsupported HEIF uncompressed interleave ${config.interleave}`)
}

export const decodeUncompressedRgba = async (
  payload: Uint8Array,
  config: UncompressedConfig,
  width: number,
  height: number,
  fullRange = true,
): Promise<Uint8Array> => {
  if (width < 1 || height < 1) throw invalidInput('HEIF uncompressed image has invalid dimensions')
  let data = payload
  if (config.compression === 'brotli') {
    throw unsupportedOperation('HEIF brotli generic compression is unsupported')
  }
  if (config.compression === 'deflate' || config.compression === 'zlib') {
    const extents = config.compressedExtents
    if (extents && extents.length > 0) {
      const chunks: Uint8Array[] = []
      let cursor = 0
      let total = 0
      for (const size of extents) {
        if (cursor + size > payload.byteLength) {
          throw invalidInput('HEIF compressed extent exceeds the item payload')
        }
        const inflated = await inflate(payload.subarray(cursor, cursor + size), config.compression)
        chunks.push(inflated)
        total += inflated.byteLength
        cursor += size
        if (total > 128 * 1024 * 1024)
          throw invalidInput('HEIF uncompressed payload is unreasonably large')
      }
      data = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        data.set(chunk, offset)
        offset += chunk.byteLength
      }
    } else {
      data = await inflate(payload, config.compression)
    }
  }

  const output = new Uint8Array(width * height * 4)
  const tileColumns = config.tileColumns
  const tileRows = config.tileRows
  const baseTileWidth = Math.floor(width / tileColumns)
  const baseTileHeight = Math.floor(height / tileRows)
  if (baseTileWidth < 1 || baseTileHeight < 1)
    throw invalidInput('HEIF uncompressed tiles are empty')
  let offset = 0
  for (let tileRow = 0; tileRow < tileRows; tileRow += 1) {
    const tileHeight =
      tileRow + 1 === tileRows ? height - baseTileHeight * (tileRows - 1) : baseTileHeight
    for (let tileColumn = 0; tileColumn < tileColumns; tileColumn += 1) {
      const tileWidth =
        tileColumn + 1 === tileColumns ? width - baseTileWidth * (tileColumns - 1) : baseTileWidth
      offset = decodeTile(
        data,
        offset,
        config,
        tileColumn * baseTileWidth,
        tileRow * baseTileHeight,
        tileWidth,
        tileHeight,
        width,
        height,
        output,
        fullRange,
      )
    }
  }
  return output
}
