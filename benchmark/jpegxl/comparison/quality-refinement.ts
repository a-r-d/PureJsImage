import { nextRecoverySetting, type RecoveryPoint, recoveryBracket } from '../m7-recovery-curves.ts'

/** Share the sample budget across targets, skipping resolved or exhausted targets. */
export const nextComparisonQualitySetting = (
  points: readonly RecoveryPoint[],
  targets: readonly number[],
  minimum: number,
  maximum: number,
  maximumWidth: number,
): number | undefined => {
  for (let index = 0; index < targets.length; index++) {
    const target = targets[(Math.max(0, points.length - 2) + index) % targets.length]
    if (target === undefined) throw new Error('Missing comparison quality target')
    const bracket = recoveryBracket(points, target)
    const setting = nextRecoverySetting(
      bracket ? [bracket.lower, bracket.upper] : points,
      target,
      minimum,
      maximum,
      maximumWidth,
    )
    if (setting === undefined) continue
    if (!points.some((point) => point.setting === setting)) return setting
    if (!bracket) continue

    // The interpolated setting can already exist as a dominated measurement.
    // Split the widest unmeasured interval inside the actual matching bracket.
    const first = Math.min(bracket.lower.setting, bracket.upper.setting)
    const last = Math.max(bracket.lower.setting, bracket.upper.setting)
    const ordered = points
      .filter((point) => point.setting >= first && point.setting <= last)
      .sort((left, right) => left.setting - right.setting)
    let widest = 0
    let fallback: number | undefined
    for (let at = 1; at < ordered.length; at++) {
      const lower = ordered[at - 1]
      const upper = ordered[at]
      if (!lower || !upper) throw new Error('Missing comparison quality interval')
      const width = Math.log(upper.setting / lower.setting)
      const midpoint = Number(Math.sqrt(lower.setting * upper.setting).toPrecision(5))
      if (
        width > widest &&
        midpoint > lower.setting &&
        midpoint < upper.setting &&
        !points.some((point) => point.setting === midpoint)
      ) {
        widest = width
        fallback = midpoint
      }
    }
    if (fallback !== undefined) return fallback
  }
  return undefined
}
