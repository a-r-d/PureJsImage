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

const { runApplicationPlatformExample } = await import(
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
