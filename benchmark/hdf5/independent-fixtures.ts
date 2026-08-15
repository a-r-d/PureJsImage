import type { Hdf5SuperblockVersion } from '../../src/scientific/formats/hdf5.ts'

export interface IndependentHdf5FileFixture {
  readonly name: string
  readonly generator: string
  readonly hdf5Version: string
  readonly libver: string
  readonly superblockVersion: Hdf5SuperblockVersion
  readonly userBlockBytes: number
  readonly sha256: string
  bytes(): Uint8Array<ArrayBuffer>
}

const decodeHex = (value: string): Uint8Array<ArrayBuffer> => {
  if (value.length % 2 !== 0) throw new Error('Independent HDF5 fixture hex must be byte-aligned')
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
    if (!Number.isFinite(byte)) throw new Error('Independent HDF5 fixture hex is invalid')
    bytes[index] = byte
  }
  return bytes
}

const fixture = (
  value: Omit<IndependentHdf5FileFixture, 'bytes'> & { readonly bodyHex: string },
): IndependentHdf5FileFixture =>
  Object.freeze({
    name: value.name,
    generator: value.generator,
    hdf5Version: value.hdf5Version,
    libver: value.libver,
    superblockVersion: value.superblockVersion,
    userBlockBytes: value.userBlockBytes,
    sha256: value.sha256,
    bytes() {
      const body = decodeHex(value.bodyHex)
      const output = new Uint8Array(value.userBlockBytes + body.byteLength)
      output.set(body, value.userBlockBytes)
      return output
    },
  })

const common = Object.freeze({ generator: 'h5py 3.14.0', hdf5Version: '1.14.6' })

/** Empty files independently emitted through h5py, retained as exact pinned byte fixtures. */
export const independentHdf5FileFixtures: readonly IndependentHdf5FileFixture[] = Object.freeze([
  fixture({
    ...common,
    name: 'h5py-v2.h5',
    libver: 'v108-v108',
    superblockVersion: 2,
    userBlockBytes: 0,
    sha256: 'a4f084d2f27f0707c980e35011b65b71557adf3416dfa59bc7d4f029bb73f0a9',
    bodyHex:
      '894844460d0a1a0a020808000000000000000000ffffffffffffffffc3000000000000003000000000000000ab5fed364f484452022022647f6a22647f6a22647f6a22647f6a78021200000000ffffffffffffffffffffffffffffffff0a020001000000580000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004418f02b',
  }),
  fixture({
    ...common,
    name: 'h5py-v3.h5',
    libver: 'v110-v110',
    superblockVersion: 3,
    userBlockBytes: 0,
    sha256: '47e334fad35920f9d1f3b8669d273621d93b14539667dab1e35c347537cd823d',
    bodyHex:
      '894844460d0a1a0a030808000000000000000000ffffffffffffffffc3000000000000003000000000000000061a61374f484452022022647f6a22647f6a22647f6a22647f6a78021200000000ffffffffffffffffffffffffffffffff0a020001000000580000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004418f02b',
  }),
  fixture({
    ...common,
    name: 'h5py-v2-userblock-512.h5',
    libver: 'v108-v108',
    superblockVersion: 2,
    userBlockBytes: 512,
    sha256: 'b7c442e8bdd466d6f14ebe0b17f12d358619ebd41b288220d14dd93d003e340d',
    bodyHex:
      '894844460d0a1a0a020808000002000000000000ffffffffffffffffc3020000000000003000000000000000253acceb4f484452022022647f6a22647f6a22647f6a22647f6a78021200000000ffffffffffffffffffffffffffffffff0a020001000000580000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004418f02b',
  }),
])
