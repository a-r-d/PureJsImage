import { describe, expect, it } from 'vitest'

import {
  HevcCabacContext,
  HevcCabacDecoder,
  initializeHevcCabacContext,
} from '../src/codecs/hevc-cabac.ts'

describe('HEVC CABAC context initialization', () => {
  it('derives the probability state and MPS from initValue and clipped SliceQpY', () => {
    expect(initializeHevcCabacContext(153, 26)).toMatchObject({
      state: 7,
      mostProbableSymbol: 0,
    })
    expect(initializeHevcCabacContext(200, 26)).toMatchObject({
      state: 8,
      mostProbableSymbol: 1,
    })
    expect(initializeHevcCabacContext(153, -12)).toMatchObject({
      state: 7,
      mostProbableSymbol: 0,
    })
  })

  it('rejects invalid context states and initialization inputs', () => {
    expect(() => new HevcCabacContext(64, 0)).toThrow('context state')
    expect(() => initializeHevcCabacContext(256, 26)).toThrow('initialization value')
    expect(() => initializeHevcCabacContext(153, 52)).toThrow('slice QP')
  })
})

describe('HEVC CABAC arithmetic decoding', () => {
  it('decodes MPS decisions and renormalizes with bounded input reads', () => {
    const decoder = new HevcCabacDecoder(Uint8Array.of(0, 0))
    const context = initializeHevcCabacContext(153, 26)

    expect(decoder.decodeDecision(context)).toBe(0)
    expect(context.state).toBe(8)
    expect(decoder.currentRange).toBe(344)
    expect(decoder.bitsRead).toBe(9)

    expect(decoder.decodeDecision(context)).toBe(0)
    expect(context.state).toBe(9)
    expect(decoder.currentRange).toBe(456)
    expect(decoder.bitsRead).toBe(10)
  })

  it('decodes an LPS decision and applies its state transition', () => {
    const decoder = new HevcCabacDecoder(Uint8Array.of(0xfe, 0x80))
    const context = initializeHevcCabacContext(153, 26)

    expect(decoder.decodeDecision(context)).toBe(1)
    expect(context.state).toBe(5)
    expect(context.mostProbableSymbol).toBe(0)
    expect(decoder.currentRange).toBe(332)
    expect(decoder.currentOffset).toBe(330)
    expect(decoder.bitsRead).toBe(10)
  })

  it('decodes bypass bins and terminal decisions', () => {
    const bypass = new HevcCabacDecoder(Uint8Array.of(0x7f, 0xc0))
    expect(bypass.decodeBypass()).toBe(1)
    expect(bypass.decodeBypass()).toBe(0)
    expect(bypass.decodeBypassBits(2)).toBe(0)

    const terminal = new HevcCabacDecoder(Uint8Array.of(0xfe, 0x80))
    expect(terminal.decodeTerminate()).toBe(1)
    expect(terminal.terminated).toBe(true)
    expect(() => terminal.decodeBypass()).toThrow('already terminated')
  })

  it('rejects forbidden initial offsets and truncated renormalization input', () => {
    expect(() => new HevcCabacDecoder(Uint8Array.of(0xff, 0))).toThrow('initial offset')

    const decoder = new HevcCabacDecoder(Uint8Array.of(0, 0))
    const context = initializeHevcCabacContext(153, 26)
    expect(() => {
      for (let index = 0; index < 100; index += 1) decoder.decodeDecision(context)
    }).toThrow('truncated')
  })
})
