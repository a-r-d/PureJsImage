export interface RecoveryPoint {
  readonly setting: number
  readonly bytes: number
  readonly score: number
}

export interface RecoveryBracket {
  readonly lower: RecoveryPoint
  readonly upper: RecoveryPoint
  readonly width: number
}

/** Keep measured rate/quality points that another point does not beat on both axes. */
export function recoveryFrontier(points: readonly RecoveryPoint[]): RecoveryPoint[] {
  const ordered = [...points].sort(
    (left, right) => right.score - left.score || left.bytes - right.bytes,
  )
  let minimumBytes = Infinity
  const frontier: RecoveryPoint[] = []
  for (const point of ordered) {
    if (
      !(point.setting > 0 && Number.isFinite(point.setting)) ||
      !Number.isSafeInteger(point.bytes) ||
      point.bytes < 1 ||
      !Number.isFinite(point.score)
    )
      throw new Error('Invalid measured rate/quality point')
    if (point.bytes >= minimumBytes) continue
    frontier.push(point)
    minimumBytes = point.bytes
  }
  return frontier.reverse()
}

export function recoveryBracket(
  points: readonly RecoveryPoint[],
  target: number,
): RecoveryBracket | undefined {
  if (!Number.isFinite(target)) throw new Error('Invalid target')
  const frontier = recoveryFrontier(points)
  const exact = frontier.find((point) => point.score === target)
  if (exact) return { lower: exact, upper: exact, width: 0 }
  for (let index = 0; index < frontier.length - 1; index++) {
    const lower = frontier[index]
    const upper = frontier[index + 1]
    if (lower && upper && lower.score <= target && target <= upper.score)
      return { lower, upper, width: upper.score - lower.score }
  }
  return undefined
}

/** Setting/score inversions are reported, not silently removed from the raw curve. */
export function recoveryMonotonicityViolations(points: readonly RecoveryPoint[]): number {
  const ordered = [...points].sort((left, right) => left.setting - right.setting)
  let violations = 0
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1]
    const current = ordered[index]
    if (previous && current && current.score > previous.score + 1e-6) violations++
  }
  return violations
}

export function nextRecoverySetting(
  points: readonly RecoveryPoint[],
  target: number,
  minimumSetting: number,
  maximumSetting: number,
  maximumWidth: number,
): number | undefined {
  if (
    points.length === 0 ||
    minimumSetting <= 0 ||
    maximumSetting <= minimumSetting ||
    maximumWidth <= 0
  )
    throw new Error('Invalid recovery search limits')
  const bracket = recoveryBracket(points, target)
  if (bracket && bracket.width <= maximumWidth) return undefined
  const ordered = [...points].sort((left, right) => left.setting - right.setting)
  const bestScore = Math.max(...ordered.map((point) => point.score))
  const worstScore = Math.min(...ordered.map((point) => point.score))
  let candidate: number
  if (bestScore < target) {
    const first = ordered[0]
    if (!first || first.setting <= minimumSetting) return undefined
    candidate = Math.max(minimumSetting, first.setting / 2)
  } else if (worstScore > target) {
    const last = ordered[ordered.length - 1]
    if (!last || last.setting >= maximumSetting) return undefined
    candidate = Math.min(maximumSetting, last.setting * 2)
  } else {
    const pairs: { lower: RecoveryPoint; upper: RecoveryPoint }[] = []
    for (let index = 1; index < ordered.length; index++) {
      const first = ordered[index - 1]
      const second = ordered[index]
      if (first && second && (first.score - target) * (second.score - target) <= 0)
        pairs.push({ lower: first, upper: second })
    }
    pairs.sort(
      (left, right) =>
        Math.abs(left.lower.score - left.upper.score) -
        Math.abs(right.lower.score - right.upper.score),
    )
    const pair = pairs[0]
    if (!pair) return undefined
    const fraction = (target - pair.lower.score) / (pair.upper.score - pair.lower.score)
    const interpolation = Math.exp(
      Math.log(pair.lower.setting) * (1 - fraction) + Math.log(pair.upper.setting) * fraction,
    )
    candidate =
      Number.isFinite(interpolation) && recoveryMonotonicityViolations(ordered) === 0
        ? interpolation
        : Math.sqrt(pair.lower.setting * pair.upper.setting)
    if (candidate <= pair.lower.setting * 1.001 || candidate >= pair.upper.setting * 0.999)
      candidate = Math.sqrt(pair.lower.setting * pair.upper.setting)
  }
  candidate = Number(candidate.toPrecision(5))
  if (ordered.some((point) => point.setting === candidate)) return undefined
  return candidate
}
