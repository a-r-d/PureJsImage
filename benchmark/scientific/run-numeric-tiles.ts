import type { NumericTileAllocator } from '../../src/scientific/index.ts'
import { rasterBlockToNumericTile } from '../../src/scientific/index.ts'

const width = 1024
const height = 256
const sampleCount = width * height
const iterations = 30
const canonical = new Uint8Array(sampleCount * 2)
const view = new DataView(canonical.buffer)
let expected = 0
for (let index = 0; index < sampleCount; index += 1) {
  const value = index % 65_521
  view.setUint16(index * 2, value, false)
  expected += value
}

let liveBytes = 0
let peakLiveBytes = 0
const allocator: NumericTileAllocator = {
  allocate({ minimumElements, sampleType }) {
    if (sampleType !== 'uint16') throw new Error(`Unexpected benchmark type ${sampleType}`)
    const data = new Uint16Array(minimumElements)
    liveBytes += data.byteLength
    peakLiveBytes = Math.max(peakLiveBytes, liveBytes)
    let released = false
    return {
      data,
      release() {
        if (released) return
        released = true
        liveBytes -= data.byteLength
      },
    }
  },
}

let conversionMilliseconds = 0
let computationMilliseconds = 0
let checksum = 0
for (let iteration = 0; iteration < iterations + 5; iteration += 1) {
  const conversionStart = performance.now()
  const tile = rasterBlockToNumericTile(
    {
      x: 0,
      y: 0,
      width,
      height,
      stride: width * 2,
      format: { sampleType: 'uint16', channels: 1, planar: false },
      data: canonical,
    },
    { allocator },
  )
  const conversionEnd = performance.now()
  if (!(tile.data instanceof Uint16Array)) throw new Error('Benchmark conversion type mismatch')
  let sum = 0
  for (let y = 0; y < tile.height; y += 1) {
    const row = y * tile.rowStrideElements
    for (let x = 0; x < tile.width; x += 1) sum += tile.data[row + x] ?? 0
  }
  const computationEnd = performance.now()
  tile.release()
  if (sum !== expected) {
    throw new Error(`Numeric tile benchmark checksum ${sum} does not match ${expected}`)
  }
  if (iteration >= 5) {
    conversionMilliseconds += conversionEnd - conversionStart
    computationMilliseconds += computationEnd - conversionEnd
    checksum = sum
  }
}

const totalMilliseconds = conversionMilliseconds + computationMilliseconds
const processedSamples = sampleCount * iterations
console.log(
  JSON.stringify(
    {
      fixture: { width, height, sampleType: 'uint16', iterations },
      correctness: { checksum, expected, passed: checksum === expected },
      canonicalConversionMilliseconds: Number(conversionMilliseconds.toFixed(3)),
      computationAfterConversionMilliseconds: Number(computationMilliseconds.toFixed(3)),
      totalMilliseconds: Number(totalMilliseconds.toFixed(3)),
      throughputMegasamplesPerSecond: Number(
        (processedSamples / (totalMilliseconds / 1000) / 1_000_000).toFixed(3),
      ),
      allocation: {
        peakLiveTileBytes: peakLiveBytes,
        liveTileBytesAfterRelease: liveBytes,
        note: 'Caller-owned allocator accounting; JavaScript heap retention is not inferred.',
      },
    },
    null,
    2,
  ),
)
