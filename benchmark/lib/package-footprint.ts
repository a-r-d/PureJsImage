import { lstat, readFile, readdir } from 'node:fs/promises'
import { dirname, join, parse } from 'node:path'
import type { EngineMetadata, PackageFootprint } from '../types.ts'

interface PackageDescription {
  name: string
  version: string
  dependencies: string[]
  optionalDependencies: string[]
  omittedOptionalDependency: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const dependencyNames = (value: unknown): string[] => {
  return isRecord(value) ? Object.keys(value) : []
}

const readPackageDescription = async (packageJsonPath: string): Promise<PackageDescription> => {
  const parsed: unknown = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  if (!isRecord(parsed) || typeof parsed.name !== 'string' || typeof parsed.version !== 'string') {
    throw new Error(`Invalid installed package metadata: ${packageJsonPath}`)
  }
  return {
    name: parsed.name,
    version: parsed.version,
    dependencies: dependencyNames(parsed.dependencies),
    optionalDependencies: dependencyNames(parsed.optionalDependencies),
    omittedOptionalDependency: parsed.purejsimageOmittedOptionalDependency === true,
  }
}

const packageSegments = (name: string): readonly string[] => name.split('/')

const findInstalledPackage = async (
  name: string,
  fromDirectory: string,
): Promise<string | undefined> => {
  let current = fromDirectory
  const root = parse(current).root
  while (current !== root) {
    const candidate = join(current, 'node_modules', ...packageSegments(name), 'package.json')
    try {
      if ((await lstat(candidate)).isFile()) return candidate
    } catch {}
    current = dirname(current)
  }
  return undefined
}

const directoryBytes = async (path: string): Promise<number> => {
  const stat = await lstat(path)
  if (stat.isFile()) return stat.size
  if (!stat.isDirectory()) return 0
  const entries = await readdir(path, { withFileTypes: true })
  let bytes = 0
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    bytes += await directoryBytes(join(path, entry.name))
  }
  return bytes
}

const workspaceFootprint = async (repositoryDirectory: string): Promise<PackageFootprint> => {
  const paths = ['dist', 'LICENSE', 'package.json', 'README.md', 'ROADMAP.md']
  const description = await readPackageDescription(join(repositoryDirectory, 'package.json'))
  let bytes = 0
  for (const path of paths) {
    bytes += await directoryBytes(join(repositoryDirectory, path))
  }
  return {
    bytes,
    packages: [`${description.name}@${description.version}`],
    productionPackageCount: 1,
  }
}

export const measurePackageFootprint = async ({
  engine,
  repositoryDirectory,
}: {
  engine: EngineMetadata
  repositoryDirectory: string
}): Promise<PackageFootprint> => {
  if (engine.packageName === 'purejsimage') return workspaceFootprint(repositoryDirectory)

  const rootPackageNames = engine.packageNames ?? [engine.packageName]
  const pending: string[] = []
  for (const packageName of rootPackageNames) {
    const rootPackageJson = await findInstalledPackage(packageName, repositoryDirectory)
    if (!rootPackageJson) throw new Error(`Installed package not found: ${packageName}`)
    pending.push(rootPackageJson)
  }
  const visited = new Set<string>()
  const packages: string[] = []
  let bytes = 0

  while (pending.length > 0) {
    const packageJsonPath = pending.pop()
    if (!packageJsonPath || visited.has(packageJsonPath)) continue
    visited.add(packageJsonPath)
    const description = await readPackageDescription(packageJsonPath)
    if (description.omittedOptionalDependency) continue
    const packageDirectory = dirname(packageJsonPath)
    packages.push(`${description.name}@${description.version}`)
    bytes += await directoryBytes(packageDirectory)

    for (const dependency of [...description.dependencies, ...description.optionalDependencies]) {
      const dependencyPackageJson = await findInstalledPackage(dependency, packageDirectory)
      if (dependencyPackageJson) pending.push(dependencyPackageJson)
    }
  }

  packages.sort()
  return { bytes, packages, productionPackageCount: packages.length }
}
