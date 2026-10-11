/** Sorts the exact integer keys (Int32 feature * sample count + sample index) used by training. */
export const sortJpegXlModularTrainingKeys = (
  keys: Float64Array,
  scratch: Float64Array,
  buckets: Uint32Array,
): void => {
  let minimum = Number.POSITIVE_INFINITY,
    maximum = Number.NEGATIVE_INFINITY,
    ordered = true,
    previous = Number.NEGATIVE_INFINITY
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] ?? 0
    minimum = Math.min(minimum, key)
    maximum = Math.max(maximum, key)
    if (key < previous) ordered = false
    previous = key
  }
  if (ordered) return
  // Subtracting the minimum keeps every key integral and needs at most 48 bits.
  const offset = -minimum,
    range = maximum - minimum
  let passes = 1
  for (let divisor = 256; range >= divisor; divisor *= 256) passes++
  let source = keys,
    destination = scratch
  for (let pass = 0; pass < passes; pass++) {
    buckets.fill(0, 0, 256)
    const shift = (pass % 4) * 8
    if (pass < 4) {
      for (let i = 0; i < keys.length; i++) {
        const digit = (((source[i] ?? 0) + offset) >>> shift) & 255
        buckets[digit] = (buckets[digit] ?? 0) + 1
      }
    } else {
      for (let i = 0; i < keys.length; i++) {
        const digit = (Math.floor(((source[i] ?? 0) + offset) / 4294967296) >>> shift) & 255
        buckets[digit] = (buckets[digit] ?? 0) + 1
      }
    }
    let start = 0
    for (let digit = 0; digit < 256; digit++) {
      const count = buckets[digit] ?? 0
      buckets[digit] = start
      start += count
    }
    if (pass < 4) {
      for (let i = 0; i < keys.length; i++) {
        const key = source[i] ?? 0,
          digit = ((key + offset) >>> shift) & 255,
          index = buckets[digit] ?? 0
        destination[index] = key
        buckets[digit] = index + 1
      }
    } else {
      for (let i = 0; i < keys.length; i++) {
        const key = source[i] ?? 0,
          digit = (Math.floor((key + offset) / 4294967296) >>> shift) & 255,
          index = buckets[digit] ?? 0
        destination[index] = key
        buckets[digit] = index + 1
      }
    }
    const swap = source
    source = destination
    destination = swap
  }
  if (source !== keys) keys.set(source.subarray(0, keys.length))
}
