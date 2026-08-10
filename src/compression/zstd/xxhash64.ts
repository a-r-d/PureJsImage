const mask64 = (1n << 64n) - 1n
const prime1 = 11_400_714_785_074_694_791n
const prime2 = 14_029_467_366_897_019_727n
const prime3 = 1_609_587_929_392_839_161n
const prime4 = 9_650_029_242_287_828_579n
const prime5 = 2_870_177_450_012_600_261n

const rotateLeft = (value: bigint, bits: bigint): bigint =>
  ((value << bits) | (value >> (64n - bits))) & mask64

const read64Le = (data: Uint8Array, offset: number): bigint => {
  let value = 0n
  for (let index = 0; index < 8; index += 1) {
    value |= BigInt(data[offset + index] ?? 0) << BigInt(index * 8)
  }
  return value
}

const read32Le = (data: Uint8Array, offset: number): bigint =>
  BigInt(
    ((data[offset] ?? 0) |
      ((data[offset + 1] ?? 0) << 8) |
      ((data[offset + 2] ?? 0) << 16) |
      ((data[offset + 3] ?? 0) << 24)) >>>
      0,
  )

const round = (accumulator: bigint, lane: bigint): bigint =>
  (rotateLeft((accumulator + lane * prime2) & mask64, 31n) * prime1) & mask64

const mergeRound = (accumulator: bigint, lane: bigint): bigint => {
  const mixed = accumulator ^ round(0n, lane)
  return (mixed * prime1 + prime4) & mask64
}

export const xxhash64Low32 = (data: Uint8Array): number => {
  let offset = 0
  let hash: bigint
  if (data.byteLength >= 32) {
    let lane1 = (prime1 + prime2) & mask64
    let lane2 = prime2
    let lane3 = 0n
    let lane4 = -prime1 & mask64
    const limit = data.byteLength - 32
    while (offset <= limit) {
      lane1 = round(lane1, read64Le(data, offset))
      lane2 = round(lane2, read64Le(data, offset + 8))
      lane3 = round(lane3, read64Le(data, offset + 16))
      lane4 = round(lane4, read64Le(data, offset + 24))
      offset += 32
    }
    hash =
      (rotateLeft(lane1, 1n) +
        rotateLeft(lane2, 7n) +
        rotateLeft(lane3, 12n) +
        rotateLeft(lane4, 18n)) &
      mask64
    hash = mergeRound(hash, lane1)
    hash = mergeRound(hash, lane2)
    hash = mergeRound(hash, lane3)
    hash = mergeRound(hash, lane4)
  } else {
    hash = prime5
  }

  hash = (hash + BigInt(data.byteLength)) & mask64
  while (offset + 8 <= data.byteLength) {
    const lane = round(0n, read64Le(data, offset))
    hash ^= lane
    hash = (rotateLeft(hash, 27n) * prime1 + prime4) & mask64
    offset += 8
  }
  if (offset + 4 <= data.byteLength) {
    hash = (hash ^ (read32Le(data, offset) * prime1)) & mask64
    hash = (rotateLeft(hash, 23n) * prime2 + prime3) & mask64
    offset += 4
  }
  while (offset < data.byteLength) {
    hash = (hash ^ (BigInt(data[offset] ?? 0) * prime5)) & mask64
    hash = (rotateLeft(hash, 11n) * prime1) & mask64
    offset += 1
  }

  hash ^= hash >> 33n
  hash = (hash * prime2) & mask64
  hash ^= hash >> 29n
  hash = (hash * prime3) & mask64
  hash ^= hash >> 32n
  return Number(hash & 0xffff_ffffn) >>> 0
}
