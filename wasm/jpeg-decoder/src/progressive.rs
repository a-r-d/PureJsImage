//! Progressive entropy scans. The host owns the compact coefficient planes and
//! stages one MCU row at a time. Only the entropy register, restart counters,
//! predictors and end-of-band run survive a call.
use super::*;

#[derive(Clone, Copy, Default)]
pub(super) struct Scan {
    start: usize,
    end: usize,
    high: u8,
    low: u8,
    count: usize,
    eob: u32,
    across: [usize; COMPONENTS],
    down: [usize; COMPONENTS],
}

impl Scan {
    pub(super) const fn empty() -> Self {
        Self {
            start: 0,
            end: 0,
            high: 0,
            low: 0,
            count: 0,
            eob: 0,
            across: [0; COMPONENTS],
            down: [0; COMPONENTS],
        }
    }
}

// The host has installed the selected Huffman tables in scan-selector order.
#[unsafe(no_mangle)]
pub extern "C" fn jpeg_progressive_scan(
    start: u32,
    end: u32,
    high: u32,
    low: u32,
    count: usize,
    interval: u32,
    tolerant: u32,
) -> u32 {
    let s = scratch();
    s.state.initialized = false;
    s.scan.count = 0;
    if count == 0
        || count > COMPONENTS
        || end > 63
        || start > end
        || (start == 0 && end != 0)
        || (start != 0 && count != 1)
        || low > 13
        || high > 13
        || (high != 0 && high != low + 1)
        || interval > 65535
        || tolerant > 1
    {
        return ERROR_CONFIGURATION;
    }
    let mut scan = Scan {
        start: start as usize,
        end: end as usize,
        high: high as u8,
        low: low as u8,
        count,
        ..Default::default()
    };
    let mut blocks = 0;
    for c in 0..count {
        let h = usize::from(s.horizontal_sampling[c]);
        let v = usize::from(s.vertical_sampling[c]);
        if !(1..=4).contains(&h) || !(1..=4).contains(&v) {
            return ERROR_CONFIGURATION;
        }
        scan.across[c] = if count == 1 { 1 } else { h };
        scan.down[c] = if count == 1 { 1 } else { v };
        blocks += scan.across[c] * scan.down[c];
        if start != 0 || high == 0 {
            if let Err(status) = prepare_table(s, c, start != 0) {
                return status;
            }
        }
    }
    if blocks > 10 {
        return ERROR_CONFIGURATION;
    }
    s.scan = scan;
    s.state.bit_count = 0;
    s.state.bits = 0;
    s.state.predictors = [0; COMPONENTS];
    s.state.decoded_mcus = 0;
    s.state.restart_index = 0;
    s.state.restart_interval = interval as usize;
    s.state.next_restart_mcu = interval as usize;
    s.state.tolerant_decoding = tolerant != 0;
    // Two stuffed bytes per entropy byte. A single AC block has at most
    // 64 Huffman symbols and 64 amplitude or correction fields.
    s.state.maximum_mcu_bytes = if start == 0 { blocks * 8 + 4 } else { 514 };
    STATUS_OK
}

#[inline]
fn narrow(value: i32) -> Result<i16, u32> {
    i16::try_from(value).map_err(|_| ERROR_ENTROPY)
}

#[inline]
fn correct(s: &mut Scratch, coefficient: &mut i16, bit: i32) -> Result<(), u32> {
    let v = i32::from(*coefficient);
    // A correction sets a bit in the magnitude without changing the sign.
    let magnitude = v.abs() | ((read_bit(s)? as i32) * bit);
    *coefficient = narrow(if v < 0 { -magnitude } else { magnitude })?;
    Ok(())
}

fn decode_ac(s: &mut Scratch, block: &mut [i16], scan: Scan) -> Result<(), u32> {
    let bit = 1i32 << scan.low;
    let mut k = scan.start;
    if s.scan.eob == 0 {
        while k <= scan.end {
            let symbol = decode_huffman(s, 0, true)?;
            let mut zeros = usize::from(symbol >> 4);
            let size = symbol & 15;
            if size == 0 && zeros < 15 {
                s.scan.eob = (1 << zeros) + read_bits(s, zeros as u8)? as u32;
                break;
            }
            if scan.high == 0 {
                if size == 0 {
                    k += 16;
                    continue;
                }
                k += zeros;
                if size > 10 || k > scan.end {
                    return Err(ERROR_ENTROPY);
                }
                block[ZIG_ZAG[k]] = narrow(receive_and_extend(s, size)? * bit)?;
                k += 1;
                continue;
            }
            let new_value = match size {
                0 => {
                    zeros = 16;
                    0
                }
                1 => {
                    if read_bit(s)? != 0 {
                        bit
                    } else {
                        -bit
                    }
                }
                _ => return Err(ERROR_ENTROPY),
            };
            while k <= scan.end {
                let coef = &mut block[ZIG_ZAG[k]];
                if *coef != 0 {
                    correct(s, coef, bit)?;
                } else if zeros == 0 {
                    break;
                } else {
                    zeros -= 1;
                }
                k += 1;
                if size == 0 && zeros == 0 {
                    break;
                }
            }
            if size != 0 {
                if k > scan.end {
                    return Err(ERROR_ENTROPY);
                }
                block[ZIG_ZAG[k]] = new_value as i16;
                k += 1;
            }
        }
    }
    if s.scan.eob != 0 {
        if scan.high != 0 {
            for &idx in &ZIG_ZAG[k..=scan.end] {
                if block[idx] != 0 {
                    correct(s, &mut block[idx], bit)?;
                }
            }
        }
        s.scan.eob -= 1;
    }
    Ok(())
}

fn decode_dc(s: &mut Scratch, c: usize, dc: &mut i16, scan: Scan) -> Result<(), u32> {
    if scan.high != 0 {
        *dc |= (read_bit(s)? as i16) << scan.low;
    } else {
        let size = decode_huffman(s, c, false)?;
        if size > 11 {
            return Err(ERROR_ENTROPY);
        }
        let value = s.state.predictors[c] + receive_and_extend(s, size)?;
        *dc = narrow(value * (1 << scan.low))?;
        s.state.predictors[c] = value;
    }
    Ok(())
}

// Positive results count completed MCUs. A short batch asks for more input.
// A negative result declines the accelerated scan before any pixels are emitted.
#[unsafe(no_mangle)]
pub extern "C" fn jpeg_progressive_batch(
    input: usize,
    length: usize,
    final_window: u32,
    row: usize,
    values: usize,
    columns: usize,
    first: usize,
) -> i32 {
    let s = scratch();
    let scan = s.scan;
    let memory = core::arch::wasm32::memory_size(0) * PAGE_BYTES;
    let scratch_end = SCRATCH.0.get() as usize + core::mem::size_of::<Scratch>();
    if scan.count == 0
        || columns == 0
        || columns > 8192
        || first >= columns
        || length > PAGE_BYTES
        || final_window > 1
        || input < scratch_end
        || input.checked_add(length).is_none_or(|end| end > row)
        || row & 1 != 0
        || values > 8192 * 10 * 64
        || row
            .checked_add(values * 2)
            .is_none_or(|end| end > memory || end > isize::MAX as usize)
    {
        return -(ERROR_CONFIGURATION as i32);
    }
    let mut starts = [0; COMPONENTS];
    let mut required = 0;
    for (c, start) in starts.iter_mut().enumerate().take(scan.count) {
        *start = required;
        required += columns * scan.across[c] * scan.down[c] * 64;
    }
    if required != values {
        return -(ERROR_CAPACITY as i32);
    }
    // SAFETY: range, alignment and separation from the module, input, and
    // static scratch are checked above. JS cannot re-enter a synchronous batch.
    let tile = unsafe { core::slice::from_raw_parts_mut(row as *mut i16, values) };
    s.state.input_pointer = input;
    s.state.input_length = length;
    s.state.input_offset = 0;
    s.state.final_window = final_window != 0;
    for x in first..columns {
        if !s.state.final_window && length - s.state.input_offset < s.state.maximum_mcu_bytes {
            return (x - first) as i32;
        }
        if s.state.restart_interval != 0 && s.state.decoded_mcus == s.state.next_restart_mcu {
            // Let the reference handle long or damaged restart gaps when the
            // next marker is outside this window.
            match restart(s) {
                Ok(0xd0..=0xd7) => (),
                _ => return -(ERROR_ENTROPY as i32),
            }
            s.state.restart_index = s.state.restart_index.wrapping_add(1);
            s.state.next_restart_mcu += s.state.restart_interval;
            s.state.predictors = [0; COMPONENTS];
            s.scan.eob = 0;
        }
        if scan.start != 0 {
            if let Err(status) = decode_ac(s, &mut tile[x * 64..(x + 1) * 64], scan) {
                return -(status as i32);
            }
        } else {
            for (c, &start) in starts.iter().enumerate().take(scan.count) {
                let h = scan.across[c];
                for by in 0..scan.down[c] {
                    let base = start + (by * columns + x) * h * 64;
                    for bx in 0..h {
                        if let Err(status) = decode_dc(s, c, &mut tile[base + bx * 64], scan) {
                            return -(status as i32);
                        }
                    }
                }
            }
        }
        s.state.decoded_mcus += 1;
    }
    (columns - first) as i32
}

pub(super) fn reconstruct(s: &mut Scratch, buffer: usize) -> Result<(), u32> {
    if s.state.input_offset == s.state.input_length {
        return Err(STATUS_NEED_INPUT);
    }
    let size = s.state.block_size;
    // SAFETY: start checks that this aligned row is wholly inside linear
    // memory, past static scratch and disjoint from both reconstruction planes.
    let values = unsafe {
        core::slice::from_raw_parts(
            s.state.input_pointer as *const i16,
            s.state.input_length / 2,
        )
    };
    let mut blocks = values.chunks_exact(64);
    for c in 0..COMPONENTS {
        let columns = s.state.plane_widths[c] / size;
        let rows = s.state.plane_core_heights[c] / size;
        for y in 0..rows {
            for x in 0..columns {
                let block = blocks.next().ok_or(ERROR_CAPACITY)?;
                for v in 0..size {
                    for u in 0..size {
                        s.coefficients[8 * v + u] = i32::from(block[8 * v + u]);
                    }
                }
                inverse_dct(s, c, buffer, x, y, true);
            }
        }
    }
    s.state.input_offset = s.state.input_length;
    s.state.next_row += 1;
    Ok(())
}
