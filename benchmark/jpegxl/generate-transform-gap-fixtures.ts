/** Development oracle only. The temporary encoder forces legal transform choices. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const source = resolve('.tmp/jpegxl-oracles/libjxl-v0.12.0/source')
const build = `${source}/build-pinned`
const work = resolve('.tmp/jpegxl-transform-gaps')
const output = resolve('tests/fixtures/jpegxl/transform-gaps')
await mkdir(work, { recursive: true })
await mkdir(output, { recursive: true })
const original = await readFile(`${source}/lib/jxl/enc_ac_strategy.cc`, 'utf8')
if (
  createHash('sha256').update(original).digest('hex') !==
  'fcaa32e80f56e0d1b6e9bf93c3e9f3e1542d208ce119686d86b671420713f469'
)
  throw new Error('Transform oracle source differs from pinned libjxl 0.12.0')
const anchor = '  // In Cheetah mode, use DCT8 everywhere and uniform quantization.'
if (original.split(anchor).length !== 2) throw new Error('Oracle patch anchor differs')
const patch = `  // Development fixture selection only; the decoder stays unmodified.
  const char* forced = std::getenv("PUREJSIMAGE_FIXTURE_STRATEGY");
  if (forced) {
    const auto type = static_cast<AcStrategyType>(std::atoi(forced));
    const auto shape = AcStrategy::FromRawStrategy(type);
    const size_t w = shape.covered_blocks_x(), h = shape.covered_blocks_y();
    for (size_t y = rect.y0(); y < rect.y0() + rect.ysize(); ++y) {
      for (size_t x = rect.x0(); x < rect.x0() + rect.xsize(); ++x) {
        const size_t ox = x - x % w, oy = y - y % h;
        if (ox + w <= ac_strategy->xsize() && oy + h <= ac_strategy->ysize()) {
          if (x == ox && y == oy) JXL_RETURN_IF_ERROR(ac_strategy->Set(x, y, type));
        } else {
          JXL_RETURN_IF_ERROR(ac_strategy->Set(x, y, AcStrategyType::DCT));
        }
      }
    }
    return true;
  }
`
const patched = original
  .replace('#include <cstdio>', '#include <cstdio>\n#include <cstdlib>')
  .replace(anchor, patch + anchor)
const patchedPath = `${work}/enc_ac_strategy.cc`
await writeFile(patchedPath, patched)
const commands = execFileSync('ninja', ['-t', 'commands', 'tools/cjxl'], {
  cwd: build,
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024,
}).split('\n')
const compile = commands.find(
  (command) => command.includes(' -c ') && command.endsWith('/enc_ac_strategy.cc'),
)
const link = commands.find((command) => command.includes(' -o tools/cjxl '))
if (!compile || !link) throw new Error('Oracle build commands are missing')
const object = 'lib/CMakeFiles/jxl_enc-obj.dir/jxl/enc_ac_strategy.cc.o'
// Compile and relink separate artifacts. The pinned tools and libraries are unchanged.
execFileSync(
  '/bin/sh',
  [
    '-c',
    compile
      .replaceAll(object, `${work}/enc_ac_strategy.cc.o`)
      .replace(`${source}/lib/jxl/enc_ac_strategy.cc`, patchedPath),
  ],
  { cwd: build, stdio: 'inherit' },
)
await writeFile(`${work}/libjxl.a`, await readFile(`${build}/lib/libjxl.a`))
execFileSync('ar', ['r', `${work}/libjxl.a`, `${work}/enc_ac_strategy.cc.o`], { stdio: 'inherit' })
execFileSync(
  '/bin/sh',
  [
    '-c',
    link
      .replaceAll('lib/libjxl.a', `${work}/libjxl.a`)
      .replace(' -o tools/cjxl ', ` -o ${work}/cjxl `)
      .replace('tools/CMakeFiles/cjxl.dir/link.d', `${work}/link.d`),
  ],
  { cwd: build, stdio: 'inherit' },
)
const sha256 = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex')
const width = 513,
  height = 259
const raster = new Uint8Array(width * height * 3)
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 3
    raster[offset] = Math.round(100 + 55 * Math.sin(x / 19) + 30 * Math.cos(y / 31))
    raster[offset + 1] = Math.round(110 + 50 * Math.cos(x / 43) + 25 * Math.sin(y / 11))
    raster[offset + 2] = Math.round(120 + 45 * Math.sin((x + y) / 29))
  }
const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`)
const input = new Uint8Array(header.length + raster.length)
input.set(header)
input.set(raster, header.length)
await writeFile(`${work}/source.ppm`, input)
const fixtures: {
  strategy: number
  file: string
  sha256: string
  referenceSha256: string
  bytes: number
}[] = []
for (const strategy of [8, 9, 21, 22, 23, 24, 25, 26]) {
  const name = `strategy-${strategy}`
  execFileSync(
    `${work}/cjxl`,
    [
      `${work}/source.ppm`,
      `${output}/${name}.jxl`,
      '-d',
      '1',
      '-e',
      '3',
      '--num_threads=1',
      '--codestream_level=10',
    ],
    { stdio: 'inherit', env: { ...process.env, PUREJSIMAGE_FIXTURE_STRATEGY: String(strategy) } },
  )
  execFileSync(
    `${build}/tools/djxl`,
    [`${output}/${name}.jxl`, `${work}/${name}.ppm`, '--num_threads=1'],
    { stdio: 'inherit' },
  )
  const reference = await readFile(`${work}/${name}.ppm`)
  const text = new TextDecoder().decode(reference.subarray(0, 100))
  const match = /^P6\n513 259\n255\n/u.exec(text)
  if (!match) throw new Error('Oracle PPM header differs')
  const pixels = reference.subarray(match[0].length)
  if (pixels.length !== raster.length) throw new Error('Oracle raster size differs')
  await writeFile(`${output}/${name}.rgb.gz`, gzipSync(pixels))
  const encoded = await readFile(`${output}/${name}.jxl`)
  fixtures.push({
    strategy,
    file: `${name}.jxl`,
    sha256: sha256(encoded),
    referenceSha256: sha256(pixels),
    bytes: encoded.length,
  })
}
await writeFile(
  `${output}/manifest.json`,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      width,
      height,
      oracle: 'libjxl 0.12.0 8cb67e2; unmodified djxl',
      sourceSha256: sha256(original),
      forcedEncoderSourceSha256: sha256(patched),
      inputSha256: sha256(input),
      fixtures,
    },
    null,
    2,
  )}\n`,
)
