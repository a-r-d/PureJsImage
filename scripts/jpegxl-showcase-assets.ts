import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PixelColorSemantics } from '../src/color.ts'
import { encodeJpegXlAnimation, encodeJpegXlNative } from '../src/jpegxl.ts'
import { Uint8ArraySink } from '../src/sink.ts'
export async function writeJpegXlShowcaseAssets(directory: string): Promise<void> {
  const evidence = join(directory, 'jpeg-xl/evidence')
  await mkdir(evidence, { recursive: true })
  const report = JSON.parse(
    await readFile('benchmark/jpegxl/comparison/website-data.json', 'utf8'),
  ) as unknown
  if (
    typeof report !== 'object' ||
    report === null ||
    !('sourceReports' in report) ||
    !Array.isArray(report.sourceReports)
  )
    throw new Error('Missing comparison provenance')
  for (const name of [
    'website-data.json',
    'REPORT.md',
    'PARITY.md',
    'DC-MODELS.md',
    'FILTER-AC.md',
    'LOSSLESS-REPEATS.md',
    'LOSSLESS-SPATIAL.md',
    'LOSSLESS-RCT.md',
    'DENSE-TRAINING.md',
    'GROUP-SEARCH.md',
    'ALPHA-PALETTES.md',
    'PHOTO-PARITY.md',
    'GRAPHIC-POINTS.md',
    'ALPHA-POINTS.md',
    'ORIGINAL-PHOTO.md',
    'ORIGINAL-MATRIX.md',
    'FRONTIER-SAMPLING.md',
    'survey.json',
    'subjects.json',
    'fixtures.json',
  ])
    await copyFile(`benchmark/jpegxl/comparison/${name}`, join(evidence, name))
  for (const name of [
    'parity-funded-sampling-effort1-public.json',
    'parity-funded-sampling-effort7-public.json',
    'quality-funded-sampling-public.json',
    'quality-photo-extension.json',
    'quality-photo-frontier-extension.json',
    'dc-ac-kernel-production-controls.json',
    'filter-ac-production-controls.json',
    'alpha-palette-production-controls.json',
    'photo-parity-production-controls.json',
    'graphic-point-production-controls.json',
    'alpha-point-production-controls.json',
    'original-photo-production-controls.json',
    'original-matrix-portrait-baseline.json',
    'original-luma-context-controls.json',
    'original-spatial-context-controls.json',
    'original-cone-floor-controls.json',
    'original-fine-production-controls.json',
    'original-middle-channel-controls.json',
    'original-portrait-ba3-public.json',
    'coherent-coarse-public.json',
    'large-transform-public-ba2.json',
    'large-transform-public-ssim80.json',
    'large-transform-independent-point.json',
    'large-transform-gradient-control.json',
    'original-photo-quality-study.json',
    'original-photo-endpoint-qualification.json',
    'original-photo-ssim-endpoint-qualification.json',
    'original-lossy-heldout-controls.json',
    'photo-transform-native-baseline.json',
    'alpha-palette-native-baseline.json',
    'alpha-peer-audit.json',
    'lossless-repeat-production-controls.json',
    'lossless-spatial-production-controls.json',
    'lossless-rct-production-controls.json',
    'lossless-dense-training-production-controls.json',
    'lossless-group-search-production-controls.json',
    'parity-cache-groups-effort1-public.json',
    'parity-cache-groups-effort7-public.json',
    'quality-cache-groups-public.json',
    'parity-tree-entropy-effort1-public.json',
    'parity-tree-entropy-effort7-public.json',
    'quality-tree-entropy-public.json',
  ])
    await copyFile(`benchmark/jpegxl/comparison/results/${name}`, join(evidence, name))
  for (const value of report.sourceReports) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('path' in value) ||
      typeof value.path !== 'string'
    )
      throw new Error('Bad raw report')
    const name = value.path.split('/').at(-1)
    if (!name) throw new Error('Bad report name')
    await copyFile(value.path, join(evidence, name))
  }
  const cropDir = join(directory, 'assets/jpegxl-comparison')
  await mkdir(cropDir, { recursive: true })
  await copyFile(
    'docs-astro/src/data/jpegxl-comparison-crops.json',
    join(cropDir, 'provenance.json'),
  )
  const target = join(directory, 'demo-data')
  await mkdir(target, { recursive: true })
  await copyFile(
    'tests/fixtures/jpegxl/gray-exact/gray-baseline.jpg',
    join(target, 'jpegxl-gray.jpg'),
  )
  await copyFile(
    'benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/rgb8-distance1-multi-group-progressive.jxl',
    join(target, 'jpegxl-progressive.jxl'),
  )
  const width = 32,
    height = 24,
    count = width * height
  const gray = Uint16Array.from({ length: count }, (_, i) => Math.floor((i / (count - 1)) * 65535))
  await writeFile(
    join(target, 'jpegxl-native16.jxl'),
    await encodeJpegXlNative({ width, height, color: [{ data: gray, bitDepth: 16 }] }),
  )
  await writeFile(
    join(target, 'jpegxl-native-extra.jxl'),
    await encodeJpegXlNative({
      width,
      height,
      color: [{ data: gray, bitDepth: 16 }],
      extraChannels: [
        { type: 1, name: 'depth', bitDepth: 16, data: Uint16Array.from(gray, (v) => 65535 - v) },
      ],
    }),
  )
  const values = Float32Array.from({ length: count }, (_, i) => (i / (count - 1)) * 4),
    bits = new Uint32Array(values.buffer)
  const semantics: PixelColorSemantics = {
    family: 'rgb',
    primaries: 'srgb',
    transfer: { kind: 'linear' },
    matrix: 'identity',
    range: 'full',
    alpha: 'straight',
    provenance: 'container-signaled',
    renderingIntent: 'relative',
  }
  const plane = { data: bits, bitDepth: 32, sampleFormat: 'binary32' as const }
  await writeFile(
    join(target, 'jpegxl-native-float.jxl'),
    await encodeJpegXlNative({
      width,
      height,
      color: [plane, plane, plane],
      colorSemantics: semantics,
      extraChannels: [{ type: 0, name: 'alpha', bitDepth: 16, data: gray }],
    }),
  )
  async function* frames() {
    for (let f = 0; f < 3; f++) {
      const data = new Uint8Array(width * height * 4)
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const stripe = Math.abs(x - (6 + f * 8)) < 4
          data.set(
            [stripe ? 230 : 30, stripe ? 100 : 80, stripe ? 40 : 160, 255],
            (y * width + x) * 4,
          )
        }
      yield { width, height, data, durationTicks: [2, 3, 5][f] ?? 2 }
    }
  }
  const sink = new Uint8ArraySink()
  for await (const chunk of encodeJpegXlAnimation(frames(), {
    width,
    height,
    pixelFormat: 'rgba8',
    colorSemantics: { ...semantics, transfer: { kind: 'srgb' } },
    animation: {
      ticksPerSecondNumerator: 10,
      ticksPerSecondDenominator: 1,
      loops: 2,
      haveTimecodes: false,
    },
    encoding: { mode: 'lossless', effort: 1 },
  }))
    await sink.write(chunk)
  await writeFile(join(target, 'jpegxl-animation.jxl'), sink.toUint8Array())
}

/** Split only JPEG XL entries so advanced code cannot enter unrelated tool bundles. */
export async function buildJpegXlShowcase(directory: string): Promise<void> {
  const { build } = await import('esbuild')
  const result = await build({
    entryPoints: {
      'jpegxl-workbench': 'docs-astro/src/scripts/jpegxl-workbench.ts',
      'jpegxl-workbench-worker': 'docs-astro/src/scripts/jpegxl-workbench-worker.ts',
      'jpegxl-tools': 'docs-astro/src/scripts/jpegxl-tools.ts',
      'jpegxl-progressive-workbench': 'docs-astro/src/scripts/jpegxl-progressive-workbench.ts',
    },
    outdir: join(directory, 'assets'),
    entryNames: '[name]',
    chunkNames: 'jpegxl-shared-[hash]',
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    bundle: true,
    splitting: true,
    minify: true,
    metafile: true,
    logLevel: 'silent',
  })
  if (Object.keys(result.metafile.inputs).some((p) => p.includes('node_modules/')))
    throw new Error('Third-party implementation entered JPEG XL tools')
  const files = Object.entries(result.metafile.outputs).map(([path, value]) => ({
    path,
    bytes: value.bytes,
  }))
  const total = files.reduce((sum, f) => sum + f.bytes, 0)
  // A separate tool-only envelope covers static codecs plus sequence/native/progressive APIs.
  // No npm entry budget or unrelated site tool budget is increased.
  if (total > 1200000) throw new Error(`JPEG XL tool assets exceed the 1.2 MB envelope: ${total}`)
  await writeFile(
    join(directory, 'assets/jpegxl-tool-build.json'),
    `${JSON.stringify({ totalBytes: total, budgetBytes: 1200000, files }, null, 2)}\n`,
  )
}
