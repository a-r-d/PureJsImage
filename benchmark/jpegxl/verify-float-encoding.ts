/** Independent C API decoding of ordinary-pipeline float32 output, including ICC and HDR. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createImageLibrary } from '../../src/browser.ts'
import type { DecoderOptions } from '../../src/codec.ts'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'
import composed from '../../tests/fixtures/jpegxl/composed-native/manifest.json' with {
  type: 'json',
}
import colorManifest from '../../tests/fixtures/jpegxl/float-color/manifest.json' with {
  type: 'json',
}
import completionManifest from '../../tests/fixtures/jpegxl/float-completion/manifest.json' with {
  type: 'json',
}
import { collectJpegXlProfileRows } from '../../tests/helpers/jpegxl-profile-pipeline.ts'

const work = resolve('.tmp/jpegxl-float-encoding-oracle')
await mkdir(work, { recursive: true })
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const Image = createImageLibrary({ codecs: [jpegxlCodec] }),
  results = []
const fixtures = [
  ...colorManifest.fixtures.map((fixture) => ({
    ...fixture,
    directory: 'float-color',
    category: 'float',
  })),
  ...completionManifest.fixtures.map((fixture) => ({ ...fixture, directory: 'float-completion' })),
  ...composed.fixtures
    .filter((fixture) => fixture.category !== 'cmyk')
    .map((fixture) => ({ ...fixture, directory: 'composed-native' })),
]
for (const fixture of fixtures)
  for (const hdrOutput of fixture.category === 'hdr'
    ? (['linear-float', 'encoded'] as const)
    : (['encoded'] as const)) {
    const input = new Uint8Array(
      await readFile(`tests/fixtures/jpegxl/${fixture.directory}/${fixture.file}`),
    )
    const options: DecoderOptions = {
      colorOutput: 'preserve',
      ...('animation' in fixture && fixture.animation ? { frame: fixture.frame } : {}),
      ...(fixture.category === 'hdr' ? { hdrOutput } : {}),
    }
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(input),
      defaultImageLimits,
      options,
    )
    if (!decoder?.pixelFormat.endsWith('f32'))
      throw new Error('Encoding oracle requires float source rows')
    const expected = await collectJpegXlProfileRows(decoder)
    const image = await Image.open(input, options)
    const encoded = await (fixture.category === 'icc' ? image.keepIcc() : image)
      .jpegxl()
      .toUint8Array()
    const directory = `${work}/${fixture.id}-${hdrOutput}`
    await mkdir(directory, { recursive: true })
    await writeFile(`${directory}/encoded.jxl`, encoded)
    execFileSync(
      'bun',
      [
        'benchmark/jpegxl/flush-progressive-oracle.ts',
        `${directory}/encoded.jxl`,
        directory,
        'native-float32',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const native: unknown = JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'))
    if (
      !record(native) ||
      native.width !== fixture.width ||
      native.height !== fixture.height ||
      native.bitDepth !== 32 ||
      native.exponentBits !== 8 ||
      !Array.isArray(native.stages)
    )
      throw new Error('Independent float output metadata differs')
    const final: unknown = native.stages.at(-1)
    if (!record(final) || typeof final.file !== 'string' || !/^stage-\d+\.bin$/.test(final.file))
      throw new Error('Missing independent encoded samples')
    const raw = new Uint8Array(await readFile(`${directory}/${final.file}`))
    let actual = raw
    if (native.channels === 2 && decoder.pixelFormat === 'rgbaf32') {
      actual = new Uint8Array(fixture.width * fixture.height * 16)
      const view = new DataView(raw.buffer),
        output = new DataView(actual.buffer)
      for (let pixel = 0; pixel < fixture.width * fixture.height; pixel++)
        for (let channel = 0; channel < 4; channel++)
          output.setUint32(
            (pixel * 4 + channel) * 4,
            view.getUint32((pixel * 2 + (channel === 3 ? 1 : 0)) * 4, false),
            false,
          )
    }
    if (actual.length !== expected.length || hash(actual) !== hash(expected))
      throw new Error(`${fixture.id}: independent float bit patterns differ`)
    if (fixture.category === 'icc') {
      const metadata = await jpegxlCodec.preservedMetadata?.(
        new MemorySource(input),
        defaultImageLimits,
        { icc: true, exif: false },
      )
      if (!metadata?.icc || native.sourceProfileSha256 !== hash(metadata.icc))
        throw new Error(`${fixture.id}: independently decoded ICC profile differs`)
    }
    results.push({
      id: fixture.id,
      hdrOutput,
      inputSha256: hash(input),
      encodedSha256: hash(encoded),
      encodedBytes: encoded.length,
      pixelSha256: hash(actual),
      profileSha256: native.sourceProfileSha256,
    })
  }
const output = resolve(process.argv[2] ?? '.tmp/jpegxl-float-encoding-verification.json')
await writeFile(
  output,
  `${JSON.stringify({ oracle: 'Pinned libjxl 0.12.0 C API; Float32 decoded samples match ordinary source rows bit for bit; associated alpha retained', results }, null, 2)}\n`,
)
process.stdout.write(`Verified ${results.length} independent float32 encodings: ${output}\n`)
