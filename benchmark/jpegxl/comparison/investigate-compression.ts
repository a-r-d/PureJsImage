/** Development-only compression diagnosis. Keeps the frozen comparison unchanged. */
import { mkdir, readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { JpegXlCodestreamSource } from '../../../src/codecs/jpegxl-container.ts'
import { readJpegXlSourceFrameStructures } from '../../../src/codecs/jpegxl-decode.ts'
import { inspectJpegXl } from '../../../src/jpegxl.ts'
import { defaultImageLimits } from '../../../src/limits.ts'
import { MemorySource } from '../../../src/source.ts'
import { inspectJpegXlVarDctStrategyIds } from '../inspect-vardct-strategies.ts'
import {
  fixtures,
  hash,
  implementationIdentity,
  json,
  metrics,
  oracle,
  pnm,
  raw,
  root,
  run,
  work,
} from './io.ts'
import { number, object, string } from './model.ts'

const output = process.argv[2]
if (!output) throw new Error('Usage: node investigate-compression.ts report.json')
const refine = process.argv[3] === '--refine'
const verifyOnly = process.argv[3] === '--verify-only'
if (process.argv[3] !== undefined && !refine && !verifyOnly)
  throw new Error('Unknown diagnostic mode')
const directory = `${work}/compression-investigation`
await mkdir(directory, { recursive: true })
const identity = await implementationIdentity()
const fixtureBytes = await readFile(`${root}/fixtures.json`)
const fixtureManifest = object(JSON.parse(fixtureBytes.toString('utf8')))
if (hash(await readFile(`${oracle}/cjxl`)) !== fixtureManifest.oracleSha256)
  throw new Error('Pinned native encoder identity changed')
const originalReport = object(JSON.parse(await readFile(`${root}/results/main-node.json`, 'utf8')))
if (identity.implementationSourceSha256 !== originalReport.implementationSourceSha256)
  throw new Error('Codec source differs from the comparison being investigated')
const originalRows = originalReport.rows
if (!Array.isArray(originalRows)) throw new Error('Missing original comparison rows')

const rows: Record<string, unknown>[] = []
const qualityRows: Record<string, unknown>[] = []
if (refine || verifyOnly) {
  const previous = object(JSON.parse(await readFile(output, 'utf8')))
  if (
    previous.implementationSourceSha256 !== identity.implementationSourceSha256 ||
    previous.fixturesSha256 !== hash(fixtureBytes) ||
    !Array.isArray(previous.rows)
  )
    throw new Error('Cannot refine a different diagnostic source or fixture set')
  rows.push(...previous.rows.map(object))
}
const report = async () =>
  json(output, {
    schemaVersion: 1,
    date: new Date().toISOString(),
    ...identity,
    runtime: process.version,
    fixturesSha256: hash(fixtureBytes),
    oracle: {
      version: run(`${oracle}/cjxl`, ['--version']).trim(),
      cjxlSha256: hash(await readFile(`${oracle}/cjxl`)),
      djxlSha256: hash(await readFile(`${oracle}/djxl`)),
      ssimulacra2Sha256: hash(await readFile(`${metrics}/ssimulacra2`)),
      butteraugliSha256: hash(await readFile(`${metrics}/butteraugli_main`)),
    },
    timingScope:
      'Single isolated observations, not speed ratios. Public RGBA timings include adapter initialization; first-party RGB timings cover encode/output after initialization; native timings include executable startup. Validation and metrics excluded.',
    rows,
    qualityRows,
  })

const inspect = async (path: string) => {
  const bytes = await readFile(path)
  const inspection = await inspectJpegXl(bytes)
  return {
    bytes: bytes.length,
    sha256: hash(bytes),
    containerOverheadBytes: bytes.length - inspection.codestreamBytes,
    ...inspection,
  }
}

for (const fixture of (await fixtures()).filter((f) =>
  ['im26-1416-original', 'im26-8160-original', 'im26-1030-diagnostic'].includes(f.id),
)) {
  const pixels = await raw(fixture)
  if (!(pixels.data instanceof Uint8Array) || pixels.channels !== 4)
    throw new Error('Expected pinned RGBA8 input')
  const expectedRgba = pixels.data
  for (let i = 3; i < pixels.data.length; i += 4)
    if (pixels.data[i] !== 255) throw new Error('RGB control requires completely opaque alpha')
  const sourceBytes = await readFile(fixture.source)
  if (hash(sourceBytes) !== fixture.sourceSha256) throw new Error('Pinned PPM identity changed')
  const rgb = pnm(sourceBytes)
  if (
    !(rgb.data instanceof Uint8Array) ||
    rgb.channels !== 3 ||
    rgb.width !== fixture.width ||
    rgb.height !== fixture.height
  )
    throw new Error('PPM control shape mismatch')
  for (let i = 0; i < fixture.width * fixture.height; i++)
    for (let c = 0; c < 3; c++)
      if (rgb.data[i * 3 + c] !== pixels.data[i * 4 + c])
        throw new Error('RGB/RGBA control sample mismatch')

  const verify = async (path: string, id: string, requireAlpha: boolean) => {
    const decodedPath = `${directory}/${id}.png`
    run(`${oracle}/djxl`, [path, decodedPath, '--num_threads=0', '--bits_per_sample=8'])
    const decoded = await sharp(decodedPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (
      decoded.info.width !== fixture.width ||
      decoded.info.height !== fixture.height ||
      decoded.info.channels !== 4 ||
      !decoded.data.equals(expectedRgba)
    )
      throw new Error(`Independent exact RGBA validation failed: ${id}`)
    const structure = await inspect(path)
    if (requireAlpha && structure.alphaChannels !== 1) throw new Error('Alpha channel dropped')
    return {
      ...structure,
      decodedRgbaSha256: hash(decoded.data),
      maximumSampleError: 0,
      samplesCompared: pixels.data.length,
    }
  }

  if (verifyOnly) {
    for (const row of rows.filter((r) => r.fixture === fixture.id)) {
      const path = string(row.artifact)
      if (hash(await readFile(path)) !== row.sha256)
        throw new Error('Diagnostic artifact identity changed')
      if (row.input !== 'rgba8' && row.input !== 'rgb8-opaque-control')
        throw new Error('Invalid diagnostic input contract')
      Object.assign(
        row,
        await verify(path, `${fixture.id}-${string(row.variant)}-verify`, row.input === 'rgba8'),
      )
    }
    continue
  }

  if (!refine) {
    for (const subject of ['purejsimage', 'jsquash', 'vips']) {
      const key = `${fixture.id}-${subject}-encode-ll-e1`
      const saved = originalRows.map(object).find((r) => r.key === key)
      if (saved?.status !== 'verified')
        throw new Error('Missing independently verified original row')
      const path = string(saved.artifact)
      const expected = object(saved.output)
      if (hash(await readFile(path)) !== expected.sha256)
        throw new Error('Original artifact hash mismatch')
      rows.push({
        fixture: fixture.id,
        variant: `${subject}-frozen-e1`,
        input: 'rgba8',
        artifact: path,
        settings: saved.settings,
        ...(await verify(path, key, true)),
      })
    }

    for (const effort of [1, 3, 7]) {
      const id = `${fixture.id}-purejsimage-rgba-e${effort}`
      const prefix = `${directory}/${id}`
      const config = `${prefix}-job.json`
      await json(config, {
        subject: 'purejsimage',
        operation: 'encode',
        fixture,
        settings: { lossless: true, effort, value: 1 },
        repeats: 0,
        output: prefix,
      })
      console.log(`encode ${id}`)
      run(process.execPath, [`${root}/node-worker.ts`, config])
      const measurement = object(JSON.parse(await readFile(`${prefix}.json`, 'utf8')))
      if (measurement.status !== 'verified') throw new Error(`Encode failed: ${id}`)
      const descriptor = object(measurement.output)
      if (effort === 1) {
        const original = originalRows
          .map(object)
          .find((r) => r.key === `${fixture.id}-purejsimage-encode-ll-e1`)
        if (!original || object(original.output).sha256 !== descriptor.sha256)
          throw new Error('Effort-1 reproduction changed bytes')
      }
      rows.push({
        fixture: fixture.id,
        variant: `purejsimage-rgba-e${effort}`,
        input: 'rgba8',
        artifact: `${prefix}.bin`,
        settings: { effort, lossless: true },
        encodeMilliseconds: measurement.coldMs,
        memory: measurement.memory,
        ...(await verify(`${prefix}.bin`, id, true)),
      })
      await report()
    }

    // RGB control quantifies the effect of the constant alpha plane on entropy modeling.
    for (const effort of fixture.scope === 'original' ? [1, 7] : [1]) {
      const id = `${fixture.id}-purejsimage-rgb-e${effort}`
      const path = `${directory}/${id}.jxl`
      console.log(`encode ${id}`)
      const measurement = object(
        JSON.parse(
          run(process.execPath, [
            '--expose-gc',
            'benchmark/jpegxl/measure-m7-lossless.ts',
            fixture.source,
            path,
            String(effort),
          ]),
        ),
      )
      rows.push({
        fixture: fixture.id,
        variant: `purejsimage-rgb-e${effort}`,
        input: 'rgb8-opaque-control',
        artifact: path,
        settings: { effort, lossless: true },
        encodeMilliseconds: measurement.encodeOutputMilliseconds,
        peakRssBytes: measurement.peakRssBytes,
        groupSearchEvidence: measurement.groupSearchEvidence,
        ...(await verify(path, id, false)),
      })
      await report()
    }
  }

  if (fixture.scope === 'original') {
    for (const subject of ['jsquash', 'vips']) {
      for (const effort of [3, 7]) {
        const id = `${fixture.id}-${subject}-rgba-e${effort}`
        if (
          refine &&
          rows.some(
            (row) => row.fixture === fixture.id && row.variant === `${subject}-rgba-e${effort}`,
          )
        )
          continue
        const prefix = `${directory}/${id}`
        const config = `${prefix}-job.json`
        await json(config, {
          subject,
          operation: 'encode',
          fixture,
          settings: { lossless: true, effort, value: 1 },
          repeats: 0,
          output: prefix,
        })
        console.log(`encode ${id}`)
        run(process.execPath, [`${root}/node-worker.ts`, config])
        const measurement = object(JSON.parse(await readFile(`${prefix}.json`, 'utf8')))
        if (measurement.status !== 'verified') throw new Error(`Encode failed: ${id}`)
        rows.push({
          fixture: fixture.id,
          variant: `${subject}-rgba-e${effort}`,
          input: 'rgba8',
          artifact: `${prefix}.bin`,
          settings: { effort, lossless: true },
          encodeMilliseconds: measurement.coldMs,
          memory: measurement.memory,
          ...(await verify(`${prefix}.bin`, id, true)),
        })
        await report()
      }
    }
  }

  const controls = [
    { id: 'default-e1', args: ['-e', '1'] },
    { id: 'default-e3', args: ['-e', '3'] },
    { id: 'default-e7', args: ['-e', '7'] },
    { id: 'no-rct-e3', args: ['-e', '3', '-C', '0'] },
    { id: 'left-e3', args: ['-e', '3', '-P', '1'] },
    { id: 'no-learned-tree-e3', args: ['-e', '3', '-I', '0'] },
    {
      id: 'left-no-rct-no-tree-e3',
      args: [
        '-e',
        '3',
        '-P',
        '1',
        '-C',
        '0',
        '-I',
        '0',
        '-g',
        '3',
        '-X',
        '0',
        '-Y',
        '0',
        '--modular_palette_colors=0',
        '-R',
        '0',
      ],
    },
    { id: 'group1024-e7', args: ['-e', '7', '-g', '3'] },
    { id: 'ycocg-e7', args: ['-e', '7', '-C', '6'] },
    { id: 'left-e7', args: ['-e', '7', '-P', '1'] },
    { id: 'no-learned-tree-e7', args: ['-e', '7', '-I', '0'] },
    { id: 'no-rct-e7', args: ['-e', '7', '-C', '0'] },
    { id: 'group1024-no-learned-tree-e7', args: ['-e', '7', '-g', '3', '-I', '0'] },
    { id: 'group1024-ycocg-e7', args: ['-e', '7', '-g', '3', '-C', '6'] },
  ]
  for (const control of controls.filter(
    (control) => !refine || (!control.id.endsWith('e3') && !control.id.startsWith('default')),
  )) {
    if (
      refine &&
      rows.some((row) => row.fixture === fixture.id && row.variant === `native-rgb-${control.id}`)
    )
      continue
    const id = `${fixture.id}-native-rgb-${control.id}`
    const path = `${directory}/${id}.jxl`
    const args = [
      fixture.source,
      path,
      '-d',
      '0',
      '--num_threads=0',
      '--container=0',
      ...control.args,
    ]
    console.log(`encode ${id}`)
    const started = performance.now()
    run(`${oracle}/cjxl`, args)
    const elapsed = performance.now() - started
    rows.push({
      fixture: fixture.id,
      variant: `native-rgb-${control.id}`,
      input: 'rgb8-opaque-control',
      artifact: path,
      command: ['cjxl', ...args],
      encodeMilliseconds: elapsed,
      ...(await verify(path, id, false)),
    })
    await report()
  }
}

// Rescore and inspect the four existing artifacts behind the only adequate lossy match.
const website = object(JSON.parse(await readFile(`${root}/website-data.json`, 'utf8')))
if (!Array.isArray(website.qualityComparisons)) throw new Error('Missing quality comparisons')
const match = website.qualityComparisons
  .map(object)
  .find((r) => r.status === 'measured with adequate brackets')
if (match?.fixture !== 'im26-1030-diagnostic' || match.subject !== 'vips')
  throw new Error('Matched-quality example changed')
for (const [subject, field] of [
  ['purejsimage', 'pureBracket'],
  ['vips', 'otherBracket'],
] as const) {
  const bracket = object(object(match[field]).bracket)
  for (const side of ['lower', 'upper']) {
    const point = object(bracket[side])
    const path = string(point.artifact)
    const bytes = await readFile(path)
    if (hash(bytes) !== point.artifactSha256) throw new Error('Lossy artifact hash mismatch')
    const decodedPath = `${directory}/photo-${subject}-${side}.png`
    run(`${oracle}/djxl`, [path, decodedPath, '--num_threads=0', '--bits_per_sample=8'])
    const decoded = await sharp(decodedPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (decoded.info.width !== 1024 || decoded.info.height !== 768 || decoded.info.channels !== 4)
      throw new Error('Lossy comparison output shape changed')
    for (let i = 3; i < decoded.data.length; i += 4)
      if (decoded.data[i] !== 255) throw new Error('Opaque lossy comparison alpha changed')
    const score = Number.parseFloat(
      run(`${metrics}/ssimulacra2`, [
        `${work}/quality/im26-1030-diagnostic-black-source.png`,
        decodedPath,
      ]),
    )
    const butteraugli = Number.parseFloat(
      run(`${metrics}/butteraugli_main`, [
        `${work}/quality/im26-1030-diagnostic-black-source.png`,
        decodedPath,
      ]),
    )
    if (
      !Number.isFinite(score) ||
      !Number.isFinite(butteraugli) ||
      Math.abs(score - number(point.score)) > 0.00001 ||
      Math.abs(butteraugli - number(point.butteraugli)) > 0.00001
    )
      throw new Error('Recorded quality scores did not reproduce')
    const inspection = await inspect(path)
    const source = new MemorySource(bytes)
    const logical = new JpegXlCodestreamSource(source, inspection)
    const frames = await readJpegXlSourceFrameStructures(logical, defaultImageLimits)
    qualityRows.push({
      subject,
      side,
      artifact: path,
      setting: point.setting,
      ssimulacra2: score,
      butteraugli,
      opaqueAlphaVerified: true,
      ...inspection,
      strategies: await inspectJpegXlVarDctStrategyIds(logical, frames),
      frameTools: frames.map((f) => ({
        gaborish: f.gaborish,
        epfIterations: f.epfIterations,
        passCount: f.passCount,
        sectionBytes: f.sections.map((s) => s.length),
      })),
    })
    await report()
  }
}
await report()
console.log(`Verified ${rows.length} lossless controls and ${qualityRows.length} lossy artifacts`)
