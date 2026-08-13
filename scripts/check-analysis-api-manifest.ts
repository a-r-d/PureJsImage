import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const manifestPath = join(repositoryRoot, 'api/analysis-exports.json')
const entries = Object.freeze({
  'purejsimage/analysis': 'src/analysis/index.ts',
  'purejsimage/analysis/project': 'src/analysis/project-entry.ts',
  'purejsimage/analysis/results': 'src/analysis/results.ts',
  'purejsimage/analysis/roi': 'src/analysis/roi-entry.ts',
  'purejsimage/analysis/runtime': 'src/analysis/runtime.ts',
})

interface ApiExport {
  readonly kind: 'type' | 'value'
  readonly name: string
}

const exportedNames = async (sourcePath: string): Promise<readonly ApiExport[]> => {
  const source = await readFile(join(repositoryRoot, sourcePath), 'utf8')
  const exports: ApiExport[] = []
  const statements = source.matchAll(/export\s+(type\s+)?\{([\s\S]*?)\}\s+from\s+/gu)
  for (const statement of statements) {
    const kind = statement[1] === undefined ? 'value' : 'type'
    for (const rawName of (statement[2] ?? '').split(',')) {
      const name = rawName
        .trim()
        .split(/\s+as\s+/u)
        .at(-1)
      if (name !== undefined && name.length > 0) exports.push({ kind, name })
    }
  }
  return Object.freeze(exports.sort((left, right) => left.name.localeCompare(right.name)))
}

const manifest: Record<string, readonly ApiExport[]> = {}
for (const [entry, sourcePath] of Object.entries(entries)) {
  manifest[entry] = await exportedNames(sourcePath)
}
const rendered = `${JSON.stringify({ schemaVersion: 1, entries: manifest }, null, 2)}\n`
if (process.argv.includes('--write')) {
  await writeFile(manifestPath, rendered)
} else {
  const current = await readFile(manifestPath, 'utf8')
  if (current !== rendered) {
    throw new Error('Analysis API manifest is stale; run npm run analysis:api:generate')
  }
}
