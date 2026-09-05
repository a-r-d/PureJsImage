import { spawnSync } from 'node:child_process'

export const reportRevision = (): string => {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
  const revision = result.stdout.trim()
  if (result.status !== 0 || !/^[0-9a-f]{40}$/.test(revision))
    throw new Error('Cannot resolve evidence revision')
  return revision
}
export const reportArgument = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(name)
  if (index < 0) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}
