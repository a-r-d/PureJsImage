export interface M7QualityPoint {
  readonly bytes: number
  readonly score: number
}

/** Log-byte interpolation on the non-dominated measured frontier; never extrapolates. */
export function interpolateM7Quality(
  points: readonly M7QualityPoint[],
  target: number,
  higherIsBetter = true,
): number | undefined {
  if (!Number.isFinite(target)) throw new Error('Quality target must be finite')
  const direction = higherIsBetter ? 1 : -1
  const ordered = points
    .map((point) => {
      if (!Number.isSafeInteger(point.bytes) || point.bytes < 1 || !Number.isFinite(point.score))
        throw new Error('Quality curves require finite measured scores and positive byte counts')
      return { bytes: point.bytes, score: point.score * direction }
    })
    .sort((left, right) => right.score - left.score || left.bytes - right.bytes)
  const frontier: M7QualityPoint[] = []
  let minimumBytes = Infinity
  for (const point of ordered) {
    if (point.bytes >= minimumBytes) continue
    frontier.push(point)
    minimumBytes = point.bytes
  }
  frontier.reverse()
  const quality = target * direction
  for (let index = 0; index < frontier.length; index++) {
    const point = frontier[index]
    if (!point) throw new Error('Quality frontier is incomplete')
    if (point.score === quality) return point.bytes
    const next = frontier[index + 1]
    if (next && point.score < quality && quality < next.score) {
      const fraction = (quality - point.score) / (next.score - point.score)
      return Math.exp(Math.log(point.bytes) * (1 - fraction) + Math.log(next.bytes) * fraction)
    }
  }
  return undefined
}
