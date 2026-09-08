import { expect, it } from 'vitest'
import {
  JpegXlVarDctMemoryLedger,
  retainedTypedArrayBytes,
} from '../src/codecs/jpegxl-vardct-memory.ts'

it('counts each retained backing allocation once, including shared views and cycles', () => {
  const backing = new ArrayBuffer(1024)
  const first = new Uint8Array(backing, 128, 32)
  const second = new DataView(backing, 256, 16)
  const cycle: { views: unknown[]; self?: unknown } = { views: [first, second, backing, first] }
  cycle.self = cycle
  expect(retainedTypedArrayBytes(cycle)).toBe(1024)
})

it('rolls back failed request allocations without releasing pre-existing LF cache leases', () => {
  const ledger = new JpegXlVarDctMemoryLedger(1024)
  const cache = ledger.retain('cached-lf', 200)
  const rollback = ledger.checkpoint()
  const request = ledger.retain('request', 700)
  expect(() => ledger.retain('over-budget', 200)).toThrow()
  rollback()
  rollback()
  request.release()
  expect(ledger.liveBytes).toBe(200)
  const next = ledger.retain('next-request', 100)
  rollback()
  expect(ledger.liveBytes).toBe(300)
  cache.release()
  next.release()
  expect(ledger.liveBytes).toBe(0)
})
