import { number, object } from '../comparison/model.ts'

/** The progress ledger is saved before BD-rate coverage analysis adds warnings. */
export function labExecutionComplete(progressValue: unknown, summaryValue: unknown): boolean {
  const progress = object(progressValue),
    summary = object(summaryValue)
  if (
    !Array.isArray(progress.failures) ||
    !Array.isArray(progress.omissions) ||
    !Array.isArray(summary.failures)
  )
    throw new Error('Invalid lab execution ledger')
  const completed = number(progress.completedJobs),
    total = number(progress.totalJobs)
  if (
    !Number.isSafeInteger(completed) ||
    !Number.isSafeInteger(total) ||
    completed < 0 ||
    total < completed
  )
    throw new Error('Invalid lab execution counts')
  // summary.omissions also contains partial-range curve warnings. Their quality
  // coverage is assessed separately; they are not unfinished encode jobs.
  return (
    total > 0 &&
    completed === total &&
    progress.failures.length === 0 &&
    progress.omissions.length === 0 &&
    summary.failures.length === 0
  )
}
