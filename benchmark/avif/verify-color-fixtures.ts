import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import sharp from 'sharp'
import { allCodecs } from '../../src/codec-entries/all.ts'
import { inspectAvifBitstreams } from '../../src/codecs/avif.ts'
import { createNodeImageLibrary } from '../../src/node-image.ts'
import { MemorySource } from '../../src/source.ts'
import {
  avifColorFixtureDirectory,
  avifColorFixturePath,
  avifHdrChromaDerivedFixture,
  avifHdrToneMapFixtures,
  avifHdrGainMapFixture,
  avifIccFixtures,
  avifRec2020Fixture,
  avifWrongAlternativeGainMapFixture,
  type AvifColorFixture,
} from './color-fixtures.ts'

const Image = createNodeImageLibrary(allCodecs)
const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

interface Difference {
  readonly maximum: number
  readonly p95: number
  readonly psnr: number
  readonly rootMeanSquare: number
  readonly mean: number
}

const difference = (actual: Uint8Array, expected: Uint8Array): Difference => {
  if (actual.byteLength !== expected.byteLength) throw new Error('Color oracle dimensions differ')
  let maximum = 0
  let total = 0
  let squareTotal = 0
  const errors = new Uint8Array((actual.byteLength / 4) * 3)
  let samples = 0
  for (let offset = 0; offset < actual.byteLength; offset += 1) {
    if (offset % 4 === 3) continue
    const delta = Math.abs((actual[offset] ?? 0) - (expected[offset] ?? 0))
    maximum = Math.max(maximum, delta)
    total += delta
    squareTotal += delta * delta
    errors[samples] = delta
    samples += 1
  }
  errors.sort()
  const rootMeanSquare = Math.sqrt(squareTotal / samples)
  return {
    maximum,
    mean: total / samples,
    p95: errors[Math.ceil(samples * 0.95) - 1] ?? 255,
    psnr: 20 * Math.log10(255 / rootMeanSquare),
    rootMeanSquare,
  }
}

const decodePure = async (fixture: AvifColorFixture): Promise<Uint8Array> => {
  const input = new Uint8Array(await readFile(avifColorFixturePath(fixture)))
  if (sha256(input) !== fixture.fileSha256) throw new Error(`${fixture.file} checksum changed`)
  const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())
  if (output.width !== fixture.width || output.height !== fixture.height) {
    throw new Error(`${fixture.file} dimensions changed`)
  }
  if (sha256(output.data) !== fixture.rgbaSha256) {
    throw new Error(`${fixture.file} decoded RGBA checksum changed`)
  }
  return output.data
}

const run = (application: string, args: readonly string[]): void => {
  const result = spawnSync(application, args, { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${application} failed: ${result.stderr || result.stdout}`)
  }
}

const writePqOracle = (input: string, output: string, colorSetup = ''): void => {
  const graph =
    (colorSetup ? `${colorSetup},` : '') +
    `zscale=t=linear:npl=203,format=gbrpf32le,` +
    `tonemap=tonemap=reinhard:desat=0:peak=${10_000 / 203},` +
    `zscale=p=bt709:t=iec61966-2-1:m=gbr:r=pc,format=rgba`
  run('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    input,
    '-vf',
    graph,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    output,
  ])
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-color-oracles-'))
try {
  const rec2020 = await decodePure(avifRec2020Fixture)
  const rec2020OraclePath = join(temporaryDirectory, 'rec2020.rgba')
  run('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    avifColorFixturePath(avifRec2020Fixture),
    '-vf',
    'zscale=pin=bt2020:tin=linear:min=smpte170m:p=bt2020:t=linear:m=gbr,format=gbrpf32le,zscale=pin=bt2020:tin=linear:min=gbr:p=bt709:t=iec61966-2-1:m=gbr,format=rgba',
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    rec2020OraclePath,
  ])
  const rec2020Difference = difference(rec2020, await readFile(rec2020OraclePath))
  if (rec2020Difference.maximum > 13 || rec2020Difference.mean > 0.5) {
    throw new Error(`BT.2020 output differs from FFmpeg/zimg: ${JSON.stringify(rec2020Difference)}`)
  }

  const hdrResults: Array<{ readonly fixture: string; readonly difference: Difference }> = []
  const hlgRegression: string[] = []
  for (const fixture of avifHdrToneMapFixtures) {
    const actual = await decodePure(fixture)
    if (fixture.transferCharacteristics === 18) {
      hlgRegression.push(fixture.file)
      continue
    }
    const fixturePath = avifColorFixturePath(fixture)
    let oracleInput = fixturePath
    let colorSetup = ''
    if (fixture.matrixCoefficients === 0) {
      oracleInput = join(temporaryDirectory, `${fixture.file}.libavif.png`)
      run('avifdec', ['--depth', '16', fixturePath, oracleInput])
      colorSetup = 'setparams=color_primaries=bt2020:color_trc=smpte2084'
    }
    const generatedOraclePath = join(temporaryDirectory, `${fixture.file}.rgba`)
    writePqOracle(oracleInput, generatedOraclePath, colorSetup)
    const generatedOracle = await readFile(generatedOraclePath)
    const storedOracleInput = await readFile(join(avifColorFixtureDirectory, fixture.oracleFile))
    if (sha256(storedOracleInput) !== fixture.oracleSha256) {
      throw new Error(`${fixture.oracleFile} checksum changed`)
    }
    const storedOracle = PNG.sync.read(storedOracleInput)
    if (storedOracle.width !== fixture.width || storedOracle.height !== fixture.height) {
      throw new Error(`${fixture.oracleFile} dimensions changed`)
    }
    const storedDifference = difference(storedOracle.data, generatedOracle)
    if (storedDifference.maximum !== 0) {
      throw new Error(
        `${fixture.oracleFile} differs from regenerated FFmpeg/zimg pixels: ` +
          JSON.stringify(storedDifference),
      )
    }
    const hdrDifference = difference(actual, generatedOracle)
    if (
      hdrDifference.maximum > fixture.maximumAbsoluteError ||
      hdrDifference.mean > fixture.maximumMeanAbsoluteError ||
      hdrDifference.p95 > fixture.maximumP95AbsoluteError ||
      hdrDifference.psnr < fixture.minimumPsnr
    ) {
      throw new Error(`${fixture.file} differs from FFmpeg/zimg: ${JSON.stringify(hdrDifference)}`)
    }
    hdrResults.push({ fixture: fixture.file, difference: hdrDifference })
  }

  const chromaDerived = await decodePure(avifHdrChromaDerivedFixture)
  const chromaDerivedOraclePath = join(temporaryDirectory, 'chroma-derived.rgba')
  writePqOracle(avifColorFixturePath(avifHdrChromaDerivedFixture), chromaDerivedOraclePath)
  const chromaDerivedDifference = difference(chromaDerived, await readFile(chromaDerivedOraclePath))
  if (chromaDerivedDifference.maximum > avifHdrChromaDerivedFixture.maximumAbsoluteError) {
    throw new Error(
      `Chroma-derived HDR output differs from FFmpeg/zimg: ` +
        JSON.stringify(chromaDerivedDifference),
    )
  }

  const hdrGainMap = await decodePure(avifHdrGainMapFixture)
  const gainMapOraclePath = join(temporaryDirectory, 'gain-map.png')
  run('avifgainmaputil', [
    'tonemap',
    avifColorFixturePath(avifHdrGainMapFixture),
    gainMapOraclePath,
    '--headroom',
    '0',
  ])
  const gainMapOracle = PNG.sync.read(await readFile(gainMapOraclePath)).data
  const gainMapDifference = difference(hdrGainMap, gainMapOracle)
  if (gainMapDifference.maximum > 4 || gainMapDifference.mean > 1) {
    throw new Error(`Gain-map output differs from libavif: ${JSON.stringify(gainMapDifference)}`)
  }

  for (const fixture of avifIccFixtures) {
    const actual = await decodePure(fixture)
    const input = await readFile(avifColorFixturePath(fixture))
    const oracle = await sharp(input).toColourspace('srgb').ensureAlpha().raw().toBuffer()
    const iccDifference = difference(actual, oracle)
    if (iccDifference.maximum !== 0) {
      throw new Error(
        `${fixture.file} differs from Sharp/libvips: ${JSON.stringify(iccDifference)}`,
      )
    }
  }

  const wrongAlternative = new Uint8Array(
    await readFile(avifColorFixturePath(avifWrongAlternativeGainMapFixture)),
  )
  if (sha256(wrongAlternative) !== avifWrongAlternativeGainMapFixture.fileSha256) {
    throw new Error(`${avifWrongAlternativeGainMapFixture.file} checksum changed`)
  }
  if ((await inspectAvifBitstreams(new MemorySource(wrongAlternative))).gainMap) {
    throw new Error('A non-preferred tmap was treated as an active gain map')
  }

  console.log(
    JSON.stringify({
      fixtures: 6 + avifHdrToneMapFixtures.length,
      oracles: [
        'FFmpeg/zimg',
        'libavif plus FFmpeg/zimg',
        'libavif avifgainmaputil',
        'Sharp/libvips',
      ],
      rec2020: rec2020Difference,
      hdr: hdrResults,
      hlgRegression,
      chromaDerived: chromaDerivedDifference,
      gainMap: gainMapDifference,
      iccTolerance: 0,
    }),
  )
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
