import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

const width = 37
const height = 23
const fixtureDirectory = join('benchmark', 'corpus', 'files', 'jpeg-reference')
const expectedSha256: Readonly<Record<string, string>> = Object.freeze({
  'generated-yuv440.jpg': '2199caf17e3536fee1a95df125fb3e7f9cb8caee1d085e0f10081d725a86aa1c',
  'generated-yuv411.jpg': '0c9bea1f1bfa2fb952fbd2aa4705f2a288b52a08b7c105bae2f13dfcbd24fb64',
  'generated-sof1-8bit.jpg': '09048d46b313702386605da3eddd6ad0ebbfb104f891901ec17603a00bb25104',
  'generated-sequential-multiscan.jpg':
    'c916cbd242f3a1fc2a41870fb536f2e30f609055cd75165ab9d1df2285f21279',
  'generated-progressive.jpg': 'ef15e5eafc4eb4d98e012f03ea2b8b1a400c7dff29fb0303e6c7c98ade0981ee',
  'generated-progressive-zrl.jpg':
    '4b7f5882755add89103be3895efdc0eea0c41d3096d015ac22f847650d68beda',
  'generated-adobe-rgb.jpg': 'd075ab672879c684eeacb84e88d2a7a9c9b300e65eed97eab31a46399dfdedc4',
})

const ppm = (): Uint8Array => {
  const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`)
  const output = new Uint8Array(header.byteLength + width * height * 3)
  output.set(header)
  let offset = header.byteLength
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      output[offset] = (x * 7 + y * 3) & 0xff
      output[offset + 1] = (x * 2 + y * 11) & 0xff
      output[offset + 2] = (x * 13 + y * 5) & 0xff
      offset += 3
    }
  }
  return output
}

const progressiveZrlSource = (): Uint8Array => {
  const sourceWidth = 240
  const sourceHeight = 160
  const output = new Uint8Array(sourceWidth * sourceHeight * 3)
  output.fill(248)
  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < sourceWidth; x += 1) {
      const offset = (y * sourceWidth + x) * 3
      if (y <= sourceHeight * 0.2 || x <= sourceWidth * 0.1 || x >= sourceWidth * 0.9) continue
      const slot = Math.floor((x - sourceWidth * 0.1) / ((sourceWidth * 0.8) / 16))
      if (slot % 2 === 0 && y > sourceHeight * (0.3 + (slot % 7) * 0.04)) {
        output[offset] = 45
        output[offset + 1] = 125
        output[offset + 2] = 180
      } else if (y % 53 === 0) {
        output[offset] = 205
        output[offset + 1] = 205
        output[offset + 2] = 205
      }
    }
  }
  return output
}

const encode = (arguments_: readonly string[], input: Uint8Array): Uint8Array => {
  const result = spawnSync('pnmtojpeg', arguments_, {
    input,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`pnmtojpeg failed: ${result.stderr.toString().trim()}`)
  }
  return Uint8Array.from(result.stdout)
}

const replaceFrameMarker = (input: Uint8Array, replacement: number): Uint8Array => {
  const output = Uint8Array.from(input)
  for (let offset = 0; offset + 1 < output.byteLength; offset += 1) {
    if (output[offset] === 0xff && output[offset + 1] === 0xc0) {
      output[offset + 1] = replacement
      return output
    }
  }
  throw new Error('Generated JPEG has no SOF0 marker')
}

const sha256 = (input: Uint8Array): string => createHash('sha256').update(input).digest('hex')

const temporary = mkdtempSync(join(tmpdir(), 'purejsimage-jpeg-reference-'))
try {
  const scanScript = join(temporary, 'sequential-scans.txt')
  writeFileSync(scanScript, '0;\n1;\n2;\n')
  const progressiveScanScript = join(temporary, 'progressive-scans.txt')
  writeFileSync(
    progressiveScanScript,
    [
      '0,1,2: 0-0, 0, 1;',
      '0,1,2: 0-0, 1, 0;',
      '0: 1-63, 0, 1;',
      '1: 1-63, 0, 0;',
      '2: 1-63, 0, 0;',
      '0: 1-63, 1, 0;',
    ].join('\n'),
  )
  const source = ppm()
  const baseline = encode(['-quality=91', '-sample=2x2'], source)
  const progressiveZrl = await sharp(progressiveZrlSource(), {
    raw: { width: 240, height: 160, channels: 3 },
  })
    .jpeg({ progressive: true, quality: 50, chromaSubsampling: '4:2:0' })
    .toBuffer()
  const fixtures = new Map<string, Uint8Array>([
    ['generated-yuv440.jpg', encode(['-quality=91', '-sample=1x2'], source)],
    ['generated-yuv411.jpg', encode(['-quality=91', '-sample=4x1'], source)],
    ['generated-sof1-8bit.jpg', replaceFrameMarker(baseline, 0xc1)],
    [
      'generated-sequential-multiscan.jpg',
      encode(['-quality=91', '-sample=2x2', `-scans=${scanScript}`], source),
    ],
    [
      'generated-progressive.jpg',
      encode(['-quality=91', `-scans=${progressiveScanScript}`], source),
    ],
    ['generated-progressive-zrl.jpg', progressiveZrl],
    ['generated-adobe-rgb.jpg', encode(['-quality=91', '-rgb'], source)],
  ])
  mkdirSync(fixtureDirectory, { recursive: true })
  for (const [name, data] of fixtures) {
    const hash = sha256(data)
    if (hash !== expectedSha256[name]) {
      throw new Error(`${name}: expected SHA-256 ${expectedSha256[name]}, received ${hash}`)
    }
    const path = join(fixtureDirectory, name)
    writeFileSync(path, data)
    const roundTrip = readFileSync(path)
    if (sha256(roundTrip) !== sha256(data)) throw new Error(`${name}: write verification failed`)
    console.log(`${hash}  ${name}`)
  }
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
