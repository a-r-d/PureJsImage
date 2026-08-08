import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AvifPostFilterFixture {
  readonly file: string
  readonly fileSha256: string
  readonly filters: readonly ('cdef' | 'deblock' | 'self-guided' | 'wiener')[]
  readonly height: number
  readonly id: string
  readonly yuvSha256: string
  readonly width: number
}

export const avifPostFilterFixtureDirectory = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'corpus',
  'files',
  'avif',
)

export const avifPostFilterFixtures: readonly AvifPostFilterFixture[] = [
  {
    id: 'disabled',
    file: 'post-filter-disabled-66x70.avif',
    width: 66,
    height: 70,
    filters: [],
    fileSha256: '73868b5162e5287e10635e3edce543556310aa3fa4748f88576fb5e37ed8e67f',
    yuvSha256: '531b29039dc36da51208b653d2ba19e49d6f88061f7311306442ea4bba7ddcb6',
  },
  {
    id: 'deblock-odd-frame',
    file: 'post-filter-deblock-96x74.avif',
    width: 96,
    height: 74,
    filters: ['deblock'],
    fileSha256: '501c278b5a9a9d8690caa752c8de2d19f9b6ff106f15b772394c212403c6cb9c',
    yuvSha256: '3fb3d421c23e6199fb490a572db0e599317a06e35f46b91463352ad5effc76c7',
  },
  {
    id: 'cdef-luma-chroma',
    file: 'post-filter-cdef-66x70.avif',
    width: 66,
    height: 70,
    filters: ['cdef'],
    fileSha256: '3b145b56ccc74f761ab5b01cf79de3f0cf6c005f6085234a6dde194999ec90f4',
    yuvSha256: 'dc94bb2693cab9e76c2d5b1eb38c7047fa1caa43c68eb9e0cdcafe3282296e64',
  },
  {
    id: 'wiener-self-guided',
    file: 'post-filter-wiener-sgr-66x70.avif',
    width: 66,
    height: 70,
    filters: ['wiener', 'self-guided'],
    fileSha256: '01d2d67ecac8b031552f21bf44aa5ff75f84f9baf03a8202e8455a2a691dff1f',
    yuvSha256: 'b39130d2a320227a1092a54ddbc27ad61cb8c34ee20e4ca39c6929dde6fe6882',
  },
  {
    id: 'restoration-units',
    file: 'post-filter-restoration-units-300x130.avif',
    width: 300,
    height: 130,
    filters: ['self-guided'],
    fileSha256: '402c303b0c11bfa807296899542e63f38a583fc2f6cdc5d71994da6354bed194',
    yuvSha256: '76dafc8db06b678046b403d02e250b17f6c6701196b10f944b75ecf757e033e8',
  },
]
