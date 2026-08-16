import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { prepareScientificFixture } from './catalog.ts'
import { scientificCompetitorWorkloads } from './competitors.ts'

const repositoryDirectory = process.cwd()
const competitorDirectory = join(repositoryDirectory, 'benchmark/competitors-js')
const packageJsonPath = join(competitorDirectory, 'package.json')
const lockfilePath = join(competitorDirectory, 'package-lock.json')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const packageSegments = (name: string): readonly string[] => name.split('/')

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as unknown
const lockfile = JSON.parse(await readFile(lockfilePath, 'utf8')) as unknown
if (!isRecord(packageJson) || !isRecord(packageJson.dependencies)) {
  throw new Error(`Invalid competitor package manifest: ${packageJsonPath}`)
}
if (!isRecord(lockfile) || !isRecord(lockfile.packages)) {
  throw new Error(`Invalid competitor lockfile: ${lockfilePath}`)
}
const rootLock = lockfile.packages['']
if (!isRecord(rootLock) || !isRecord(rootLock.dependencies)) {
  throw new Error(`Competitor lockfile has no root dependency map: ${lockfilePath}`)
}

const entries = Object.entries(packageJson.dependencies)
for (const [name, version] of entries) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Competitor dependency ${name} is not exact-pinned: ${String(version)}`)
  }
  if (rootLock.dependencies[name] !== version) {
    throw new Error(`Competitor lockfile is stale for ${name}: expected ${version}`)
  }
  const installed = JSON.parse(
    await readFile(
      join(competitorDirectory, 'node_modules', ...packageSegments(name), 'package.json'),
      'utf8',
    ),
  ) as unknown
  if (!isRecord(installed) || installed.version !== version) {
    throw new Error(`Installed competitor version mismatch for ${name}`)
  }
}

const fixtureIds = [...new Set(scientificCompetitorWorkloads.map(({ fixtureId }) => fixtureId))]
for (const fixtureId of fixtureIds) await prepareScientificFixture(fixtureId)

console.log(`Verified ${entries.length} exact-pinned competitor packages.`)
console.log(`Prepared ${fixtureIds.length} shared scientific fixtures: ${fixtureIds.join(', ')}`)
console.log(
  'No FITS package was added: there is no strong current Node-focused JavaScript FITS competitor in this scorecard.',
)
