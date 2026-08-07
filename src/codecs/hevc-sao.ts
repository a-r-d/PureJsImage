import { invalidInput } from '../errors.ts'

export interface HevcSaoComponent {
  readonly bandPosition: number
  readonly edgeClass: number
  readonly offsets: readonly [number, number, number, number, number]
  readonly type: 0 | 1 | 2
}

export interface HevcSaoCtb {
  readonly components: readonly [HevcSaoComponent, HevcSaoComponent, HevcSaoComponent]
}

const EDGE_DIRECTIONS = [
  [-1, 0, 1, 0],
  [0, -1, 0, 1],
  [-1, -1, 1, 1],
  [1, -1, -1, 1],
] as const

const sign = (value: number): number => (value < 0 ? -1 : value > 0 ? 1 : 0)

export const applyHevcSao = (
  input: Uint16Array,
  width: number,
  height: number,
  bitDepth: 8 | 10,
  ctbWidth: number,
  ctbHeight: number,
  ctbSize: number,
  component: 0 | 1 | 2,
  parameters: readonly HevcSaoCtb[],
): Uint16Array => {
  if (
    width < 1 ||
    height < 1 ||
    input.length !== width * height ||
    ctbWidth < 1 ||
    ctbHeight < 1 ||
    parameters.length !== ctbWidth * ctbHeight ||
    ctbSize < 1
  ) {
    throw invalidInput('HEVC SAO geometry is invalid')
  }
  const maximum = (1 << bitDepth) - 1
  const output = input.slice()
  for (let ctbY = 0; ctbY < ctbHeight; ctbY += 1) {
    for (let ctbX = 0; ctbX < ctbWidth; ctbX += 1) {
      const ctb = parameters[ctbY * ctbWidth + ctbX]
      const sao = ctb?.components[component]
      if (!sao || sao.type === 0) continue
      const startX = ctbX * ctbSize
      const startY = ctbY * ctbSize
      const endX = Math.min(width, startX + ctbSize)
      const endY = Math.min(height, startY + ctbSize)
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const index = y * width + x
          const value = input[index]
          if (value === undefined) throw invalidInput('HEVC SAO sample is unavailable')
          let offsetIndex = 0
          if (sao.type === 1) {
            const band = value >> (bitDepth - 5)
            const displacement = (band - sao.bandPosition + 32) & 31
            if (displacement < 4) offsetIndex = displacement + 1
          } else {
            const direction = EDGE_DIRECTIONS[sao.edgeClass]
            if (!direction) throw invalidInput('HEVC SAO edge class is invalid')
            const firstX = x + direction[0]
            const firstY = y + direction[1]
            const secondX = x + direction[2]
            const secondY = y + direction[3]
            if (
              firstX >= 0 &&
              firstY >= 0 &&
              firstX < width &&
              firstY < height &&
              secondX >= 0 &&
              secondY >= 0 &&
              secondX < width &&
              secondY < height
            ) {
              const first = input[firstY * width + firstX]
              const second = input[secondY * width + secondX]
              if (first === undefined || second === undefined) {
                throw invalidInput('HEVC SAO neighbour is unavailable')
              }
              const edge = 2 + sign(value - first) + sign(value - second)
              offsetIndex = edge === 2 ? 0 : edge < 2 ? edge + 1 : edge
            }
          }
          const offset = sao.offsets[offsetIndex]
          if (offset === undefined) throw invalidInput('HEVC SAO offset is unavailable')
          output[index] = Math.max(0, Math.min(maximum, value + offset))
        }
      }
    }
  }
  return output
}
