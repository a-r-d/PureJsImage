/** Native first-pass and independent final-image checks on real development sources. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { createJpegXlModularEncoder } from '../../src/codecs/jpegxl-modular-encode.ts'
import { openJpegXlSession } from '../../src/jpegxl.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import selection from './production-program/m7-corpus-selection.json' with { type: 'json' }

const [runId, caseId] = process.argv.slice(2)
if (!runId || !/^[a-z0-9-]+$/u.test(runId)) throw new Error('Expected a unique run identifier')
const directory = `.tmp/jpegxl-m7/real-stages-${runId}`
const ids = [
  'im26-1030',
  'im26-1214',
  'im26-1466',
  'im26-1612',
  'im26-2026',
  'im26-2400',
  'im26-5032',
  'im26-6800',
]
const native = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/djxl'
const rust = '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli'
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const run = (tool: string, args: readonly string[]): void => {
  const result = spawnSync(tool, args, { encoding: 'utf8', timeout: 600_000, maxBuffer: 4_194_304 })
  if (result.status !== 0) throw new Error(`${tool}: ${result.stderr}; ${result.error ?? ''}`)
}
const ppm = (bytes: Uint8Array, width: number, height: number): Uint8Array => {
  const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/u.exec(
    new TextDecoder().decode(bytes.subarray(0, 100)),
  )
  if (
    !header ||
    Number(header[1]) !== width ||
    Number(header[2]) !== height ||
    bytes.length !== header[0].length + width * height * 3
  )
    throw new Error('Independent raster extent mismatch')
  return bytes.subarray(header[0].length)
}

if (caseId === undefined) {
  await mkdir(directory, { recursive: false })
  const source: { name: string; sha256: string }[] = []
  for (const name of (
    await readdir(new URL('../../src/', import.meta.url), { recursive: true })
  ).sort())
    if (name.endsWith('.ts'))
      source.push({
        name,
        sha256: hash(await readFile(new URL(`../../src/${name}`, import.meta.url))),
      })
  await writeFile(
    `${directory}/protocol.json`,
    `${JSON.stringify(
      {
        startedAt: new Date().toISOString(),
        ids,
        scope:
          'Eight already observed development families, native stored dimensions, canonical sRGB RGB8 via pinned Sharp. Effort 7, distance 3, two progressive passes. This is interoperability evidence, not held-out quality evidence.',
        policy:
          'Compare the first pass at full and center-sampled half resolution against native djxl downsampling=2. Compare the final full-size image against native djxl and jxl-rs. Maximum RGB8 difference 2 and RMSE 0.55, unchanged from procedural first-pass checks. Preserve every failure. Each source runs in a fresh serial process.',
        sharp: sharp.versions,
        source,
        harnessSha256: hash(await readFile(import.meta.filename)),
        tools: await Promise.all(
          [native, rust].map(async (path) => ({ path, sha256: hash(await readFile(path)) })),
        ),
      },
      null,
      2,
    )}\n`,
  )
  const results: unknown[] = []
  let failures = 0
  for (const id of ids) {
    const result = spawnSync(process.execPath, [import.meta.filename, runId, id], {
      stdio: 'inherit',
      timeout: 1_200_000,
    })
    if (result.status !== 0) failures++
    try {
      results.push(JSON.parse(await readFile(`${directory}/${id}/report.json`, 'utf8')))
    } catch (error) {
      if (result.status === 0) failures++
      results.push({ id, status: 'failed', error: String(error), processStatus: result.status })
    }
    console.log(`${results.length}/${ids.length} real progressive sources; ${failures} failures`)
  }
  await writeFile(`${directory}/report.json`, `${JSON.stringify({ failures, results }, null, 2)}\n`)
  process.exitCode = failures === 0 ? 0 : 1
} else {
  if (!ids.includes(caseId)) throw new Error('Source is outside the declared cohort')
  const entry = selection.cases.find(
    (value) => value.id === caseId && value.split === 'development',
  )
  if (!entry) throw new Error('Missing frozen source identity')
  const path = `${directory}/${caseId}`
  await mkdir(path, { recursive: false })
  const results: object[] = []
  try {
    sharp.concurrency(1)
    const original = await readFile(`.tmp/jpegxl-m7/sources/${entry.id}.${entry.format}`)
    if (hash(original) !== entry.sourceSha256) throw new Error('Source hash mismatch')
    const { data, info } = await sharp(original)
      .withIccProfile('srgb')
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const { width, height } = entry
    if (info.width !== width || info.height !== height || info.channels !== 3)
      throw new Error('Canonical raster extent changed')
    const sink = new Uint8ArraySink()
    const encoder = await createJpegXlModularEncoder(sink, {
      width,
      height,
      pixelFormat: 'rgb8',
      colorSemantics: {
        family: 'rgb',
        primaries: 'srgb',
        transfer: { kind: 'srgb' },
        matrix: 'identity',
        range: 'full',
        alpha: 'none',
        provenance: 'decoder-converted',
        renderingIntent: 'relative',
      },
      options: { mode: 'lossy', effort: 7, distance: 3, progressive: true },
    })
    await encoder.write({ x: 0, y: 0, width, height, stride: width * 3, format: 'rgb8', data })
    await encoder.finish()
    const encoded = sink.toUint8Array()
    await writeFile(`${path}/output.jxl`, encoded)
    for (const pass of [1, 2] as const) {
      run(native, [
        `${path}/output.jxl`,
        `${path}/pass-${pass}.ppm`,
        `--downsampling=${pass === 1 ? 2 : 1}`,
        '--num_threads=1',
        '--bits_per_sample=8',
      ])
      const expected = ppm(await readFile(`${path}/pass-${pass}.ppm`), width, height)
      for (const scale of pass === 1 ? ([1, 2] as const) : ([1] as const)) {
        const session = await openJpegXlSession(encoded)
        let maximum = 0,
          squared = 0,
          samples = 0,
          completed = 0
        try {
          for await (const event of session.decode({ until: pass, scaleDenominator: scale })) {
            if (event.type === 'stage-complete' && event.stage.completedPasses === pass) completed++
            if (event.type !== 'block') continue
            const block = event.block
            try {
              // Earlier revisions are valid events but are not samples of the requested pass.
              if (event.stage.completedPasses !== pass) continue
              if (block.format !== 'rgb8') throw new Error('Unexpected stage pixel format')
              for (let y = 0; y < block.height; y++)
                for (let x = 0; x < block.width; x++) {
                  const sourceY = Math.min(
                    height - 1,
                    (block.y + y) * scale + Math.floor(scale / 2),
                  )
                  const sourceX = Math.min(width - 1, (block.x + x) * scale + Math.floor(scale / 2))
                  for (let channel = 0; channel < 3; channel++) {
                    const delta = Math.abs(
                      (expected[(sourceY * width + sourceX) * 3 + channel] ?? -1000) -
                        (block.data[y * block.stride + x * 3 + channel] ?? 1000),
                    )
                    maximum = Math.max(maximum, delta)
                    squared += delta * delta
                    samples++
                  }
                }
            } finally {
              block.release?.()
            }
          }
          const rmse = Math.sqrt(squared / samples)
          if (
            completed !== 1 ||
            samples !== Math.ceil(width / scale) * Math.ceil(height / scale) * 3 ||
            maximum > 2 ||
            rmse > 0.55
          )
            throw new Error(
              `Pass ${pass}, scale ${scale}: max ${maximum}, RMSE ${rmse}, samples ${samples}, completed ${completed}`,
            )
          results.push({
            pass,
            scale,
            maximum,
            rmse,
            samples,
            oracleSha256: hash(expected),
            sourceSectionBytes: session.sourceSectionBytes,
          })
        } finally {
          await session.close()
        }
      }
      if (pass === 2) {
        run(rust, [
          `${path}/output.jxl`,
          `${path}/rust.ppm`,
          '--num-threads',
          '1',
          '--data-type',
          'u8',
        ])
        const actual = ppm(await readFile(`${path}/rust.ppm`), width, height)
        let maximum = 0,
          squared = 0
        for (let index = 0; index < expected.length; index++) {
          const delta = Math.abs((expected[index] ?? -1000) - (actual[index] ?? 1000))
          maximum = Math.max(maximum, delta)
          squared += delta * delta
        }
        const rmse = Math.sqrt(squared / expected.length)
        if (maximum > 2 || rmse > 0.55) throw new Error(`Rust final mismatch: ${maximum}, ${rmse}`)
        results.push({ decoder: 'jxl-rs', pass, maximum, rmse, oracleSha256: hash(actual) })
      }
    }
    await writeFile(
      `${path}/report.json`,
      `${JSON.stringify({ id: caseId, status: 'passed', sourceSha256: entry.sourceSha256, normalizedSha256: hash(data), encodedSha256: hash(encoded), width, height, results }, null, 2)}\n`,
    )
  } catch (error) {
    await writeFile(
      `${path}/report.json`,
      `${JSON.stringify({ id: caseId, status: 'failed', error: String(error), results }, null, 2)}\n`,
    )
    process.exitCode = 1
  }
}
