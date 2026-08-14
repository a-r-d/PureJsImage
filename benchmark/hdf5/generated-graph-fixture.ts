import { createGeneratedDenseGroupFixture } from './generated-dense-group-fixture.ts'
import { createGeneratedHdf5Fixture } from './generated-fixture.ts'
import { createGeneratedLegacyGroupFixture } from './generated-legacy-group-fixture.ts'
import {
  createGeneratedHardLink,
  createGeneratedSoftLink,
  createGeneratedSymbolTableMessage,
  createGeneratedVersion2ObjectHeader,
  type GeneratedHdf5ObjectMessage,
} from './generated-object-fixture.ts'

export interface GeneratedHdf5GraphFixture {
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly addresses: Readonly<{
    root: bigint
    compact: bigint
    compactLeaf: bigint
    legacy: bigint
    legacyLeaf: bigint
    dense: bigint
    denseLeaf: bigint
  }>
}

const compactAddress = 512n
const compactLeafAddress = 640n
const legacyAddress = 768n
const denseAddress = 896n
const legacyLeafAddress = 7_000n
const denseLeafAddress = 20_000n

const hardLink = (name: string, address: bigint): GeneratedHdf5ObjectMessage =>
  Object.freeze({ type: 0x0006, data: createGeneratedHardLink({ name }, address, 8) })

const softLink = (name: string, target: string): GeneratedHdf5ObjectMessage =>
  Object.freeze({ type: 0x0006, data: createGeneratedSoftLink({ name }, target) })

const denseLinkInfo = (
  fractalHeapAddress: bigint,
  nameIndexAddress: bigint,
): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(18)
  const view = new DataView(output.buffer)
  view.setBigUint64(2, fractalHeapAddress, true)
  view.setBigUint64(10, nameIndexAddress, true)
  return output
}

export const createGeneratedHdf5GraphFixture = (): GeneratedHdf5GraphFixture => {
  const fixture = createGeneratedHdf5Fixture({ version: 2, fileBytes: 32_768 })
  if (fixture.rootObjectOffset === undefined) {
    throw new Error('Generated HDF5 graph root offset is unavailable')
  }
  const addresses = Object.freeze({
    root: fixture.rootObjectAddress,
    compact: compactAddress,
    compactLeaf: compactLeafAddress,
    legacy: legacyAddress,
    legacyLeaf: legacyLeafAddress,
    dense: denseAddress,
    denseLeaf: denseLeafAddress,
  })
  const legacy = createGeneratedLegacyGroupFixture({
    links: [
      { kind: 'hard', name: 'leaf', objectAddress: legacyLeafAddress },
      { kind: 'soft', name: 'alias', target: '/compact/item' },
      { kind: 'hard', name: 'root', objectAddress: addresses.root },
    ],
  })
  const dense = createGeneratedDenseGroupFixture({
    rootBlock: 'direct',
    links: [
      { kind: 'hard', name: 'leaf', objectAddress: denseLeafAddress },
      { kind: 'soft', name: 'alias', target: '/legacy/leaf' },
      { kind: 'hard', name: 'root', objectAddress: addresses.root },
    ],
  })

  fixture.bytes.set(
    createGeneratedVersion2ObjectHeader([
      hardLink('compact', compactAddress),
      hardLink('legacy', legacyAddress),
      hardLink('dense', denseAddress),
      hardLink('self', addresses.root),
      softLink('absolute', '/legacy/leaf'),
      softLink('dangling', '/missing'),
      softLink('loop', '/loop'),
    ]),
    fixture.rootObjectOffset,
  )
  fixture.bytes.set(
    createGeneratedVersion2ObjectHeader([
      hardLink('item', compactLeafAddress),
      softLink('relative', 'item'),
    ]),
    Number(compactAddress),
  )
  fixture.bytes.set(
    createGeneratedVersion2ObjectHeader([
      {
        type: 0x0011,
        data: createGeneratedSymbolTableMessage(legacy.btreeAddress, legacy.localHeapAddress, 8),
      },
    ]),
    Number(legacyAddress),
  )
  fixture.bytes.set(
    createGeneratedVersion2ObjectHeader([
      {
        type: 0x0002,
        data: denseLinkInfo(dense.fractalHeapAddress, dense.nameIndexAddress),
      },
    ]),
    Number(denseAddress),
  )
  const leaf = createGeneratedVersion2ObjectHeader([])
  fixture.bytes.set(leaf, Number(compactLeafAddress))
  fixture.bytes.set(leaf, Number(legacyLeafAddress))
  fixture.bytes.set(leaf, Number(denseLeafAddress))
  for (const [address, bytes] of legacy.blocks) fixture.bytes.set(bytes, Number(address))
  for (const [address, bytes] of dense.blocks) fixture.bytes.set(bytes, Number(address))

  return Object.freeze({ bytes: fixture.bytes, addresses })
}
