import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { downloadPinnedFile } from '../lib/pinned-download.ts'

interface SourceFile {
  readonly file: string
  readonly sha256: string
  readonly url: string
}

interface DerivedFile {
  readonly file: string
  readonly sha256: string
}

const repositoryRoot = resolve(import.meta.dirname, '../..')
const corpusDirectory = join(repositoryRoot, 'benchmark/corpus/files')
const workspace = join(repositoryRoot, 'benchmark/.tmp/small-codecs')
const allowedHosts = new Set(['raw.githubusercontent.com', 'dl.polyhaven.org'])

const sources: readonly SourceFile[] = [
  {
    file: 'city.png',
    url: 'https://raw.githubusercontent.com/imazen/codec-corpus/main/gb82/city-lossless.png',
    sha256: '92950cec34adafe5a2d8ca5c247ec04df1a8de508f602ef683c838e1e2804aa7',
  },
  {
    file: 'haze.png',
    url: 'https://raw.githubusercontent.com/imazen/codec-corpus/main/gb82/haze-lossless.png',
    sha256: '160eb5004cfa03cdf72c726f24f65d747cf67e932ce7b668e03d8d296b4737a2',
  },
  {
    file: 'grass.png',
    url: 'https://raw.githubusercontent.com/imazen/codec-corpus/main/gb82/grass-lossless.png',
    sha256: 'b49986dad608edadf1b2071359ac6d18de55751864df407b215ea9bb00a92079',
  },
  {
    file: 'potsdamer.hdr',
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/potsdamer_platz_1k.hdr',
    sha256: '7afe4c2f9700ee78c7477c53fa355463d7dda1fdede401432d6b5f9ff0a95696',
  },
  {
    file: 'greenhouse.hdr',
    url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/abandoned_greenhouse_1k.hdr',
    sha256: 'd6c3d214ecbb76a1e132bc9b5afe7d1c98fdb5f106ff598077f23bd3e566b466',
  },
]

const derived: readonly DerivedFile[] = [
  {
    file: 'small-codec-city.qoi',
    sha256: '91b15578c0b03a3b75e30bcc42cdb2df4ebddf43d8ff6eb4d4c2df795cd6aaf5',
  },
  {
    file: 'small-codec-haze.qoi',
    sha256: '61d28d2c47b5f34bb0637f0d76c9a0769746727602a0756293f3bbd61702c1e7',
  },
  {
    file: 'small-codec-grass.qoi',
    sha256: 'c4afc70617e9e631c93c129c106bf13c1698123e318736edb9b7bbfb423d64cf',
  },
  {
    file: 'small-codec-city.ppm',
    sha256: '659e8592a4715371efdd32cb2496724fcc4071b909f00fda2d532d18c48870f4',
  },
  {
    file: 'small-codec-haze.ppm',
    sha256: '8884f171d3844274f0f4122f20833a5a3e8051abb73888e57f94ad74b9944159',
  },
  {
    file: 'small-codec-grass.ppm',
    sha256: '0c801b31b96901bbf507470c29a4c749b36c693d331c3a927522455eef012219',
  },
  {
    file: 'small-codec-city.tga',
    sha256: '20d8412bdbdc5fc2abcb82dd420d7ae0ebc836ef210062abf6139ce194a0ad2d',
  },
  {
    file: 'small-codec-haze.tga',
    sha256: 'b0c7cbf872dbdcfca677718f976133a7fadb3a37ac1fc3b8d5ee7494c8d4a905',
  },
  {
    file: 'small-codec-grass.tga',
    sha256: '608b31c561b0e5cc6f201101e6f51ca40673439d5862749278e079afbe700284',
  },
  {
    file: 'small-codec-potsdamer.hdr',
    sha256: '7afe4c2f9700ee78c7477c53fa355463d7dda1fdede401432d6b5f9ff0a95696',
  },
  {
    file: 'small-codec-greenhouse.hdr',
    sha256: 'd6c3d214ecbb76a1e132bc9b5afe7d1c98fdb5f106ff598077f23bd3e566b466',
  },
  {
    file: 'small-codec-potsdamer.pfm',
    sha256: '5f7af3f9b2b7e70180d725842b14572e95903f82eb023e14ba74443e694528a5',
  },
  {
    file: 'small-codec-greenhouse.pfm',
    sha256: 'b4251b37e333972f0575be001a8458d79efa7511792a788eb101bab89baa5898',
  },
]

const qoiHeader: SourceFile = {
  file: 'qoi.h',
  url: 'https://raw.githubusercontent.com/phoboslab/qoi/97bacc86a9c4abf5a2d452102dc26546c4c670b9/qoi.h',
  sha256: '7de6fca1a285b1c20d38f2723dec8b774eb9f144edb9710800a95feeea09375a',
}

const sha256File = async (path: string): Promise<string> => {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
}

const run = (command: string, args: readonly string[]): void => {
  execFileSync(command, args, { cwd: workspace, stdio: 'inherit' })
}

const download = async (source: SourceFile): Promise<void> => {
  await downloadPinnedFile({
    allowedDirectory: workspace,
    allowedHosts,
    destination: join(workspace, source.file),
    expectedSha256: source.sha256,
    url: source.url,
  })
}

const qoiEncoderSource = `#define QOI_IMPLEMENTATION
#include "qoi.h"
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv) {
  if (argc != 5) return 2;
  const int width = atoi(argv[1]);
  const int height = atoi(argv[2]);
  const size_t bytes = (size_t)width * (size_t)height * 3;
  unsigned char *pixels = malloc(bytes);
  if (!pixels) return 3;
  FILE *input = fopen(argv[3], "rb");
  if (!input || fread(pixels, 1, bytes, input) != bytes || fgetc(input) != EOF) return 4;
  fclose(input);
  const qoi_desc description = { (unsigned int)width, (unsigned int)height, 3, QOI_SRGB };
  const int written = qoi_write(argv[4], pixels, &description);
  free(pixels);
  return written ? 0 : 5;
}
`

await rm(workspace, { recursive: true, force: true })
await mkdir(workspace, { recursive: true })
await mkdir(corpusDirectory, { recursive: true })

try {
  for (const source of [...sources, qoiHeader]) await download(source)
  await writeFile(join(workspace, 'qoi-encode.c'), qoiEncoderSource)
  run('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', 'qoi-encode.c', '-o', 'qoi-encode'])

  for (const name of ['city', 'haze', 'grass']) {
    run('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-i',
      `${name}.png`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      `${name}.rgb`,
    ])
    run(join(workspace, 'qoi-encode'), [
      '576',
      '576',
      `${name}.rgb`,
      join(corpusDirectory, `small-codec-${name}.qoi`),
    ])
    run('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-i',
      `${name}.png`,
      '-c:v',
      'ppm',
      join(corpusDirectory, `small-codec-${name}.ppm`),
    ])
    run('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-i',
      `${name}.png`,
      '-c:v',
      'targa',
      '-rle',
      '1',
      join(corpusDirectory, `small-codec-${name}.tga`),
    ])
  }

  run('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    'potsdamer.hdr',
    '-frames:v',
    '1',
    '-pix_fmt',
    'gbrpf32le',
    '-c:v',
    'pfm',
    join(corpusDirectory, 'small-codec-potsdamer.pfm'),
  ])
  run('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    'greenhouse.hdr',
    '-frames:v',
    '1',
    '-pix_fmt',
    'gbrpf32le',
    '-c:v',
    'pfm',
    join(corpusDirectory, 'small-codec-greenhouse.pfm'),
  ])
  await writeFile(
    join(corpusDirectory, 'small-codec-potsdamer.hdr'),
    await readFile(join(workspace, 'potsdamer.hdr')),
  )
  await writeFile(
    join(corpusDirectory, 'small-codec-greenhouse.hdr'),
    await readFile(join(workspace, 'greenhouse.hdr')),
  )

  for (const output of derived) {
    const actual = await sha256File(join(corpusDirectory, output.file))
    if (actual !== output.sha256) {
      throw new Error(`${output.file} checksum mismatch: expected ${output.sha256}, got ${actual}`)
    }
    console.log(`ok ${output.file}`)
  }
} finally {
  await rm(workspace, { recursive: true, force: true })
}
