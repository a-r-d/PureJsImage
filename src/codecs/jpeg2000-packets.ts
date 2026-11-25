import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import {
  be16,
  be32,
  type SizeMarker,
  type CodingStyle,
  type Quantization,
  parseSizeMarker,
  parseCodingStyle,
  parseQuantization,
  parseRoiShift,
} from './jpeg2000-metadata.ts'
import type { Jpeg2000Subband } from './jpeg2000-tier1.ts'

const maximumPackets = 4_194_304
const maximumCodeBlocks = 4_194_304

interface CodeBlockChunk {
  readonly start: number
  readonly end: number
  readonly codingPasses: number
}

interface PrecinctState {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
  inclusion?: InclusionTree
  zeroPlanes?: ValueTree
}

interface CodeBlock {
  readonly x: number
  readonly y: number
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
  readonly clippedX0: number
  readonly clippedY0: number
  readonly clippedX1: number
  readonly clippedY1: number
  readonly precinctIndex: number
  readonly precinct: PrecinctState
  readonly band: Jpeg2000Subband
  lblock: number
  included: boolean
  zeroBitPlanes: number
  readonly chunks: CodeBlockChunk[]
}

export interface Subband {
  readonly type: Jpeg2000Subband
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
  readonly blocks: readonly CodeBlock[]
}

interface Resolution {
  readonly level: number
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
  readonly precinctWidth: number
  readonly precinctHeight: number
  readonly precinctColumns: number
  readonly precinctRows: number
  readonly bands: readonly Subband[]
}

interface TileComponent {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
  readonly style: CodingStyle
  readonly quantization: Quantization
  readonly roiShift: number
  resolutions: readonly Resolution[]
}

export interface Tile {
  readonly index: number
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
  readonly components: readonly TileComponent[]
  readonly style: CodingStyle
  packets: readonly Packet[]
  nextPacket: number
  nextPart: number
  partCount?: number
}

interface Packet {
  readonly layer: number
  readonly resolution: number
  readonly component: number
  readonly precinct: number
  readonly positionX: number
  readonly positionY: number
  readonly blocks: readonly CodeBlock[]
}

export interface ParsedCodestream {
  readonly size: SizeMarker
  readonly tiles: readonly Tile[]
  readonly resolutionLevels: number
  readonly endOffset: number
}

const tileBounds = (
  size: SizeMarker,
  index: number,
): { x0: number; y0: number; x1: number; y1: number } => {
  const columns = Math.ceil((size.xSize - size.tileXOrigin) / size.tileWidth)
  const rows = Math.ceil((size.ySize - size.tileYOrigin) / size.tileHeight)
  if (index < 0 || index >= columns * rows)
    throw invalidInput(`JPEG 2000 tile index ${index} is invalid`)
  const column = index % columns
  const row = Math.floor(index / columns)
  return {
    x0: Math.max(size.xOrigin, size.tileXOrigin + column * size.tileWidth),
    y0: Math.max(size.yOrigin, size.tileYOrigin + row * size.tileHeight),
    x1: Math.min(size.xSize, size.tileXOrigin + (column + 1) * size.tileWidth),
    y1: Math.min(size.ySize, size.tileYOrigin + (row + 1) * size.tileHeight),
  }
}

const buildSubband = (
  type: Jpeg2000Subband,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  resolution: { precinctColumns: number; precinctWidth: number; precinctHeight: number },
  codeBlockWidthExponent: number,
  codeBlockHeightExponent: number,
  nonzeroResolution: boolean,
  blockCounter: { value: number },
): Subband => {
  const bandPrecinctWidth = resolution.precinctWidth >>> (nonzeroResolution ? 1 : 0)
  const bandPrecinctHeight = resolution.precinctHeight >>> (nonzeroResolution ? 1 : 0)
  if (bandPrecinctWidth < 1 || bandPrecinctHeight < 1) {
    throw invalidInput('JPEG 2000 precinct is too small for its resolution')
  }
  const blockWidth = 2 ** codeBlockWidthExponent
  const blockHeight = 2 ** codeBlockHeightExponent
  const firstBlockX = Math.floor(x0 / blockWidth)
  const firstBlockY = Math.floor(y0 / blockHeight)
  const lastBlockX = Math.ceil(x1 / blockWidth)
  const lastBlockY = Math.ceil(y1 / blockHeight)
  const precincts = new Map<number, PrecinctState>()
  const temporary: {
    x: number
    y: number
    x0: number
    y0: number
    x1: number
    y1: number
    clippedX0: number
    clippedY0: number
    clippedX1: number
    clippedY1: number
    precinctIndex: number
  }[] = []
  for (let blockY = firstBlockY; blockY < lastBlockY; blockY += 1) {
    for (let blockX = firstBlockX; blockX < lastBlockX; blockX += 1) {
      const clippedX0 = Math.max(x0, blockX * blockWidth)
      const clippedY0 = Math.max(y0, blockY * blockHeight)
      const clippedX1 = Math.min(x1, (blockX + 1) * blockWidth)
      const clippedY1 = Math.min(y1, (blockY + 1) * blockHeight)
      if (clippedX0 >= clippedX1 || clippedY0 >= clippedY1) continue
      const precinctX = Math.floor((clippedX0 - x0) / bandPrecinctWidth)
      const precinctY = Math.floor((clippedY0 - y0) / bandPrecinctHeight)
      const precinctIndex = precinctY * resolution.precinctColumns + precinctX
      temporary.push({
        x: blockX,
        y: blockY,
        x0: blockX * blockWidth,
        y0: blockY * blockHeight,
        x1: (blockX + 1) * blockWidth,
        y1: (blockY + 1) * blockHeight,
        clippedX0,
        clippedY0,
        clippedX1,
        clippedY1,
        precinctIndex,
      })
      const existing = precincts.get(precinctIndex)
      if (existing) {
        precincts.set(precinctIndex, {
          minX: Math.min(existing.minX, blockX),
          minY: Math.min(existing.minY, blockY),
          maxX: Math.max(existing.maxX, blockX),
          maxY: Math.max(existing.maxY, blockY),
        })
      } else {
        precincts.set(precinctIndex, { minX: blockX, minY: blockY, maxX: blockX, maxY: blockY })
      }
      blockCounter.value += 1
      if (blockCounter.value > maximumCodeBlocks)
        throw limitExceeded('JPEG 2000 code-block count exceeds limit')
    }
  }
  const blocks: CodeBlock[] = temporary.map((block) => {
    const precinct = precincts.get(block.precinctIndex)
    if (!precinct) throw invalidInput('JPEG 2000 code-block precinct is missing')
    return {
      ...block,
      precinct,
      band: type,
      lblock: 3,
      included: false,
      zeroBitPlanes: 0,
      chunks: [],
    }
  })
  return { type, x0, y0, x1, y1, blocks }
}

const buildResolutions = (
  component: Omit<TileComponent, 'resolutions'>,
  blockCounter: { value: number },
): readonly Resolution[] => {
  const levels = component.style.decompositionLevels
  const resolutions: Resolution[] = []
  for (let level = 0; level <= levels; level += 1) {
    const scale = 2 ** (levels - level)
    const x0 = Math.ceil(component.x0 / scale)
    const y0 = Math.ceil(component.y0 / scale)
    const x1 = Math.ceil(component.x1 / scale)
    const y1 = Math.ceil(component.y1 / scale)
    const precinct = component.style.precincts[level]
    if (!precinct) throw invalidInput('JPEG 2000 precinct size is missing')
    const precinctWidth = 2 ** precinct.x
    const precinctHeight = 2 ** precinct.y
    const precinctColumns =
      x1 > x0 ? Math.ceil(x1 / precinctWidth) - Math.floor(x0 / precinctWidth) : 0
    const precinctRows =
      y1 > y0 ? Math.ceil(y1 / precinctHeight) - Math.floor(y0 / precinctHeight) : 0
    const blockWidthExponent = Math.min(
      component.style.codeBlockWidthExponent,
      precinct.x - (level > 0 ? 1 : 0),
    )
    const blockHeightExponent = Math.min(
      component.style.codeBlockHeightExponent,
      precinct.y - (level > 0 ? 1 : 0),
    )
    if (blockWidthExponent < 0 || blockHeightExponent < 0) {
      throw invalidInput('JPEG 2000 code-block exponent is incompatible with precinct size')
    }
    const geometry = { precinctColumns, precinctWidth, precinctHeight }
    const bands: Subband[] = []
    if (level === 0) {
      bands.push(
        buildSubband(
          'LL',
          x0,
          y0,
          x1,
          y1,
          geometry,
          blockWidthExponent,
          blockHeightExponent,
          false,
          blockCounter,
        ),
      )
    } else {
      const bandScale = 2 ** (levels - level + 1)
      bands.push(
        buildSubband(
          'HL',
          Math.ceil(component.x0 / bandScale - 0.5),
          Math.ceil(component.y0 / bandScale),
          Math.ceil(component.x1 / bandScale - 0.5),
          Math.ceil(component.y1 / bandScale),
          geometry,
          blockWidthExponent,
          blockHeightExponent,
          true,
          blockCounter,
        ),
        buildSubband(
          'LH',
          Math.ceil(component.x0 / bandScale),
          Math.ceil(component.y0 / bandScale - 0.5),
          Math.ceil(component.x1 / bandScale),
          Math.ceil(component.y1 / bandScale - 0.5),
          geometry,
          blockWidthExponent,
          blockHeightExponent,
          true,
          blockCounter,
        ),
        buildSubband(
          'HH',
          Math.ceil(component.x0 / bandScale - 0.5),
          Math.ceil(component.y0 / bandScale - 0.5),
          Math.ceil(component.x1 / bandScale - 0.5),
          Math.ceil(component.y1 / bandScale - 0.5),
          geometry,
          blockWidthExponent,
          blockHeightExponent,
          true,
          blockCounter,
        ),
      )
    }
    resolutions.push({
      level,
      x0,
      y0,
      x1,
      y1,
      precinctWidth,
      precinctHeight,
      precinctColumns,
      precinctRows,
      bands,
    })
  }
  return resolutions
}

const comparePackets =
  (progression: number) =>
  (left: Packet, right: Packet): number => {
    const compare = (a: number, b: number): number => a - b
    if (progression === 0) {
      return (
        compare(left.layer, right.layer) ||
        compare(left.resolution, right.resolution) ||
        compare(left.component, right.component) ||
        compare(left.positionY, right.positionY) ||
        compare(left.positionX, right.positionX)
      )
    }
    if (progression === 1) {
      return (
        compare(left.resolution, right.resolution) ||
        compare(left.layer, right.layer) ||
        compare(left.component, right.component) ||
        compare(left.positionY, right.positionY) ||
        compare(left.positionX, right.positionX)
      )
    }
    if (progression === 2) {
      return (
        compare(left.resolution, right.resolution) ||
        compare(left.positionY, right.positionY) ||
        compare(left.positionX, right.positionX) ||
        compare(left.component, right.component) ||
        compare(left.layer, right.layer)
      )
    }
    if (progression === 3) {
      return (
        compare(left.positionY, right.positionY) ||
        compare(left.positionX, right.positionX) ||
        compare(left.component, right.component) ||
        compare(left.resolution, right.resolution) ||
        compare(left.layer, right.layer)
      )
    }
    return (
      compare(left.component, right.component) ||
      compare(left.positionY, right.positionY) ||
      compare(left.positionX, right.positionX) ||
      compare(left.resolution, right.resolution) ||
      compare(left.layer, right.layer)
    )
  }

const buildPackets = (tile: Tile, size: SizeMarker): readonly Packet[] => {
  const packets: Packet[] = []
  for (let componentIndex = 0; componentIndex < tile.components.length; componentIndex += 1) {
    const component = tile.components[componentIndex]
    const sampling = size.components[componentIndex]
    if (!component || !sampling) throw invalidInput('JPEG 2000 tile component is missing')
    const levels = component.style.decompositionLevels
    for (const resolution of component.resolutions) {
      const scale = 2 ** (levels - resolution.level)
      const firstPrecinctX = Math.floor(resolution.x0 / resolution.precinctWidth)
      const firstPrecinctY = Math.floor(resolution.y0 / resolution.precinctHeight)
      for (let precinctY = 0; precinctY < resolution.precinctRows; precinctY += 1) {
        for (let precinctX = 0; precinctX < resolution.precinctColumns; precinctX += 1) {
          const precinct = precinctY * resolution.precinctColumns + precinctX
          const blocks: CodeBlock[] = []
          for (const band of resolution.bands) {
            for (const block of band.blocks) {
              if (block.precinctIndex === precinct) blocks.push(block)
            }
          }
          const positionX =
            (firstPrecinctX + precinctX) * resolution.precinctWidth * scale * sampling.xSampling
          const positionY =
            (firstPrecinctY + precinctY) * resolution.precinctHeight * scale * sampling.ySampling
          for (let layer = 0; layer < component.style.layers; layer += 1) {
            packets.push({
              layer,
              resolution: resolution.level,
              component: componentIndex,
              precinct,
              positionX,
              positionY,
              blocks,
            })
            if (packets.length > maximumPackets)
              throw limitExceeded('JPEG 2000 packet count exceeds limit')
          }
        }
      }
    }
  }
  packets.sort(comparePackets(tile.style.progression))
  return packets
}

const createTile = (options: {
  readonly index: number
  readonly size: SizeMarker
  readonly defaultStyle: CodingStyle
  readonly componentStyles: ReadonlyMap<number, CodingStyle>
  readonly defaultQuantization: Quantization
  readonly componentRoiShifts: ReadonlyMap<number, number>
  readonly componentQuantizations: ReadonlyMap<number, Quantization>
  readonly blockCounter: { value: number }
}): Tile => {
  const bounds = tileBounds(options.size, options.index)
  const components: TileComponent[] = []
  for (let index = 0; index < options.size.components.length; index += 1) {
    const specification = options.size.components[index]
    if (!specification) throw invalidInput('JPEG 2000 component specification is missing')
    const style = options.componentStyles.get(index) ?? options.defaultStyle
    const quantization = options.componentQuantizations.get(index) ?? options.defaultQuantization
    const component: TileComponent = {
      x0: Math.ceil(bounds.x0 / specification.xSampling),
      y0: Math.ceil(bounds.y0 / specification.ySampling),
      x1: Math.ceil(bounds.x1 / specification.xSampling),
      y1: Math.ceil(bounds.y1 / specification.ySampling),
      style,
      quantization,
      roiShift: options.componentRoiShifts.get(index) ?? 0,
      resolutions: [],
    }
    component.resolutions = buildResolutions(component, options.blockCounter)
    components.push(component)
  }
  const tile: Tile = {
    index: options.index,
    ...bounds,
    components,
    style: options.defaultStyle,
    packets: [],
    nextPacket: 0,
    nextPart: 0,
  }
  tile.packets = buildPackets(tile, options.size)
  return tile
}

interface TreeLevel {
  readonly width: number
  readonly values: Uint16Array
  cursor: number
}

class ValueTree {
  readonly #levels: TreeLevel[] = []
  #level = 0
  value = 0

  constructor(width: number, height: number) {
    while (true) {
      this.#levels.push({ width, values: new Uint16Array(width * height), cursor: 0 })
      if (width === 1 && height === 1) break
      width = Math.ceil(width / 2)
      height = Math.ceil(height / 2)
    }
  }

  reset(x: number, y: number): void {
    let value = 0
    let found = this.#levels.length
    for (let levelIndex = 0; levelIndex < this.#levels.length; levelIndex += 1) {
      const level = this.#levels[levelIndex]
      if (!level) throw invalidInput('JPEG 2000 tag tree level is missing')
      const cursor = y * level.width + x
      level.cursor = cursor
      const stored = level.values[cursor] ?? 0
      if (stored !== 0) {
        value = stored - 1
        found = levelIndex
        break
      }
      x >>>= 1
      y >>>= 1
    }
    this.#level = Math.max(0, found - 1)
    const level = this.#levels[this.#level]
    if (!level) throw invalidInput('JPEG 2000 tag tree is empty')
    level.values[level.cursor] = value + 1
    this.value = value
  }

  increment(): void {
    const level = this.#levels[this.#level]
    if (!level) throw invalidInput('JPEG 2000 tag tree state is invalid')
    const value = (level.values[level.cursor] ?? 1) + 1
    level.values[level.cursor] = value
    this.value = value - 1
  }

  descend(): boolean {
    const level = this.#levels[this.#level]
    if (!level) throw invalidInput('JPEG 2000 tag tree state is invalid')
    const value = level.values[level.cursor] ?? 1
    this.#level -= 1
    if (this.#level < 0) {
      this.value = value - 1
      return false
    }
    const next = this.#levels[this.#level]
    if (!next) throw invalidInput('JPEG 2000 tag tree state is invalid')
    next.values[next.cursor] = value
    return true
  }
}

class InclusionTree {
  readonly #levels: TreeLevel[] = []
  #level = 0

  constructor(width: number, height: number, initial: number) {
    while (true) {
      const values = new Uint16Array(width * height)
      values.fill(initial + 1)
      this.#levels.push({ width, values, cursor: 0 })
      if (width === 1 && height === 1) break
      width = Math.ceil(width / 2)
      height = Math.ceil(height / 2)
    }
  }

  reset(x: number, y: number, threshold: number): boolean {
    for (let levelIndex = 0; levelIndex < this.#levels.length; levelIndex += 1) {
      const level = this.#levels[levelIndex]
      if (!level) throw invalidInput('JPEG 2000 inclusion tree level is missing')
      const cursor = y * level.width + x
      level.cursor = cursor
      const stored = level.values[cursor]
      if (stored === 0xffff) {
        this.#level = levelIndex - 1
        return true
      }
      if ((stored ?? 0) - 1 > threshold) {
        this.#level = levelIndex
        this.#propagate()
        return false
      }
      x >>>= 1
      y >>>= 1
    }
    this.#level = this.#levels.length - 1
    return true
  }

  exclude(threshold: number): void {
    const level = this.#levels[this.#level]
    if (!level) throw invalidInput('JPEG 2000 inclusion tree state is invalid')
    level.values[level.cursor] = threshold + 2
    this.#propagate()
  }

  #propagate(): void {
    const source = this.#levels[this.#level]
    if (!source) throw invalidInput('JPEG 2000 inclusion tree state is invalid')
    const value = source.values[source.cursor] ?? 0
    for (let levelIndex = this.#level - 1; levelIndex >= 0; levelIndex -= 1) {
      const level = this.#levels[levelIndex]
      if (level) level.values[level.cursor] = value
    }
  }

  descend(): boolean {
    const level = this.#levels[this.#level]
    if (!level) throw invalidInput('JPEG 2000 inclusion tree state is invalid')
    const value = level.values[level.cursor] ?? 0
    level.values[level.cursor] = 0xffff
    this.#level -= 1
    if (this.#level < 0) return false
    const next = this.#levels[this.#level]
    if (!next) throw invalidInput('JPEG 2000 inclusion tree state is invalid')
    next.values[next.cursor] = value
    return true
  }
}

class PacketBitReader {
  readonly #data: Uint8Array
  readonly #end: number
  #position: number
  #buffer = 0
  #bits = 0
  #stuffed = false

  constructor(data: Uint8Array, start: number, end: number) {
    this.#data = data
    this.#position = start
    this.#end = end
  }

  get position(): number {
    return this.#position
  }

  read(count: number): number {
    if (count < 0 || count > 31) throw invalidInput('JPEG 2000 packet bit count is invalid')
    while (this.#bits < count) {
      const value = this.#data[this.#position]
      if (value === undefined || this.#position >= this.#end) {
        throw truncatedInput('JPEG 2000 packet header exceeds its tile-part')
      }
      this.#position += 1
      if (this.#stuffed) {
        if ((value & 0x80) !== 0) throw invalidInput('JPEG 2000 packet stuffing bit is not zero')
        this.#buffer = this.#buffer * 128 + value
        this.#bits += 7
      } else {
        this.#buffer = this.#buffer * 256 + value
        this.#bits += 8
      }
      this.#stuffed = value === 0xff
      if (this.#bits > 48) throw invalidInput('JPEG 2000 packet bit buffer overflow')
    }
    this.#bits -= count
    const divisor = 2 ** this.#bits
    const value = Math.floor(this.#buffer / divisor) % 2 ** count
    this.#buffer %= divisor
    return value
  }

  align(): void {
    this.#buffer = 0
    this.#bits = 0
    this.#stuffed = false
  }

  skip(bytes: number): void {
    if (this.#bits !== 0) throw invalidInput('JPEG 2000 packet reader is not byte aligned')
    if (this.#position + bytes > this.#end)
      throw truncatedInput('JPEG 2000 packet marker is truncated')
    this.#position += bytes
  }

  byte(offset = 0): number | undefined {
    return this.#data[this.#position + offset]
  }
}

const codingPassCount = (bits: PacketBitReader): number => {
  if (bits.read(1) === 0) return 1
  if (bits.read(1) === 0) return 2
  const short = bits.read(2)
  if (short < 3) return short + 3
  const medium = bits.read(5)
  if (medium < 31) return medium + 6
  return bits.read(7) + 37
}

const floorLog2 = (value: number): number => {
  if (value < 1) throw invalidInput('JPEG 2000 logarithm input is invalid')
  return Math.floor(Math.log2(value))
}

const parsePacketData = (data: Uint8Array, start: number, end: number, tile: Tile): number => {
  const bits = new PacketBitReader(data, start, end)
  while (tile.nextPacket < tile.packets.length && bits.position < end) {
    bits.align()
    if (tile.style.sop) {
      if (bits.byte() !== 0xff || bits.byte(1) !== 0x91) {
        throw invalidInput('JPEG 2000 SOP marker is missing')
      }
      if (bits.byte(2) !== 0 || bits.byte(3) !== 4) {
        throw invalidInput('JPEG 2000 SOP marker length is invalid')
      }
      bits.skip(6)
    }
    const packet = tile.packets[tile.nextPacket]
    if (!packet) throw invalidInput('JPEG 2000 packet sequence is invalid')
    tile.nextPacket += 1
    if (bits.read(1) === 0) continue
    const contributions: { block: CodeBlock; length: number; codingPasses: number }[] = []
    for (const block of packet.blocks) {
      const blockX = block.x - block.precinct.minX
      const blockY = block.y - block.precinct.minY
      let included = false
      let first = false
      if (block.included) {
        included = bits.read(1) === 1
      } else {
        const width = block.precinct.maxX - block.precinct.minX + 1
        const height = block.precinct.maxY - block.precinct.minY + 1
        block.precinct.inclusion ??= new InclusionTree(width, height, packet.layer)
        block.precinct.zeroPlanes ??= new ValueTree(width, height)
        const tree = block.precinct.inclusion
        if (tree.reset(blockX, blockY, packet.layer)) {
          while (true) {
            if (bits.read(1) === 1) {
              if (!tree.descend()) {
                block.included = true
                included = true
                first = true
                break
              }
            } else {
              tree.exclude(packet.layer)
              break
            }
          }
        }
      }
      if (!included) continue
      if (first) {
        const zeroTree = block.precinct.zeroPlanes
        if (!zeroTree) throw invalidInput('JPEG 2000 zero-plane tree is missing')
        zeroTree.reset(blockX, blockY)
        while (true) {
          if (bits.read(1) === 1) {
            if (!zeroTree.descend()) break
          } else {
            zeroTree.increment()
          }
        }
        block.zeroBitPlanes = zeroTree.value
      }
      const passes = codingPassCount(bits)
      while (bits.read(1) === 1) {
        block.lblock += 1
        if (block.lblock > 31) throw limitExceeded('JPEG 2000 Lblock exceeds safe packet length')
      }
      const lengthBits = block.lblock + floorLog2(passes)
      const length = bits.read(lengthBits)
      if (length < 1) throw invalidInput('JPEG 2000 code-block contribution is empty')
      contributions.push({ block, length, codingPasses: passes })
    }
    bits.align()
    if (tile.style.eph) {
      if (bits.byte() !== 0xff || bits.byte(1) !== 0x92) {
        throw invalidInput('JPEG 2000 EPH marker is missing')
      }
      bits.skip(2)
    }
    for (const contribution of contributions) {
      const chunkStart = bits.position
      const chunkEnd = chunkStart + contribution.length
      if (chunkEnd > end) throw truncatedInput('JPEG 2000 code-block data exceeds tile-part')
      contribution.block.chunks.push({
        start: chunkStart,
        end: chunkEnd,
        codingPasses: contribution.codingPasses,
      })
      bits.skip(contribution.length)
    }
  }
  return bits.position
}

const segmentPayload = (
  data: Uint8Array,
  markerStart: number,
  limit: number,
): { payload: Uint8Array; end: number } => {
  if (markerStart + 4 > limit) throw truncatedInput('JPEG 2000 marker segment is truncated')
  const length = be16(data, markerStart + 2, 'JPEG 2000 marker length')
  if (length < 2) throw invalidInput('JPEG 2000 marker length is invalid')
  const end = markerStart + 2 + length
  if (end > limit) throw truncatedInput('JPEG 2000 marker segment exceeds its containing extent')
  return { payload: data.subarray(markerStart + 4, end), end }
}

export const parseCodestream = (
  data: Uint8Array,
  limits: ImageLimits,
  options: { readonly allowTrailingBytes?: boolean } = {},
): ParsedCodestream => {
  if (data.byteLength < 6 || be16(data, 0) !== 0xff4f) {
    throw invalidInput('JPEG 2000 SOC marker is missing')
  }
  let position = 2
  let size: SizeMarker | undefined
  let defaultStyle: CodingStyle | undefined
  let defaultQuantization: Quantization | undefined
  const componentRoiShifts = new Map<number, number>()
  const componentStyles = new Map<number, CodingStyle>()
  const componentQuantizations = new Map<number, Quantization>()
  const tiles = new Map<number, Tile>()
  const blockCounter = { value: 0 }
  let sawEnd = false

  while (position + 2 <= data.byteLength) {
    const marker = be16(data, position, 'JPEG 2000 marker')
    if (marker === 0xffd9) {
      position += 2
      sawEnd = true
      break
    }
    if (marker === 0xff51) {
      if (size) throw invalidInput('JPEG 2000 contains duplicate SIZ markers')
      const segment = segmentPayload(data, position, data.byteLength)
      size = parseSizeMarker(segment.payload, limits)
      position = segment.end
      continue
    }
    if (marker === 0xff52) {
      if (!size) throw invalidInput('JPEG 2000 COD precedes SIZ')
      if (defaultStyle) throw invalidInput('JPEG 2000 contains duplicate main COD markers')
      const segment = segmentPayload(data, position, data.byteLength)
      defaultStyle = parseCodingStyle(
        segment.payload,
        false,
        size.components.length < 257 ? 1 : 2,
        undefined,
      ).style
      position = segment.end
      continue
    }
    if (marker === 0xff53) {
      if (!size || !defaultStyle) throw invalidInput('JPEG 2000 COC precedes SIZ or COD')
      const segment = segmentPayload(data, position, data.byteLength)
      const parsed = parseCodingStyle(
        segment.payload,
        true,
        size.components.length < 257 ? 1 : 2,
        defaultStyle,
      )
      if (parsed.component === undefined || parsed.component >= size.components.length) {
        throw invalidInput('JPEG 2000 COC component index is invalid')
      }
      if (componentStyles.has(parsed.component))
        throw invalidInput('JPEG 2000 duplicate main COC marker')
      componentStyles.set(parsed.component, parsed.style)
      position = segment.end
      continue
    }
    if (marker === 0xff5c) {
      if (defaultQuantization) throw invalidInput('JPEG 2000 contains duplicate main QCD markers')
      const segment = segmentPayload(data, position, data.byteLength)
      defaultQuantization = parseQuantization(segment.payload, 0).quantization
      position = segment.end
      continue
    }
    if (marker === 0xff5d) {
      if (!size) throw invalidInput('JPEG 2000 QCC precedes SIZ')
      const segment = segmentPayload(data, position, data.byteLength)
      const parsed = parseQuantization(segment.payload, size.components.length < 257 ? 1 : 2)
      if (parsed.component === undefined || parsed.component >= size.components.length) {
        throw invalidInput('JPEG 2000 QCC component index is invalid')
      }
      if (componentQuantizations.has(parsed.component)) {
        throw invalidInput('JPEG 2000 duplicate main QCC marker')
      }
      componentQuantizations.set(parsed.component, parsed.quantization)
      position = segment.end
      continue
    }
    if (marker === 0xff5e) {
      if (!size) throw invalidInput('JPEG 2000 RGN precedes SIZ')
      const segment = segmentPayload(data, position, data.byteLength)
      const parsed = parseRoiShift(segment.payload, size.components.length < 257 ? 1 : 2)
      if (parsed.component >= size.components.length) {
        throw invalidInput('JPEG 2000 RGN component index is invalid')
      }
      if (componentRoiShifts.has(parsed.component)) {
        throw invalidInput('JPEG 2000 duplicate main RGN marker')
      }
      componentRoiShifts.set(parsed.component, parsed.shift)
      position = segment.end
      continue
    }
    if (marker === 0xff90) {
      if (!size || !defaultStyle || !defaultQuantization) {
        throw invalidInput('JPEG 2000 tile-part precedes required main-header markers')
      }
      const segment = segmentPayload(data, position, data.byteLength)
      if (segment.payload.byteLength !== 8)
        throw invalidInput('JPEG 2000 SOT marker length is invalid')
      const tileIndex = be16(segment.payload, 0, 'JPEG 2000 tile index')
      const tilePartLength = be32(segment.payload, 2, 'JPEG 2000 tile-part length')
      const partIndex = segment.payload[6]
      const partCount = segment.payload[7]
      if (partIndex === undefined || partCount === undefined) {
        throw truncatedInput('JPEG 2000 tile-part index is truncated')
      }
      if (partCount !== 0 && (partCount < 1 || partIndex >= partCount)) {
        throw invalidInput('JPEG 2000 tile-part index exceeds its declared count')
      }
      if (tilePartLength === 0) {
        throw unsupportedOperation('JPEG 2000 open-ended tile-parts are unsupported')
      }
      const tileEnd = position + tilePartLength
      if (tileEnd > data.byteLength || tileEnd <= segment.end) {
        throw truncatedInput('JPEG 2000 tile-part extent is invalid')
      }
      let tileStyle = defaultStyle
      let tileQuantization = defaultQuantization
      const tileComponentStyles = new Map(componentStyles)
      const tileComponentRoiShifts = new Map(componentRoiShifts)
      const tileComponentQuantizations = new Map(componentQuantizations)
      let headerPosition = segment.end
      let sawData = false
      const existingTile = tiles.get(tileIndex)
      if (partIndex !== (existingTile?.nextPart ?? 0)) {
        throw invalidInput(`JPEG 2000 tile ${tileIndex} part ${partIndex} is out of order`)
      }
      if (
        existingTile?.partCount !== undefined &&
        partCount !== 0 &&
        existingTile.partCount !== partCount
      ) {
        throw invalidInput(`JPEG 2000 tile ${tileIndex} changes its tile-part count`)
      }
      while (headerPosition + 2 <= tileEnd) {
        const tileMarker = be16(data, headerPosition, 'JPEG 2000 tile marker')
        if (tileMarker === 0xff93) {
          headerPosition += 2
          sawData = true
          break
        }
        const tileSegment = segmentPayload(data, headerPosition, tileEnd)
        if (partIndex > 0 && tileMarker !== 0xff58 && tileMarker !== 0xff64) {
          throw unsupportedOperation(
            `JPEG 2000 later tile-part marker 0x${tileMarker.toString(16)} is unsupported`,
          )
        }
        if (tileMarker === 0xff52) {
          tileStyle = parseCodingStyle(
            tileSegment.payload,
            false,
            size.components.length < 257 ? 1 : 2,
            undefined,
          ).style
        } else if (tileMarker === 0xff53) {
          const parsed = parseCodingStyle(
            tileSegment.payload,
            true,
            size.components.length < 257 ? 1 : 2,
            tileStyle,
          )
          if (parsed.component === undefined || parsed.component >= size.components.length) {
            throw invalidInput('JPEG 2000 tile COC component index is invalid')
          }
          tileComponentStyles.set(parsed.component, parsed.style)
        } else if (tileMarker === 0xff5c) {
          tileQuantization = parseQuantization(tileSegment.payload, 0).quantization
        } else if (tileMarker === 0xff5d) {
          const parsed = parseQuantization(
            tileSegment.payload,
            size.components.length < 257 ? 1 : 2,
          )
          if (parsed.component === undefined || parsed.component >= size.components.length) {
            throw invalidInput('JPEG 2000 tile QCC component index is invalid')
          }
          tileComponentQuantizations.set(parsed.component, parsed.quantization)
        } else if (tileMarker === 0xff5e) {
          const parsed = parseRoiShift(tileSegment.payload, size.components.length < 257 ? 1 : 2)
          if (parsed.component >= size.components.length) {
            throw invalidInput('JPEG 2000 tile RGN component index is invalid')
          }
          tileComponentRoiShifts.set(parsed.component, parsed.shift)
        } else if (tileMarker === 0xff64) {
          // COM is bounded opaque metadata and does not alter reconstruction.
        } else if (tileMarker === 0xff58) {
          throw unsupportedOperation('JPEG 2000 PLT packet-length markers are unsupported')
        } else {
          throw unsupportedOperation(
            `JPEG 2000 tile marker 0x${tileMarker.toString(16)} is unsupported`,
          )
        }
        headerPosition = tileSegment.end
      }
      if (!sawData) throw invalidInput('JPEG 2000 SOD marker is missing')
      const tile =
        existingTile ??
        createTile({
          index: tileIndex,
          size,
          defaultStyle: tileStyle,
          componentStyles: tileComponentStyles,
          defaultQuantization: tileQuantization,
          componentQuantizations: tileComponentQuantizations,
          componentRoiShifts: tileComponentRoiShifts,
          blockCounter,
        })
      if (partCount !== 0) tile.partCount = partCount
      const consumed = parsePacketData(data, headerPosition, tileEnd, tile)
      if (consumed !== tileEnd) {
        throw invalidInput(`JPEG 2000 tile ${tileIndex} has unconsumed packet data`)
      }
      tile.nextPart += 1
      if (tile.partCount !== undefined && tile.nextPart === tile.partCount) {
        if (tile.nextPacket !== tile.packets.length) {
          throw truncatedInput(
            `JPEG 2000 tile ${tileIndex} contains ${tile.nextPacket} of ${tile.packets.length} packets`,
          )
        }
      }
      tiles.set(tileIndex, tile)
      position = tileEnd
      continue
    }
    if (marker === 0xff64) {
      const segment = segmentPayload(data, position, data.byteLength)
      position = segment.end
      continue
    }
    if (
      marker === 0xff55 ||
      marker === 0xff57 ||
      marker === 0xff5f ||
      marker === 0xff60 ||
      marker === 0xff61
    ) {
      throw unsupportedOperation(`JPEG 2000 marker 0x${marker.toString(16)} is not implemented`)
    }
    throw unsupportedOperation(`JPEG 2000 marker 0x${marker.toString(16)} is unsupported`)
  }
  if (!sawEnd) throw truncatedInput('JPEG 2000 EOC marker is missing')
  if (options.allowTrailingBytes !== true && position !== data.byteLength) {
    throw invalidInput('JPEG 2000 data follows EOC')
  }
  if (!size || !defaultStyle || !defaultQuantization) {
    throw invalidInput('JPEG 2000 main header is incomplete')
  }
  const expectedTiles =
    Math.ceil((size.xSize - size.tileXOrigin) / size.tileWidth) *
    Math.ceil((size.ySize - size.tileYOrigin) / size.tileHeight)
  if (tiles.size !== expectedTiles) {
    throw invalidInput(`JPEG 2000 contains ${tiles.size} of ${expectedTiles} required tiles`)
  }
  for (const tile of tiles.values()) {
    if (tile.partCount !== undefined && tile.nextPart !== tile.partCount) {
      throw truncatedInput(
        `JPEG 2000 tile ${tile.index} contains ${tile.nextPart} of ${tile.partCount} tile-parts`,
      )
    }
    if (tile.nextPacket !== tile.packets.length) {
      throw truncatedInput(
        `JPEG 2000 tile ${tile.index} contains ${tile.nextPacket} of ${tile.packets.length} packets`,
      )
    }
  }
  return {
    size,
    tiles: [...tiles.values()].sort((left, right) => left.index - right.index),
    resolutionLevels:
      1 +
      Math.max(
        ...[...tiles.values()].flatMap((tile) =>
          tile.components.map((component) => component.style.decompositionLevels),
        ),
      ),
    endOffset: position,
  }
}
