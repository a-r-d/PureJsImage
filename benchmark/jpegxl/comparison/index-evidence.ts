import { readdir, readFile } from 'node:fs/promises'
import { hash, implementationIdentity, json, root, run, work } from './io.ts'

const files: { path: string; bytes: number; sha256: string }[] = []
async function walk(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) await walk(path)
    else if (/\.(bin|jxl|png|raw|wasm|js)$/.test(entry.name)) {
      const bytes = await readFile(path)
      files.push({ path, bytes: bytes.length, sha256: hash(bytes) })
    }
  }
}
await walk(work)
const code = []
for (const entry of await readdir(root)) {
  if (!entry.endsWith('.ts')) continue
  const path = `${root}/${entry}`,
    bytes = await readFile(path)
  code.push({ path, sha256: hash(bytes) })
}
await json(`${root}/results/artifact-index.json`, {
  schemaVersion: 1,
  date: new Date().toISOString(),
  ...(await implementationIdentity()),
  comparisonBaselineRevision: '564a4d2d3e1c318f64821322c67329550df6da6b',
  harnessParentRevision: run('git', ['rev-parse', 'HEAD']).trim(),
  codecChangeCheck: run('git', [
    'diff',
    '--name-only',
    '564a4d2d3e1c318f64821322c67329550df6da6b',
    '--',
    'src',
  ]),
  harness: code,
  files,
  binaryStorage:
    'Local reproducible cache; hashes are versioned, large binaries are not committed. Input provenance and regeneration are in fixtures.json and REPORT.md.',
})
console.log(`Indexed ${files.length} artifacts`)
