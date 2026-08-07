import { invalidInput } from '../errors.ts'

const BETA = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
  20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64,
] as const

const TC = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3,
  3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22, 24,
] as const

export interface HevcDeblockEdges {
  readonly heightIn4x4: number
  readonly horizontal: Uint8Array
  readonly vertical: Uint8Array
  readonly widthIn4x4: number
}

export interface HevcDeblockOptions {
  readonly betaOffset: number
  readonly bitDepth: 8 | 10
  readonly cbQpOffset: number
  readonly crQpOffset: number
  readonly qp: number
  readonly tcOffset: number
}

const clip = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value))

const planeSample = (plane: Uint16Array, width: number, x: number, y: number): number => {
  const value = plane[y * width + x]
  if (value === undefined) throw invalidInput('HEVC deblocking sample is unavailable')
  return value
}

const setPlaneSample = (
  plane: Uint16Array,
  width: number,
  x: number,
  y: number,
  value: number,
): void => {
  plane[y * width + x] = value
}

const chromaQp = (input: number): number => {
  if (input < 30) return input
  if (input <= 43)
    return [29, 30, 31, 32, 33, 33, 34, 34, 35, 35, 36, 36, 37, 37][input - 30] ?? input
  return input - 6
}

type Direction = 'horizontal' | 'vertical'

const coordinates = (
  edgeX: number,
  edgeY: number,
  direction: Direction,
  side: 'p' | 'q',
  distance: number,
  along: number,
): readonly [number, number] => {
  const signedDistance = side === 'p' ? -distance - 1 : distance
  return direction === 'vertical'
    ? [edgeX + signedDistance, edgeY + along]
    : [edgeX + along, edgeY + signedDistance]
}

const filterLumaEdge = (
  plane: Uint16Array,
  width: number,
  edgeX: number,
  edgeY: number,
  direction: Direction,
  beta: number,
  tc: number,
  maximum: number,
): void => {
  const read = (side: 'p' | 'q', distance: number, along: number): number => {
    const [x, y] = coordinates(edgeX, edgeY, direction, side, distance, along)
    return planeSample(plane, width, x, y)
  }
  const secondDifference = (side: 'p' | 'q', along: number): number =>
    Math.abs(read(side, 2, along) - 2 * read(side, 1, along) + read(side, 0, along))
  const dp0 = secondDifference('p', 0)
  const dp3 = secondDifference('p', 3)
  const dq0 = secondDifference('q', 0)
  const dq3 = secondDifference('q', 3)
  const dpq0 = dp0 + dq0
  const dpq3 = dp3 + dq3
  if (dpq0 + dpq3 >= beta) return
  const strongDecision = (along: number, dpq: number): boolean =>
    2 * dpq < beta >> 2 &&
    Math.abs(read('p', 3, along) - read('p', 0, along)) +
      Math.abs(read('q', 0, along) - read('q', 3, along)) <
      beta >> 3 &&
    Math.abs(read('p', 0, along) - read('q', 0, along)) < (5 * tc + 1) >> 1
  const strong = strongDecision(0, dpq0) && strongDecision(3, dpq3)
  const filterP1 = dp0 + dp3 < (beta + (beta >> 1)) >> 3
  const filterQ1 = dq0 + dq3 < (beta + (beta >> 1)) >> 3

  for (let along = 0; along < 4; along += 1) {
    const p = [0, 1, 2, 3].map((distance) => read('p', distance, along))
    const q = [0, 1, 2, 3].map((distance) => read('q', distance, along))
    const p0 = p[0] ?? 0
    const p1 = p[1] ?? 0
    const p2 = p[2] ?? 0
    const p3 = p[3] ?? 0
    const q0 = q[0] ?? 0
    const q1 = q[1] ?? 0
    const q2 = q[2] ?? 0
    const q3 = q[3] ?? 0
    const replacements: readonly (readonly [number, number])[] = strong
      ? [
          [0, clip((p2 + 2 * p1 + 2 * p0 + 2 * q0 + q1 + 4) >> 3, p0 - 2 * tc, p0 + 2 * tc)],
          [1, clip((p2 + p1 + p0 + q0 + 2) >> 2, p1 - 2 * tc, p1 + 2 * tc)],
          [2, clip((2 * p3 + 3 * p2 + p1 + p0 + q0 + 4) >> 3, p2 - 2 * tc, p2 + 2 * tc)],
        ]
      : []
    const qReplacements: readonly (readonly [number, number])[] = strong
      ? [
          [0, clip((p1 + 2 * p0 + 2 * q0 + 2 * q1 + q2 + 4) >> 3, q0 - 2 * tc, q0 + 2 * tc)],
          [1, clip((p0 + q0 + q1 + q2 + 2) >> 2, q1 - 2 * tc, q1 + 2 * tc)],
          [2, clip((p0 + q0 + q1 + 3 * q2 + 2 * q3 + 4) >> 3, q2 - 2 * tc, q2 + 2 * tc)],
        ]
      : []
    if (!strong) {
      let delta = (9 * (q0 - p0) - 3 * (q1 - p1) + 8) >> 4
      if (Math.abs(delta) >= tc * 10) continue
      delta = clip(delta, -tc, tc)
      const mutableP: (readonly [number, number])[] = [[0, clip(p0 + delta, 0, maximum)]]
      const mutableQ: (readonly [number, number])[] = [[0, clip(q0 - delta, 0, maximum)]]
      if (filterP1) {
        const deltaP = clip((((p2 + p0 + 1) >> 1) - p1 + delta) >> 1, -(tc >> 1), tc >> 1)
        mutableP.push([1, clip(p1 + deltaP, 0, maximum)])
      }
      if (filterQ1) {
        const deltaQ = clip((((q2 + q0 + 1) >> 1) - q1 - delta) >> 1, -(tc >> 1), tc >> 1)
        mutableQ.push([1, clip(q1 + deltaQ, 0, maximum)])
      }
      for (const [distance, value] of mutableP) {
        const [x, y] = coordinates(edgeX, edgeY, direction, 'p', distance, along)
        setPlaneSample(plane, width, x, y, value)
      }
      for (const [distance, value] of mutableQ) {
        const [x, y] = coordinates(edgeX, edgeY, direction, 'q', distance, along)
        setPlaneSample(plane, width, x, y, value)
      }
      continue
    }
    for (const [distance, value] of replacements) {
      const [x, y] = coordinates(edgeX, edgeY, direction, 'p', distance, along)
      setPlaneSample(plane, width, x, y, clip(value, 0, maximum))
    }
    for (const [distance, value] of qReplacements) {
      const [x, y] = coordinates(edgeX, edgeY, direction, 'q', distance, along)
      setPlaneSample(plane, width, x, y, clip(value, 0, maximum))
    }
  }
}

const filterChromaEdge = (
  plane: Uint16Array,
  width: number,
  edgeX: number,
  edgeY: number,
  direction: Direction,
  tc: number,
  maximum: number,
): void => {
  for (let along = 0; along < 4; along += 1) {
    const [p0X, p0Y] = coordinates(edgeX, edgeY, direction, 'p', 0, along)
    const [p1X, p1Y] = coordinates(edgeX, edgeY, direction, 'p', 1, along)
    const [q0X, q0Y] = coordinates(edgeX, edgeY, direction, 'q', 0, along)
    const [q1X, q1Y] = coordinates(edgeX, edgeY, direction, 'q', 1, along)
    const p0 = planeSample(plane, width, p0X, p0Y)
    const p1 = planeSample(plane, width, p1X, p1Y)
    const q0 = planeSample(plane, width, q0X, q0Y)
    const q1 = planeSample(plane, width, q1X, q1Y)
    const delta = clip((((q0 - p0) << 2) + p1 - q1 + 4) >> 3, -tc, tc)
    setPlaneSample(plane, width, p0X, p0Y, clip(p0 + delta, 0, maximum))
    setPlaneSample(plane, width, q0X, q0Y, clip(q0 - delta, 0, maximum))
  }
}

export const applyHevcDeblocking = (
  yPlane: Uint16Array,
  uPlane: Uint16Array,
  vPlane: Uint16Array,
  width: number,
  height: number,
  edges: HevcDeblockEdges,
  options: HevcDeblockOptions,
): void => {
  const chromaWidth = Math.ceil(width / 2)
  const chromaHeight = Math.ceil(height / 2)
  if (
    yPlane.length !== width * height ||
    uPlane.length !== chromaWidth * chromaHeight ||
    vPlane.length !== chromaWidth * chromaHeight ||
    edges.widthIn4x4 !== Math.ceil(width / 4) ||
    edges.heightIn4x4 !== Math.ceil(height / 4) ||
    edges.vertical.length !== edges.widthIn4x4 * edges.heightIn4x4 ||
    edges.horizontal.length !== edges.vertical.length
  ) {
    throw invalidInput('HEVC deblocking geometry is invalid')
  }
  const maximum = (1 << options.bitDepth) - 1
  const betaPrime = BETA[clip(options.qp + options.betaOffset * 2, 0, 51)] ?? 0
  const tcPrime = TC[clip(options.qp + 2 + options.tcOffset * 2, 0, 53)] ?? 0
  const beta = betaPrime << (options.bitDepth - 8)
  const tc = tcPrime << (options.bitDepth - 8)

  const applyDirection = (direction: Direction): void => {
    const map = direction === 'vertical' ? edges.vertical : edges.horizontal
    const outerLimit = direction === 'vertical' ? width : height
    const innerLimit = direction === 'vertical' ? height : width
    for (let edge = 8; edge < outerLimit; edge += 8) {
      for (let along = 0; along + 3 < innerLimit; along += 4) {
        const unitX = direction === 'vertical' ? edge >>> 2 : along >>> 2
        const unitY = direction === 'vertical' ? along >>> 2 : edge >>> 2
        if (map[unitY * edges.widthIn4x4 + unitX] !== 1) continue
        const edgeX = direction === 'vertical' ? edge : along
        const edgeY = direction === 'vertical' ? along : edge
        if (
          (direction === 'vertical' && edge + 3 < width) ||
          (direction === 'horizontal' && edge + 3 < height)
        ) {
          filterLumaEdge(yPlane, width, edgeX, edgeY, direction, beta, tc, maximum)
        }
        if ((edge & 15) !== 0 || (along & 7) !== 0) continue
        const chromaEdgeX = edgeX >> 1
        const chromaEdgeY = edgeY >> 1
        const qPiCb = clip(options.qp + options.cbQpOffset, 0, 57)
        const qPiCr = clip(options.qp + options.crQpOffset, 0, 57)
        const chromaTc = (componentQp: number): number =>
          (TC[clip(chromaQp(componentQp) + 2 + options.tcOffset * 2, 0, 53)] ?? 0) <<
          (options.bitDepth - 8)
        filterChromaEdge(
          uPlane,
          chromaWidth,
          chromaEdgeX,
          chromaEdgeY,
          direction,
          chromaTc(qPiCb),
          maximum,
        )
        filterChromaEdge(
          vPlane,
          chromaWidth,
          chromaEdgeX,
          chromaEdgeY,
          direction,
          chromaTc(qPiCr),
          maximum,
        )
      }
    }
  }
  applyDirection('vertical')
  applyDirection('horizontal')
}
