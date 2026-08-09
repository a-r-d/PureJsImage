import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import packageJson from '../package.json' with { type: 'json' }

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))

const run = (command: string, arguments_: readonly string[], cwd: string): void => {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: 'utf8',
    env: process.env,
  })
  if (result.error) throw result.error
  if (result.status === 0) return
  throw new Error(
    `${command} ${arguments_.join(' ')} exited with status ${result.status ?? 'unknown'}\n${result.stdout}${result.stderr}`,
  )
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-package-types-'))
try {
  run('npm', ['pack', '--ignore-scripts', '--pack-destination', temporaryDirectory], repositoryRoot)

  const tarball = join(temporaryDirectory, `purejsimage-${packageJson.version}.tgz`)
  const consumerDirectory = join(temporaryDirectory, 'consumer')
  await mkdir(consumerDirectory)
  await writeFile(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify({ name: 'purejsimage-type-consumer', private: true, type: 'module' }, null, 2)}\n`,
  )
  await writeFile(
    join(consumerDirectory, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          allowImportingTsExtensions: true,
          lib: ['ES2024', 'DOM', 'DOM.Iterable'],
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          types: [],
        },
        include: ['index.ts'],
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(consumerDirectory, 'index.ts'),
    `import { BufferSink, createImageLibrary } from 'purejsimage'
import { createImageLibrary as createBrowserImageLibrary } from 'purejsimage/browser'
import { pngCodec } from 'purejsimage/codecs/png'

const nodeImages = createImageLibrary([pngCodec])
const browserImages = createBrowserImageLibrary([pngCodec])

export const encodeNode = async (input: Uint8Array): Promise<Uint8Array> =>
  (await nodeImages.open(input)).png().toBuffer()
export const encodeBrowser = async (input: Uint8Array): Promise<Uint8Array> =>
  (await browserImages.open(input)).png().toUint8Array()
export const collected: Uint8Array = new BufferSink().toBuffer()
`,
  )

  run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', tarball],
    consumerDirectory,
  )
  run(
    process.execPath,
    [resolve(repositoryRoot, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json'],
    consumerDirectory,
  )
  console.log('Packed declarations compile for a strict consumer without Node ambient types')
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true })
}
