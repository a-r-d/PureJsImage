import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from 'vitest'
import selection from '../benchmark/jpegxl/production-program/m7-corpus-selection.json' with {
  type: 'json',
}
import { createJpegXlModularEncoder } from '../src/codecs/jpegxl-modular-encode.ts'
import { Uint8ArraySink } from '../src/sink.ts'

test('replays the latest typed-palette artifact when an obsolete baseline also exists', async () => {
  const entry = selection.cases.find((entry) => entry.id === 'im26-8188')
  if (!entry) throw new Error('Missing frozen fixture identity')
  const directory = await mkdtemp(join(tmpdir(), 'jpegxl-m7-lossless-reference-'))
  const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
  try {
    // Synthetic oracle records isolate reference selection. Codec conformance has separate fixtures.
    const pixels = new Uint8Array(entry.width * entry.height * 3)
    const sink = new Uint8ArraySink()
    const encoder = await createJpegXlModularEncoder(sink, {
      width: entry.width,
      height: entry.height,
      pixelFormat: 'rgb8',
      colorSemantics: {
        family: 'rgb',
        primaries: 'srgb',
        transfer: { kind: 'srgb' },
        matrix: 'identity',
        range: 'full',
        alpha: 'none',
        provenance: 'assumed-default',
        renderingIntent: 'relative',
      },
      options: { effort: 1 },
    })
    await encoder.write({
      x: 0,
      y: 0,
      width: entry.width,
      height: entry.height,
      format: 'rgb8',
      stride: entry.width * 3,
      data: pixels,
    })
    await encoder.finish()
    const encoded = sink.toUint8Array()
    const normalizedHash = hash(pixels)
    const point = {
      id: entry.id,
      sourceSha256: entry.sourceSha256,
      width: entry.width,
      height: entry.height,
      status: 'verified',
      pureBytes: encoded.length,
      encodedSha256: hash(encoded),
      normalizedHash,
      oracles: ['libjxl', 'jxl-rs'].map((oracle) => ({
        oracle,
        exact: true,
        decodedHash: normalizedHash,
      })),
    }
    const reports = join(directory, 'benchmark/jpegxl/production-program')
    const artifacts = join(directory, '.tmp/jpegxl-m7')
    const current = join(artifacts, 'lossless-development-typed-palette-034-snapshot')
    const obsolete = join(artifacts, 'lossless-development-single-cache-031-snapshot')
    const output = join(artifacts, 'lossless-decoding-reference-fixture')
    for (const path of [reports, current, obsolete, output]) await mkdir(path, { recursive: true })
    await writeFile(join(current, `${entry.id}-pure-e7.jxl`), encoded)
    await writeFile(
      join(reports, 'm7-lossless-development-typed-palette.json'),
      JSON.stringify({ results: [point] }),
    )
    const stale = Uint8Array.of(0)
    await writeFile(join(obsolete, `${entry.id}-pure-e7.jxl`), stale)
    await writeFile(
      join(reports, 'm7-lossless-development-single-cache.json'),
      JSON.stringify({
        results: [{ ...point, pureBytes: stale.length, encodedSha256: hash(stale) }],
      }),
    )
    const run = spawnSync(
      process.execPath,
      [resolve('benchmark/jpegxl/verify-m7-lossless-decoding.ts'), 'reference-fixture', entry.id],
      { cwd: directory, encoding: 'utf8', timeout: 20_000 },
    )
    expect(run.error).toBeUndefined()
    expect(run.status, run.stderr).toBe(0)
    const report: unknown = JSON.parse(await readFile(join(output, `${entry.id}.json`), 'utf8'))
    expect(report).toMatchObject({
      status: 'passed',
      ownExact: true,
      samples: pixels.length,
      encodedSha256: point.encodedSha256,
      decodedSha256: normalizedHash,
      independentReport:
        'benchmark/jpegxl/production-program/m7-lossless-development-typed-palette.json',
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
