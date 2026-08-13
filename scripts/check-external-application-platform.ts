import { readFile } from 'node:fs/promises'

const sourcePath = 'examples/scientific-application-platform/index.ts'
const source = await readFile(sourcePath, 'utf8')
const specifiers = [
  ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
  ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
].map((match) => match[1])
if (specifiers.length === 0) throw new Error(`${sourcePath} has no imports to validate`)
const forbidden = specifiers.filter(
  (specifier) => specifier !== 'purejsimage' && !specifier?.startsWith('purejsimage/'),
)
if (forbidden.length !== 0) {
  throw new Error(
    `${sourcePath} must use only public PureJsImage imports; found ${forbidden.join(', ')}`,
  )
}
console.log(`Validated ${specifiers.length} public-only imports in ${sourcePath}`)

const { runApplicationPlatformExample, runWholeSlideConnectedComponentsExample } = await import(
  '../examples/scientific-application-platform/index.ts'
)
const result = await runApplicationPlatformExample()
const project: unknown = JSON.parse(result.projectJson)
if (
  result.result.kind !== 'collection' ||
  project === null ||
  typeof project !== 'object' ||
  !('schemaVersion' in project) ||
  project.schemaVersion !== 1
) {
  throw new Error(`${sourcePath} did not produce the expected result and project envelope`)
}
console.log(`Executed the bounded lifecycle in ${sourcePath}`)

const svsBytes = new Uint8Array(await readFile('tests/fixtures/aperio-cmu-1-small-region.svs'))
const objectSummary = await runWholeSlideConnectedComponentsExample(svsBytes)
const objectMetadata = objectSummary.metadata
if (
  objectSummary.kind !== 'table' ||
  objectMetadata === null ||
  typeof objectMetadata.objectCount !== 'number' ||
  objectSummary.dimensions.rows !== objectMetadata.objectCount
) {
  throw new Error(`${sourcePath} did not produce the expected bounded WSI object summary`)
}
console.log(`Executed the WSI connected-components pipeline in ${sourcePath}`)
