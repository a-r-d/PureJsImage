import { invalidInput, unsupportedOperation } from '../../errors.ts'

export interface Hdf5Filter {
  readonly id: number
  readonly optional: boolean
  readonly name: string | undefined
  readonly clientData: readonly number[]
}

export interface Hdf5FilterPipeline {
  readonly version: 1 | 2
  readonly filters: readonly Hdf5Filter[]
}

const requireBytes = (bytes: Uint8Array, offset: number, length: number, label: string): void => {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw invalidInput(`${label} is truncated`)
  }
}

const littleEndianUint16 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)

const littleEndianUint32 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)) >>>
  0

const requireZero = (bytes: Uint8Array, offset: number, length: number, label: string): void => {
  requireBytes(bytes, offset, length, label)
  for (let index = offset; index < offset + length; index += 1) {
    if (bytes[index] !== 0) throw invalidInput(`${label} is non-zero`)
  }
}

const parseName = (bytes: Uint8Array, offset: number, length: number): string => {
  requireBytes(bytes, offset, length, 'HDF5 filter name')
  if (length === 0 || (length & 7) !== 0) {
    throw invalidInput('HDF5 filter name length must be a non-zero multiple of eight')
  }
  const nameBytes = bytes.subarray(offset, offset + length)
  const terminator = nameBytes.indexOf(0)
  if (terminator < 0) throw invalidInput('HDF5 filter name is not null-terminated')
  for (let index = 0; index < terminator; index += 1) {
    const value = nameBytes[index] ?? 0
    if (value > 0x7f) throw invalidInput('HDF5 filter name is not ASCII')
  }
  requireZero(nameBytes, terminator, nameBytes.byteLength - terminator, 'HDF5 filter name padding')
  return new TextDecoder().decode(nameBytes.subarray(0, terminator))
}

export const parseHdf5FilterPipelineMessage = (bytes: Uint8Array): Hdf5FilterPipeline => {
  requireBytes(bytes, 0, 2, 'HDF5 filter pipeline message')
  const version = bytes[0]
  if (version !== 1 && version !== 2) {
    throw unsupportedOperation(
      `HDF5 filter pipeline message version ${version ?? 0} is unsupported`,
    )
  }
  const count = bytes[1] ?? 0
  if (count > 32) throw invalidInput('HDF5 filter pipeline exceeds 32 filters')
  let position = 2
  if (version === 1) {
    requireZero(bytes, position, 6, 'HDF5 filter pipeline reserved bytes')
    position += 6
  }

  const filters: Hdf5Filter[] = []
  for (let index = 0; index < count; index += 1) {
    requireBytes(bytes, position, 2, `HDF5 filter ${index} identifier`)
    const id = littleEndianUint16(bytes, position)
    position += 2
    let nameLength = 0
    if (version === 1 || id >= 256) {
      requireBytes(bytes, position, 2, `HDF5 filter ${index} name length`)
      nameLength = littleEndianUint16(bytes, position)
      position += 2
      if (nameLength !== 0 && (nameLength & 7) !== 0) {
        throw invalidInput(`HDF5 filter ${index} name length is not a multiple of eight`)
      }
    }
    requireBytes(bytes, position, 4, `HDF5 filter ${index} description`)
    const flags = littleEndianUint16(bytes, position)
    const clientDataCount = littleEndianUint16(bytes, position + 2)
    position += 4
    if ((flags & ~1) !== 0) throw invalidInput(`HDF5 filter ${index} has reserved flags set`)
    const name = nameLength === 0 ? undefined : parseName(bytes, position, nameLength)
    position += nameLength
    const clientBytes = clientDataCount * 4
    requireBytes(bytes, position, clientBytes, `HDF5 filter ${index} client data`)
    const clientData: number[] = []
    for (let valueIndex = 0; valueIndex < clientDataCount; valueIndex += 1) {
      clientData.push(littleEndianUint32(bytes, position + valueIndex * 4))
    }
    position += clientBytes
    if (version === 1 && (clientDataCount & 1) !== 0) {
      requireZero(bytes, position, 4, `HDF5 filter ${index} client-data padding`)
      position += 4
    }
    filters.push(
      Object.freeze({
        id,
        optional: (flags & 1) !== 0,
        name,
        clientData: Object.freeze(clientData),
      }),
    )
  }
  requireZero(bytes, position, bytes.byteLength - position, 'HDF5 filter pipeline trailing bytes')
  return Object.freeze({ version, filters: Object.freeze(filters) })
}
