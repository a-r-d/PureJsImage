import { object } from '../comparison/model.ts'

/** Execution completeness is separate from the retained quality-band warnings. */
export function assertAllocationScreen(value: unknown): void {
  const summary = object(value)
  if (
    !Array.isArray(summary.failures) ||
    summary.failures.length ||
    summary.selectedImages !== 16 ||
    !Array.isArray(summary.speed)
  )
    throw new Error('Incomplete allocation screen')
  const own = summary.speed.map(object).find((row) => row.engine === 'purejsimage')
  if (!own || object(own.lab).count !== 80) throw new Error('Incomplete allocation screen')
}
