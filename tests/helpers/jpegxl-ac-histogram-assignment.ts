import { assignCachedAcHistograms } from '../../src/codecs/jpegxl-jpeg-encode.ts'

export const acAssignmentSymbolCounts = [2, 4, 7, 8, 17] as const

export function runAcAssignmentFixture(count: number, active: readonly number[], symbolCount = 2) {
  const first = new Uint32Array(symbolCount),
    last = new Uint32Array(symbolCount),
    both = new Uint32Array(symbolCount),
    firstCluster = new Uint32Array(symbolCount),
    lastCluster = new Uint32Array(symbolCount),
    balancedCluster = new Uint32Array(symbolCount)
  first[0] = both[0] = count
  last[symbolCount - 1] = both[symbolCount - 1] = count
  firstCluster[0] = lastCluster[symbolCount - 1] = 1000
  balancedCluster[0] = balancedCluster[symbolCount - 1] = 500
  const frequencies = [first, last, both, new Uint32Array(symbolCount)]
  const clusters = [
    firstCluster,
    lastCluster,
    firstCluster.slice(),
    balancedCluster,
    new Uint32Array(symbolCount),
  ]
  const assignments = new Uint8Array(4).fill(99),
    costs = new Float64Array(4),
    logarithms = new Float64Array(symbolCount)
  assignCachedAcHistograms(
    frequencies,
    active,
    clusters,
    [1000, 1000, 1000, 1000, 0],
    assignments,
    symbolCount,
    costs,
    logarithms,
  )
  return { assignments, costs }
}

export function verifyAcAssignmentBrowser() {
  const rows = []
  for (const count of [10, 0xffffffff])
    for (const symbolCount of acAssignmentSymbolCounts)
      for (const active of [
        [0, 1, 2, 3],
        [3, 2, 1, 0],
      ]) {
        const { assignments, costs } = runAcAssignmentFixture(count, active, symbolCount)
        rows.push({
          count,
          symbolCount,
          assignments: [...assignments],
          zeroCost: costs[3],
          finitePositiveCosts: costs
            .subarray(0, 3)
            .every((value) => Number.isFinite(value) && value > 0),
        })
      }
  return rows
}
