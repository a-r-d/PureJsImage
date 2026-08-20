import { readFile } from 'node:fs/promises'

import { parseOmeZarrCompatibilityCorpus, runOmeZarrCompatibilitySample } from './compatibility.ts'

const manifestPath = process.argv[2] ?? new URL('./official-corpus.json', import.meta.url)
const corpus = parseOmeZarrCompatibilityCorpus(JSON.parse(await readFile(manifestPath, 'utf8')))
const results = []
for (const sample of corpus.samples) {
  results.push(await runOmeZarrCompatibilitySample(sample))
}
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, results }, null, 2)}\n`)
if (
  results.some(
    (result, index) =>
      result.classification !== (corpus.samples[index]?.expectedClassification ?? 'PASS'),
  )
) {
  process.exitCode = 1
}
