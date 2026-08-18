import { readFile, writeFile } from 'node:fs/promises'
import { tiffCompressionCapabilities } from '../src/tiff/compressions.ts'
import fixtureManifest from '../tests/fixtures/cog/manifest.json' with { type: 'json' }

const outputPath = 'docs/tiff-cog-compatibility.md'
const checkOnly = process.argv.includes('--check')

const statusLabel = (status: (typeof tiffCompressionCapabilities)[number]['status']): string => {
  if (status === 'fully-tested') return 'Fully tested'
  if (status === 'implemented-but-weakly-tested') return 'Implemented but weakly COG-tested'
  if (status === 'recognized-but-unsupported') return 'Recognized but unsupported'
  return 'Not implemented'
}

const decodeLabel = (
  support: (typeof tiffCompressionCapabilities)[number]['decodeSupport'],
): string => {
  if (support === 'display-and-raster') return 'Display and native raster'
  if (support === 'display-only') return 'Display only'
  if (support === 'display-with-explicit-codec') return 'Display with explicit codec composition'
  return 'Unsupported'
}

const tableEscape = (value: string): string => value.replaceAll('|', '\\|')

const matrix = tiffCompressionCapabilities.map(
  ({ id, name, status, decodeSupport, notes }) =>
    `| ${id} | ${name} | ${statusLabel(status)} | ${decodeLabel(decodeSupport)} | ${tableEscape(notes)} |`,
)

const corpus = fixtureManifest.fixtures.map(
  ({ filename, bytes, container, compressionIds, levels }) =>
    `| \`${filename}\` | ${container} | ${compressionIds.join(', ')} | ${levels.map(({ width, height }) => `${width}×${height}`).join(' → ')} | ${bytes.toLocaleString('en-US')} |`,
)

const output = `<!-- Generated from src/tiff/compressions.ts and tests/fixtures/cog/manifest.json. Do not edit directly. -->
# Cloud Optimized GeoTIFF compatibility

PureJsImage supports selective range-backed reads from tiled TIFF and BigTIFF files, but COG
compatibility is a combination of container layout, compression, overview structure, pixel layout,
and the API used for decoding. The matrix below is checked against executable tests instead of being
inferred from compression constants.

“Fully tested” means a deterministic COG or existing selective-range fixture exercises the assigned
compression. “Implemented but weakly COG-tested” means the codec has focused pixel tests, but this
repository does not yet have a deterministic COG-layout fixture for that assignment. “Recognized but
unsupported” and “not implemented” both fail with an explicit compression ID and name.

## Compression audit

| ID | Compression | Evidence status | Decode surface | Boundary |
| ---: | --- | --- | --- | --- |
${matrix.join('\n')}

Native scientific TIFF reads require the “Display and native raster” surface. JPEG, old-style JPEG,
CCITT, Aperio JPEG 2000, and SGILog are display-decoder capabilities; they are not silently converted
into native scientific raster samples. WebP requires explicit TIFF/WebP codec composition.

## Deterministic COG corpus

| Fixture | Container | Compression IDs | Levels | Bytes |
| --- | --- | --- | --- | ---: |
${corpus.join('\n')}

The corpus covers tiled Classic TIFF and BigTIFF, internal SubIFD overviews, Deflate, LZW, PackBits,
JPEG-in-TIFF, scalar and component nodata, RGB and RGBA samples, north-up and rotated affines, and
pixel-is-area/pixel-is-point semantics. Reduced-resolution tile payloads precede full-resolution tile
payloads in the pyramid fixture so a remote overview request can avoid the base imagery.

Regenerate the corpus reproducibly with:

\`\`\`sh
npm run fixtures:cog:prepare
\`\`\`

The generator is first-party TypeScript. Node's zlib and the existing development-only \`jpeg-js\`
oracle encode fixture segments; neither is a published runtime dependency. SHA-256 values and byte
lengths are recorded in \`tests/fixtures/cog/manifest.json\`.

## Structural inspection

\`inspectCog(document)\` reports TIFF versus BigTIFF, byte order, IFD/SubIFD paths and offsets,
overview dimensions, tile geometry and offsets, compression status, sample layout, and likely COG
issues such as strips, missing tile tables, non-reduced overviews, non-monotonic tile offsets,
unsupported compression, or IFDs stored after image data.

\`\`\`ts
import { inspectCog, openTiffDocument } from 'purejsimage/tiff'

const document = await openTiffDocument(source)
const report = await inspectCog(document)
console.log(report.container, report.directories, report.issues)
\`\`\`

This is a structural diagnostic, not a standards certification service. A warning identifies a
layout that is likely to cost extra remote reads; an error means the file misses a core tiled/readable
boundary used by PureJsImage.

## Viewport benchmark

\`npm run bench:cog:viewport\` opens the pyramid through a simulated HTTP Range server. It accepts
pixel or model viewports, chooses an overview from requested output resolution, asserts the expected
level, decodes the selected region twice, and reports request count, fetched bytes, cache hits, time
to first decoded TIFF tile block, total decode time, and decoded pixels. The benchmark fails if it
fetches the complete fixture, and CI uses no live remote server.

\`\`\`sh
npm run bench:cog:viewport
npm run bench:cog:viewport -- --space model
npm run bench:cog:viewport -- --space pixel --viewport 0,0,32,32
\`\`\`
`

if (checkOnly) {
  const current = await readFile(outputPath, 'utf8')
  if (current !== output)
    throw new Error(`${outputPath} is stale; run npm run capabilities:generate`)
  process.stdout.write('TIFF COG compatibility document is current\n')
} else {
  await writeFile(outputPath, output)
  process.stdout.write(`Wrote ${outputPath}\n`)
}
