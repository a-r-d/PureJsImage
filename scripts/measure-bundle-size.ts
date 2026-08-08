import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { build } from 'esbuild'

interface BundleTarget {
  readonly entries: readonly string[]
  readonly name: string
}

interface BundleMeasurement extends BundleTarget {
  readonly brotliBytes: number
  readonly gzipBytes: number
  readonly minifiedBytes: number
}

const targets: readonly BundleTarget[] = [
  { name: 'Core API', entries: ['src/index.ts'] },
  { name: 'Core + PNG', entries: ['src/index.ts', 'src/codec-entries/png.ts'] },
  { name: 'Core + JPEG', entries: ['src/index.ts', 'src/codec-entries/jpeg.ts'] },
  {
    name: 'Core + JPEG 2000',
    entries: ['src/index.ts', 'src/codec-entries/jpeg2000.ts'],
  },
  { name: 'Core + WebP', entries: ['src/index.ts', 'src/codec-entries/webp.ts'] },
  { name: 'Core + GIF', entries: ['src/index.ts', 'src/codec-entries/gif.ts'] },
  { name: 'Core + BMP', entries: ['src/index.ts', 'src/codec-entries/bmp.ts'] },
  { name: 'Core + ICO', entries: ['src/index.ts', 'src/codec-entries/ico.ts'] },
  { name: 'Core + TIFF', entries: ['src/index.ts', 'src/codec-entries/tiff.ts'] },
  { name: 'Core + AVIF', entries: ['src/index.ts', 'src/codec-entries/avif.ts'] },
  { name: 'Core + HEIF / HEIC', entries: ['src/index.ts', 'src/codec-entries/heif.ts'] },
  { name: 'Core + all codecs', entries: ['src/index.ts', 'src/codec-entries/all.ts'] },
]

const measure = async (target: BundleTarget): Promise<BundleMeasurement> => {
  const result = await build({
    bundle: true,
    charset: 'utf8',
    format: 'esm',
    legalComments: 'none',
    logLevel: 'silent',
    minify: true,
    platform: 'node',
    stdin: {
      contents: target.entries.map((entry) => `export * from './${entry}'`).join('\n'),
      loader: 'ts',
      resolveDir: process.cwd(),
      sourcefile: 'bundle-size-entry.ts',
    },
    sourcemap: false,
    target: 'node22',
    treeShaking: true,
    write: false,
  })
  const output = result.outputFiles[0]?.contents
  if (!output) throw new Error(`esbuild produced no output for ${target.entries.join(', ')}`)
  return {
    ...target,
    brotliBytes: brotliCompressSync(output, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
    gzipBytes: gzipSync(output, { level: 9 }).byteLength,
    minifiedBytes: output.byteLength,
  }
}

const kibibytes = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KiB`
const measurements: BundleMeasurement[] = []
for (const target of targets) measurements.push(await measure(target))

console.log('| Entry | Minified | gzip | Brotli |')
console.log('| --- | ---: | ---: | ---: |')
for (const measurement of measurements) {
  console.log(
    `| ${measurement.name} | ${kibibytes(measurement.minifiedBytes)} | ${kibibytes(measurement.gzipBytes)} | ${kibibytes(measurement.brotliBytes)} |`,
  )
}
