import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const bytes32 = (value: number): readonly number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
]

const ascii = (value: string): readonly number[] =>
  [...value].map((character) => character.charCodeAt(0))

const box = (type: string, payload: readonly number[]): readonly number[] => [
  ...bytes32(payload.length + 8),
  ...ascii(type),
  ...payload,
]

const fullBox = (type: string, payload: readonly number[], version = 0): readonly number[] =>
  box(type, [version, 0, 0, 0, ...payload])

const base64Bytes = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, 'base64'))

const lengthPrefixedNal = (nal: Uint8Array): readonly number[] => [...bytes32(nal.length), ...nal]

const parameterArray = (type: number, nal: Uint8Array): readonly number[] => [
  0x80 | type,
  0,
  1,
  (nal.length >>> 8) & 0xff,
  nal.length & 0xff,
  ...nal,
]

export const main10PqFixture = (): Uint8Array => {
  // x265 4.1 encoded this 32x32 testsrc2 picture as one Main 10 intra slice.
  const vps = base64Bytes('QAEMAf//AiAAAAMAkAAAAwAAAwAekoCQ')
  const sps = base64Bytes('QgEBAiAAAAMAkAAAAwAAAwAeoEIITZZKuTC8BahIgEggAAADACAAAAMAIQ==')
  const pps = base64Bytes('RAHBcaGkgA==')
  const slice = base64Bytes(
    'KAGtwCNGBl0lp1HvS4/wcZzXmuUtHUA/o3vHJ+gpBpIZd4Z+CHeJCRjbOdvpwooNEzM/IT7lyQbvAsDVdVNBshoohnOIjwrH6czmINr7Z7D6aXz//8/gLZglLCknsJowtSw57pL0kg5bOZjl3cbBdXeeBPZpqggAF+UJCTXRNWm1bDnsxe1ByKixfwxXhYTLELSfhtHiaW5SJje21FEBxSoPcnbcxEHNJ4QD0neBRcfW8AlfJRv75+ebNlQ3WZa/vTe+xgRvhJgL90Zkhgo9gImQi5KsH4IitkcwLe4c3RU9Z/WYbAN79wmDWBBjzGiqcJdickqZowHCkSS4ZoKHtxATDbEt28jORaIOhsbMBsJb8pVHrTB5LX28H/olM/kFpNrcjvBnyLd5mGU+LSmLY3i2kMqyXGUkkX9OuU09sej1MdGddXnr/946SB6+23jCV3uwKexwYZNXDsFC8U1ZBjcR2YNmDP5vOTiZv0xVZiYbBQO+C3WbI0R0utTuIRAMsj6GxJyeJEIA+GykmipVv8slhigPo7Bg',
  )
  const configuration = [
    1,
    2,
    ...new Array<number>(10).fill(0),
    30,
    0xf0,
    0,
    0xfc,
    0xfd,
    0xfa,
    0xfa,
    0,
    0,
    7,
    3,
    ...parameterArray(32, vps),
    ...parameterArray(33, sps),
    ...parameterArray(34, pps),
  ]
  const fileType = box('ftyp', [
    ...ascii('heic'),
    ...bytes32(0),
    ...ascii('heic'),
    ...ascii('mif1'),
  ])
  const properties = [
    fullBox('ispe', [...bytes32(32), ...bytes32(32)]),
    fullBox('pixi', [3, 10, 10, 10]),
    box('hvcC', configuration),
    box('colr', [...ascii('nclx'), 0, 9, 0, 16, 0, 9, 0]),
  ]
  const itemInfo = fullBox('iinf', [0, 1, ...fullBox('infe', [0, 1, 0, 0, ...ascii('hvc1'), 0], 2)])
  const itemPayload = lengthPrefixedNal(slice)
  const metadata = (absoluteOffset: number): readonly number[] =>
    fullBox('meta', [
      ...fullBox('pitm', [0, 1]),
      ...itemInfo,
      ...fullBox('iloc', [
        0x44,
        0,
        0,
        1,
        0,
        1,
        0,
        0,
        0,
        1,
        ...bytes32(absoluteOffset),
        ...bytes32(itemPayload.length),
      ]),
      ...box('iprp', [
        ...box('ipco', properties.flat()),
        ...fullBox('ipma', [
          ...bytes32(1),
          0,
          1,
          properties.length,
          ...properties.map((_property, index) => index + 1),
        ]),
      ]),
    ])
  const provisionalMetadata = metadata(0)
  const payloadOffset = fileType.length + provisionalMetadata.length + 8
  return Uint8Array.from([...fileType, ...metadata(payloadOffset), ...box('mdat', itemPayload)])
}

const replaceRotationWithMirror = (source: Uint8Array): Uint8Array => {
  const output = source.slice()
  const marker = ascii('irot')
  let match = -1
  for (let offset = 0; offset <= output.byteLength - marker.length; offset += 1) {
    if (marker.every((value, index) => output[offset + index] === value)) {
      if (match !== -1) throw new Error('Expected exactly one irot property in mirror source')
      match = offset
    }
  }
  if (match === -1 || output[match + 4] === undefined) {
    throw new Error('Mirror source has no complete irot property')
  }
  output.set(ascii('imir'), match)
  output[match + 4] = 0
  return output
}

export const generateCompatibilityFixtures = async (directory: string): Promise<void> => {
  const portrait = await readFile(join(directory, 'iphone7-portrait.heic'))
  await writeFile(join(directory, 'generated-main10-pq.heic'), main10PqFixture())
  await writeFile(join(directory, 'generated-imir.heic'), replaceRotationWithMirror(portrait))
}
