#![no_std]

use core::cell::UnsafeCell;

// The ABI is intentionally scalar so it works in every modern WASM runtime.
const ABI_VERSION: u32 = 4;
const BLOCK: usize = 8;
const BLOCK_VALUES: usize = BLOCK * BLOCK;
const COMPONENTS: usize = 3;
const HUFFMAN_LENGTHS: usize = 16;
const HUFFMAN_SYMBOLS: usize = 256;
const PLANE_CAPACITY: usize = 1_048_576;
const OUTPUT_CAPACITY: usize = 1_048_576;
const PAGE_BYTES: usize = 65_536;

const STATUS_OK: u32 = 0;
const HUFFMAN_LOOKAHEAD: usize = 8;
const HUFFMAN_LOOKUP_SIZE: usize = 1 << HUFFMAN_LOOKAHEAD;
const STATUS_DONE: u32 = 1;
const ERROR_CONFIGURATION: u32 = 10;
const ERROR_TRUNCATED: u32 = 11;
const ERROR_ENTROPY: u32 = 12;
const ERROR_CAPACITY: u32 = 13;
const ERROR_ARITHMETIC: u32 = 14;
const INTERNAL_UNEXPECTED_RESTART: u32 = 15;

const IDCT_BASIS: [f64; BLOCK_VALUES] = [
    0.35355339059327379,
    0.35355339059327379,
    0.35355339059327379,
    0.35355339059327379,
    0.35355339059327379,
    0.35355339059327379,
    0.35355339059327379,
    0.35355339059327379,
    0.49039264020161522,
    0.41573480615127262,
    0.27778511650980114,
    0.097545161008064166,
    -0.097545161008064096,
    -0.27778511650980098,
    -0.41573480615127267,
    -0.49039264020161522,
    0.46193976625564337,
    0.19134171618254492,
    -0.19134171618254486,
    -0.46193976625564337,
    -0.46193976625564342,
    -0.19134171618254517,
    0.191341716182545,
    0.46193976625564326,
    0.41573480615127262,
    -0.097545161008064096,
    -0.49039264020161522,
    -0.27778511650980109,
    0.27778511650980092,
    0.49039264020161522,
    0.097545161008064388,
    -0.41573480615127256,
    0.35355339059327379,
    -0.35355339059327373,
    -0.35355339059327384,
    0.35355339059327368,
    0.35355339059327384,
    -0.35355339059327334,
    -0.35355339059327356,
    0.35355339059327329,
    0.27778511650980114,
    -0.49039264020161522,
    0.097545161008064152,
    0.41573480615127278,
    -0.41573480615127256,
    -0.097545161008064013,
    0.49039264020161533,
    -0.27778511650980076,
    0.19134171618254492,
    -0.46193976625564342,
    0.46193976625564326,
    -0.19134171618254495,
    -0.19134171618254528,
    0.46193976625564337,
    -0.4619397662556432,
    0.19134171618254478,
    0.097545161008064166,
    -0.27778511650980109,
    0.41573480615127278,
    -0.49039264020161533,
    0.49039264020161522,
    -0.41573480615127251,
    0.27778511650980076,
    -0.097545161008064291,
];

#[derive(Clone, Copy)]
struct DecoderState {
    input_pointer: usize,
    input_length: usize,
    input_offset: usize,
    bits: u32,
    bit_count: u8,
    width: usize,
    height: usize,
    maximum_vertical_sampling: usize,
    mcus_per_line: usize,
    mcus_per_column: usize,
    restart_interval: usize,
    next_restart_mcu: usize,
    decoded_mcus: usize,
    restart_index: u8,
    tolerant_decoding: bool,
    entropy_ended: bool,
    unexpected_restart: u8,
    predictors: [i32; COMPONENTS],
    plane_offsets: [usize; COMPONENTS],
    plane_widths: [usize; COMPONENTS],
    plane_core_heights: [usize; COMPONENTS],
    pending_buffer: usize,
    current_buffer: usize,
    pending_row: usize,
    next_row: usize,
    output_y: usize,
    output_height: usize,
    output_stride: usize,
    x_left_pointer: usize,
    x_right_pointer: usize,
    x_weights_pointer: usize,
    planes_pointer: usize,
    plane_buffer_bytes: usize,
    output_pointer: usize,
    output_capacity: usize,
    pending: bool,
    initialized: bool,
    finished: bool,
}

impl DecoderState {
    const fn empty() -> Self {
        Self {
            input_pointer: 0,
            input_length: 0,
            input_offset: 0,
            bits: 0,
            bit_count: 0,
            width: 0,
            height: 0,
            maximum_vertical_sampling: 0,
            mcus_per_line: 0,
            mcus_per_column: 0,
            restart_interval: 0,
            next_restart_mcu: 0,
            decoded_mcus: 0,
            restart_index: 0,
            tolerant_decoding: false,
            entropy_ended: false,
            unexpected_restart: 0,
            predictors: [0; COMPONENTS],
            plane_offsets: [0; COMPONENTS],
            plane_widths: [0; COMPONENTS],
            plane_core_heights: [0; COMPONENTS],
            pending_buffer: 0,
            current_buffer: 1,
            pending_row: 0,
            next_row: 0,
            output_y: 0,
            output_height: 0,
            output_stride: 0,
            x_left_pointer: 0,
            x_right_pointer: 0,
            x_weights_pointer: 0,
            planes_pointer: 0,
            plane_buffer_bytes: 0,
            output_pointer: 0,
            output_capacity: 0,
            pending: false,
            initialized: false,
            finished: false,
        }
    }
}

#[repr(C, align(16))]
struct Scratch {
    quantization: [i32; COMPONENTS * BLOCK_VALUES],
    dc_counts: [u8; COMPONENTS * HUFFMAN_LENGTHS],
    dc_symbols: [u8; COMPONENTS * HUFFMAN_SYMBOLS],
    ac_counts: [u8; COMPONENTS * HUFFMAN_LENGTHS],
    ac_symbols: [u8; COMPONENTS * HUFFMAN_SYMBOLS],
    horizontal_sampling: [u8; COMPONENTS],
    vertical_sampling: [u8; COMPONENTS],
    dc_first_codes: [i32; COMPONENTS * HUFFMAN_LENGTHS],
    dc_first_symbols: [i32; COMPONENTS * HUFFMAN_LENGTHS],
    ac_first_codes: [i32; COMPONENTS * HUFFMAN_LENGTHS],
    ac_first_symbols: [i32; COMPONENTS * HUFFMAN_LENGTHS],
    dc_lookup_lengths: [u8; COMPONENTS * HUFFMAN_LOOKUP_SIZE],
    dc_lookup_symbols: [u8; COMPONENTS * HUFFMAN_LOOKUP_SIZE],
    ac_lookup_lengths: [u8; COMPONENTS * HUFFMAN_LOOKUP_SIZE],
    ac_lookup_symbols: [u8; COMPONENTS * HUFFMAN_LOOKUP_SIZE],
    coefficients: [i32; BLOCK_VALUES],
    workspace: [f64; BLOCK_VALUES],
    active_rows: [u8; BLOCK],
    state: DecoderState,
}

struct SharedScratch(UnsafeCell<Scratch>);

// Each module instance is leased to one synchronous decoder. No reference to
// this fixed scratch storage escapes a WebAssembly export.
unsafe impl Sync for SharedScratch {}

static SCRATCH: SharedScratch = SharedScratch(UnsafeCell::new(Scratch {
    quantization: [0; COMPONENTS * BLOCK_VALUES],
    dc_counts: [0; COMPONENTS * HUFFMAN_LENGTHS],
    dc_symbols: [0; COMPONENTS * HUFFMAN_SYMBOLS],
    ac_counts: [0; COMPONENTS * HUFFMAN_LENGTHS],
    ac_symbols: [0; COMPONENTS * HUFFMAN_SYMBOLS],
    horizontal_sampling: [0; COMPONENTS],
    vertical_sampling: [0; COMPONENTS],
    dc_first_codes: [0; COMPONENTS * HUFFMAN_LENGTHS],
    dc_first_symbols: [0; COMPONENTS * HUFFMAN_LENGTHS],
    ac_first_codes: [0; COMPONENTS * HUFFMAN_LENGTHS],
    ac_first_symbols: [0; COMPONENTS * HUFFMAN_LENGTHS],
    dc_lookup_lengths: [0; COMPONENTS * HUFFMAN_LOOKUP_SIZE],
    dc_lookup_symbols: [0; COMPONENTS * HUFFMAN_LOOKUP_SIZE],
    ac_lookup_lengths: [0; COMPONENTS * HUFFMAN_LOOKUP_SIZE],
    ac_lookup_symbols: [0; COMPONENTS * HUFFMAN_LOOKUP_SIZE],
    coefficients: [0; BLOCK_VALUES],
    workspace: [0.0; BLOCK_VALUES],
    active_rows: [0; BLOCK],
    state: DecoderState::empty(),
}));

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

fn scratch() -> &'static mut Scratch {
    // SAFETY: JavaScript enforces a single synchronous lease per instance and
    // all exports finish before control returns to JavaScript.
    unsafe { &mut *SCRATCH.0.get() }
}

#[unsafe(no_mangle)]
pub extern "C" fn jpeg_decoder_abi_version() -> u32 {
    ABI_VERSION
}
#[unsafe(no_mangle)]
pub extern "C" fn jpeg_decoder_simd() -> u32 {
    if cfg!(feature = "simd") { 1 } else { 0 }
}

macro_rules! export_pointer {
    ($name:ident, $field:ident) => {
        #[unsafe(no_mangle)]
        pub extern "C" fn $name() -> u32 {
            unsafe { core::ptr::addr_of_mut!((*SCRATCH.0.get()).$field) as usize as u32 }
        }
    };
}

export_pointer!(jpeg_decoder_quantization_ptr, quantization);
export_pointer!(jpeg_decoder_dc_counts_ptr, dc_counts);
export_pointer!(jpeg_decoder_dc_symbols_ptr, dc_symbols);
export_pointer!(jpeg_decoder_ac_counts_ptr, ac_counts);
export_pointer!(jpeg_decoder_ac_symbols_ptr, ac_symbols);
export_pointer!(jpeg_decoder_horizontal_sampling_ptr, horizontal_sampling);
export_pointer!(jpeg_decoder_vertical_sampling_ptr, vertical_sampling);
#[unsafe(no_mangle)]
pub extern "C" fn jpeg_decoder_plane_capacity() -> u32 {
    PLANE_CAPACITY as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn jpeg_decoder_output_capacity() -> u32 {
    OUTPUT_CAPACITY as u32
}

fn configure_huffman(
    counts: &[u8],
    first_codes: &mut [i32],
    first_symbols: &mut [i32],
) -> Result<(), u32> {
    let mut code = 0i32;
    let mut symbol = 0i32;
    for length in 0..HUFFMAN_LENGTHS {
        let count = i32::from(counts[length]);
        first_codes[length] = code;
        first_symbols[length] = symbol;
        if code.checked_add(count).ok_or(ERROR_ARITHMETIC)? > (1i32 << (length + 1)) {
            return Err(ERROR_CONFIGURATION);
        }
        code = code
            .checked_add(count)
            .and_then(|value| value.checked_mul(2))
            .ok_or(ERROR_ARITHMETIC)?;
        symbol = symbol.checked_add(count).ok_or(ERROR_ARITHMETIC)?;
    }
    if symbol < 1 || symbol as usize > HUFFMAN_SYMBOLS {
        return Err(ERROR_CONFIGURATION);
    }
    Ok(())
}

fn configure_huffman_lookup(
    counts: &[u8],
    symbols: &[u8],
    lengths: &mut [u8],
    lookup_symbols: &mut [u8],
) {
    lengths.fill(0);
    let mut code = 0usize;
    let mut symbol_offset = 0usize;
    for length in 1..=HUFFMAN_LENGTHS {
        let count = usize::from(counts[length - 1]);
        if length <= HUFFMAN_LOOKAHEAD {
            let repetitions = 1usize << (HUFFMAN_LOOKAHEAD - length);
            for relative in 0..count {
                let lookup_start = (code + relative) << (HUFFMAN_LOOKAHEAD - length);
                let symbol = symbols[symbol_offset + relative];
                for lookup in lookup_start..lookup_start + repetitions {
                    lengths[lookup] = length as u8;
                    lookup_symbols[lookup] = symbol;
                }
            }
        }
        code = (code + count) << 1;
        symbol_offset += count;
    }
}

fn input_byte(scratch: &Scratch, offset: usize) -> Result<u8, u32> {
    if offset >= scratch.state.input_length {
        return Err(ERROR_TRUNCATED);
    }
    // SAFETY: start validates the complete input range against current linear
    // memory and every access is bounded by input_length.
    Ok(unsafe { *((scratch.state.input_pointer + offset) as *const u8) })
}

#[inline(always)]
fn plane_byte(scratch: &Scratch, buffer: usize, offset: usize) -> u8 {
    // SAFETY: start validates both plane buffers and all callers use offsets
    // bounded by the computed per-row plane layout.
    unsafe {
        *((scratch.state.planes_pointer + buffer * scratch.state.plane_buffer_bytes + offset)
            as *const u8)
    }
}

#[inline(always)]
fn set_plane_byte(scratch: &Scratch, buffer: usize, offset: usize, value: u8) {
    unsafe {
        *((scratch.state.planes_pointer + buffer * scratch.state.plane_buffer_bytes + offset)
            as *mut u8) = value;
    }
}

#[inline(always)]
fn set_output_byte(scratch: &Scratch, offset: usize, value: u8) {
    unsafe { *((scratch.state.output_pointer + offset) as *mut u8) = value }
}

fn entropy_byte(scratch: &mut Scratch) -> Result<u8, u32> {
    let value = input_byte(scratch, scratch.state.input_offset)?;
    scratch.state.input_offset += 1;
    if value != 0xff {
        return Ok(value);
    }
    let stuffed = input_byte(scratch, scratch.state.input_offset)?;
    scratch.state.input_offset += 1;
    if stuffed != 0 {
        if scratch.state.tolerant_decoding && (0xd0..=0xd7).contains(&stuffed) {
            scratch.state.unexpected_restart = stuffed;
            return Err(INTERNAL_UNEXPECTED_RESTART);
        }
        return Err(ERROR_ENTROPY);
    }
    Ok(0xff)
}

#[inline(always)]
fn fill_bits(scratch: &mut Scratch, length: u8) -> Result<(), u32> {
    while scratch.state.bit_count < length {
        let retained = if scratch.state.bit_count == 0 {
            0
        } else {
            scratch.state.bits & ((1u32 << scratch.state.bit_count) - 1)
        };
        scratch.state.bits = (retained << 8) | u32::from(entropy_byte(scratch)?);
        scratch.state.bit_count += 8;
    }
    Ok(())
}

#[inline(always)]
fn read_bits(scratch: &mut Scratch, length: u8) -> Result<i32, u32> {
    if length > 16 {
        return Err(ERROR_ENTROPY);
    }
    fill_bits(scratch, length)?;
    scratch.state.bit_count -= length;
    let mask = if length == 0 { 0 } else { (1u32 << length) - 1 };
    Ok(((scratch.state.bits >> scratch.state.bit_count) & mask) as i32)
}

#[inline(always)]
fn read_bit(scratch: &mut Scratch) -> Result<u32, u32> {
    Ok(read_bits(scratch, 1)? as u32)
}

#[inline(always)]
fn huffman_lookahead(scratch: &mut Scratch) -> Option<usize> {
    let bits = scratch.state.bits;
    let bit_count = scratch.state.bit_count;
    let input_offset = scratch.state.input_offset;
    if fill_bits(scratch, HUFFMAN_LOOKAHEAD as u8).is_err() {
        scratch.state.bits = bits;
        scratch.state.bit_count = bit_count;
        scratch.state.input_offset = input_offset;
        return None;
    }
    Some(
        ((scratch.state.bits >> (scratch.state.bit_count - HUFFMAN_LOOKAHEAD as u8))
            & (HUFFMAN_LOOKUP_SIZE as u32 - 1)) as usize,
    )
}

fn receive_and_extend(scratch: &mut Scratch, length: u8) -> Result<i32, u32> {
    if length == 0 {
        return Ok(0);
    }
    let value = read_bits(scratch, length)?;
    let threshold = 1i32 << (length - 1);
    Ok(if value >= threshold {
        value
    } else {
        value + (-1i32 << length) + 1
    })
}

fn decode_huffman(scratch: &mut Scratch, component: usize, ac: bool) -> Result<u8, u32> {
    if let Some(lookup) = huffman_lookahead(scratch) {
        let lookup_offset = component * HUFFMAN_LOOKUP_SIZE + lookup;
        let length = if ac {
            scratch.ac_lookup_lengths[lookup_offset]
        } else {
            scratch.dc_lookup_lengths[lookup_offset]
        };
        if length != 0 {
            scratch.state.bit_count -= length;
            return Ok(if ac {
                scratch.ac_lookup_symbols[lookup_offset]
            } else {
                scratch.dc_lookup_symbols[lookup_offset]
            });
        }
    }
    let mut code = 0i32;
    for length in 0..HUFFMAN_LENGTHS {
        code = (code << 1) | read_bit(scratch)? as i32;
        let table_offset = component * HUFFMAN_LENGTHS + length;
        let count = i32::from(if ac {
            scratch.ac_counts[table_offset]
        } else {
            scratch.dc_counts[table_offset]
        });
        let first_code = if ac {
            scratch.ac_first_codes[table_offset]
        } else {
            scratch.dc_first_codes[table_offset]
        };
        let relative = code - first_code;
        if relative >= 0 && relative < count {
            let first_symbol = if ac {
                scratch.ac_first_symbols[table_offset]
            } else {
                scratch.dc_first_symbols[table_offset]
            };
            let symbol = first_symbol + relative;
            if symbol < 0 || symbol as usize >= HUFFMAN_SYMBOLS {
                return Err(ERROR_ENTROPY);
            }
            return Ok(if ac {
                scratch.ac_symbols[component * HUFFMAN_SYMBOLS + symbol as usize]
            } else {
                scratch.dc_symbols[component * HUFFMAN_SYMBOLS + symbol as usize]
            });
        }
    }
    Err(ERROR_ENTROPY)
}

fn restart(scratch: &mut Scratch) -> Result<u8, u32> {
    scratch.state.bit_count = 0;
    if !scratch.state.tolerant_decoding {
        let mut marker = input_byte(scratch, scratch.state.input_offset)?;
        scratch.state.input_offset += 1;
        while marker == 0xff {
            marker = input_byte(scratch, scratch.state.input_offset)?;
            scratch.state.input_offset += 1;
        }
        let expected = 0xd0 + (scratch.state.restart_index & 7);
        if marker != expected {
            return Err(ERROR_ENTROPY);
        }
        return Ok(marker);
    }

    let recovery_end = scratch
        .state
        .input_offset
        .saturating_add(PAGE_BYTES)
        .min(scratch.state.input_length);
    while scratch.state.input_offset < recovery_end {
        if input_byte(scratch, scratch.state.input_offset)? != 0xff {
            scratch.state.input_offset += 1;
            continue;
        }
        scratch.state.input_offset += 1;
        while scratch.state.input_offset < recovery_end
            && input_byte(scratch, scratch.state.input_offset)? == 0xff
        {
            scratch.state.input_offset += 1;
        }
        if scratch.state.input_offset >= recovery_end {
            break;
        }
        let marker = input_byte(scratch, scratch.state.input_offset)?;
        scratch.state.input_offset += 1;
        if marker == 0 {
            continue;
        }
        if marker == 0xd9 || (0xd0..=0xd7).contains(&marker) {
            return Ok(marker);
        }
        return Err(ERROR_ENTROPY);
    }
    Err(ERROR_ENTROPY)
}

fn finish_entropy(scratch: &mut Scratch) -> Result<(), u32> {
    scratch.state.bits = 0;
    scratch.state.bit_count = 0;
    if scratch.state.entropy_ended {
        return Ok(());
    }
    while scratch.state.input_offset < scratch.state.input_length {
        if input_byte(scratch, scratch.state.input_offset)? != 0xff {
            scratch.state.input_offset += 1;
            continue;
        }
        scratch.state.input_offset += 1;
        while scratch.state.input_offset < scratch.state.input_length
            && input_byte(scratch, scratch.state.input_offset)? == 0xff
        {
            scratch.state.input_offset += 1;
        }
        if scratch.state.input_offset >= scratch.state.input_length {
            return Err(ERROR_TRUNCATED);
        }
        let marker = input_byte(scratch, scratch.state.input_offset)?;
        scratch.state.input_offset += 1;
        if marker == 0 {
            continue;
        }
        if marker == 0xd9 {
            return Ok(());
        }
        return Err(ERROR_ENTROPY);
    }
    Err(ERROR_TRUNCATED)
}

fn decode_block(scratch: &mut Scratch, component: usize) -> Result<bool, u32> {
    scratch.coefficients.fill(0);
    let dc_length = decode_huffman(scratch, component, false)?;
    let difference = receive_and_extend(scratch, dc_length)?;
    let predictor = scratch.state.predictors[component]
        .checked_add(difference)
        .ok_or(ERROR_ARITHMETIC)?;
    scratch.state.predictors[component] = predictor;
    scratch.coefficients[0] = predictor;

    let mut index = 1usize;
    let mut has_ac = false;
    while index < BLOCK_VALUES {
        let symbol = decode_huffman(scratch, component, true)?;
        let zeroes = usize::from(symbol >> 4);
        let length = symbol & 15;
        if length == 0 {
            if zeroes != 15 {
                break;
            }
            index = index.checked_add(16).ok_or(ERROR_ARITHMETIC)?;
            continue;
        }
        index = index.checked_add(zeroes).ok_or(ERROR_ARITHMETIC)?;
        if index >= BLOCK_VALUES {
            return Err(ERROR_ENTROPY);
        }
        const ZIG_ZAG: [usize; BLOCK_VALUES] = [
            0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34,
            27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37,
            44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
        ];
        scratch.coefficients[ZIG_ZAG[index]] = receive_and_extend(scratch, length)?;
        has_ac = true;
        index += 1;
    }
    Ok(has_ac)
}

#[inline(always)]
fn idct_sample(value: f64) -> u8 {
    let rounded = value + 128.5;
    if rounded <= 0.0 {
        0
    } else if rounded >= 255.0 {
        255
    } else {
        rounded as u8
    }
}

fn initialize_workspace_row(
    workspace: &mut [f64; BLOCK_VALUES],
    row_offset: usize,
    basis_offset: usize,
    scaled: f64,
) {
    #[cfg(all(target_arch = "wasm32", feature = "simd"))]
    {
        use core::arch::wasm32::*;
        // Both fixed arrays contain eight contiguous validated f64 values.
        unsafe {
            let scale = f64x2_splat(scaled);
            for x in (0..BLOCK).step_by(2) {
                let basis = v128_load(IDCT_BASIS.as_ptr().add(basis_offset + x) as *const v128);
                v128_store(
                    workspace.as_mut_ptr().add(row_offset + x) as *mut v128,
                    f64x2_mul(scale, basis),
                );
            }
        }
    }
    #[cfg(not(all(target_arch = "wasm32", feature = "simd")))]
    {
        for x in 0..BLOCK {
            workspace[row_offset + x] = scaled * IDCT_BASIS[basis_offset + x];
        }
    }
}

fn accumulate_workspace_row(
    workspace: &mut [f64; BLOCK_VALUES],
    row_offset: usize,
    basis_offset: usize,
    scaled: f64,
) {
    #[cfg(all(target_arch = "wasm32", feature = "simd"))]
    {
        use core::arch::wasm32::*;
        // Both fixed arrays contain eight contiguous validated f64 values.
        unsafe {
            let scale = f64x2_splat(scaled);
            for x in (0..BLOCK).step_by(2) {
                let target = workspace.as_mut_ptr().add(row_offset + x);
                let current = v128_load(target as *const v128);
                let basis = v128_load(IDCT_BASIS.as_ptr().add(basis_offset + x) as *const v128);
                v128_store(
                    target as *mut v128,
                    f64x2_add(current, f64x2_mul(scale, basis)),
                );
            }
        }
    }
    #[cfg(not(all(target_arch = "wasm32", feature = "simd")))]
    {
        for x in 0..BLOCK {
            workspace[row_offset + x] += scaled * IDCT_BASIS[basis_offset + x];
        }
    }
}

fn render_idct_row(
    scratch: &Scratch,
    buffer: usize,
    target: usize,
    y: usize,
    active_row_count: usize,
) {
    #[cfg(all(target_arch = "wasm32", feature = "simd"))]
    {
        use core::arch::wasm32::*;
        // Workspace pairs are contiguous and active_rows contains validated row indices.
        unsafe {
            for x in (0..BLOCK).step_by(2) {
                let mut value = f64x2_splat(0.0);
                for active_index in 0..active_row_count {
                    let vertical = usize::from(scratch.active_rows[active_index]);
                    let basis = f64x2_splat(IDCT_BASIS[vertical * BLOCK + y]);
                    let workspace = v128_load(
                        scratch.workspace.as_ptr().add(vertical * BLOCK + x) as *const v128
                    );
                    value = f64x2_add(value, f64x2_mul(basis, workspace));
                }
                set_plane_byte(
                    scratch,
                    buffer,
                    target + x,
                    idct_sample(f64x2_extract_lane::<0>(value)),
                );
                set_plane_byte(
                    scratch,
                    buffer,
                    target + x + 1,
                    idct_sample(f64x2_extract_lane::<1>(value)),
                );
            }
        }
    }
    #[cfg(not(all(target_arch = "wasm32", feature = "simd")))]
    {
        for x in 0..BLOCK {
            let mut value = 0.0;
            for active_index in 0..active_row_count {
                let vertical = usize::from(scratch.active_rows[active_index]);
                value += IDCT_BASIS[vertical * BLOCK + y] * scratch.workspace[vertical * BLOCK + x];
            }
            set_plane_byte(scratch, buffer, target + x, idct_sample(value));
        }
    }
}

fn inverse_dct(
    scratch: &mut Scratch,
    component: usize,
    buffer: usize,
    block_x: usize,
    block_y: usize,
    has_ac: bool,
) {
    let stride = scratch.state.plane_widths[component];
    let plane_offset = scratch.state.plane_offsets[component];
    if !has_ac {
        let scaled = f64::from(scratch.coefficients[0])
            * f64::from(scratch.quantization[component * BLOCK_VALUES]);
        // Match the TypeScript basis-matrix path exactly at half-integer
        // rounding boundaries. Multiplying the stored basis value twice is
        // observably different from replacing it with the exact 1/8 value.
        let sample = idct_sample(scaled * IDCT_BASIS[0] * IDCT_BASIS[0]);
        for y in 0..BLOCK {
            let target = plane_offset + (1 + block_y * BLOCK + y) * stride + block_x * BLOCK;
            for x in 0..BLOCK {
                set_plane_byte(scratch, buffer, target + x, sample);
            }
        }
        return;
    }
    let mut active_row_count = 0usize;
    let quantization_offset = component * BLOCK_VALUES;
    for vertical in 0..BLOCK {
        let row_offset = vertical * BLOCK;
        let mut row_active = false;
        for horizontal in 0..BLOCK {
            let index = row_offset + horizontal;
            let coefficient = scratch.coefficients[index];
            if coefficient == 0 {
                continue;
            }
            let scaled = f64::from(coefficient)
                * f64::from(scratch.quantization[quantization_offset + index]);
            if !row_active {
                scratch.active_rows[active_row_count] = vertical as u8;
                active_row_count += 1;
                row_active = true;
                initialize_workspace_row(
                    &mut scratch.workspace,
                    row_offset,
                    horizontal * BLOCK,
                    scaled,
                );
            } else {
                accumulate_workspace_row(
                    &mut scratch.workspace,
                    row_offset,
                    horizontal * BLOCK,
                    scaled,
                );
            }
        }
    }

    for y in 0..BLOCK {
        let target = plane_offset + (1 + block_y * BLOCK + y) * stride + block_x * BLOCK;
        render_idct_row(scratch, buffer, target, y, active_row_count);
    }
}

fn decode_mcu_row(scratch: &mut Scratch, row: usize, buffer: usize) -> Result<(), u32> {
    if scratch.state.tolerant_decoding {
        // SAFETY: start validates both complete plane buffers against WASM memory.
        unsafe {
            core::ptr::write_bytes(
                (scratch.state.planes_pointer + buffer * scratch.state.plane_buffer_bytes)
                    as *mut u8,
                0,
                scratch.state.plane_buffer_bytes,
            );
        }
    }
    for mcu_x in 0..scratch.state.mcus_per_line {
        if !scratch.state.entropy_ended
            && scratch.state.restart_interval > 0
            && scratch.state.decoded_mcus == scratch.state.next_restart_mcu
        {
            let marker = restart(scratch)?;
            if marker == 0xd9 {
                scratch.state.entropy_ended = true;
            } else {
                scratch.state.restart_index = marker - 0xd0 + 1;
                scratch.state.predictors = [0; COMPONENTS];
                scratch.state.next_restart_mcu = scratch
                    .state
                    .next_restart_mcu
                    .saturating_add(scratch.state.restart_interval);
            }
        }
        if !scratch.state.entropy_ended {
            let mut recovered_restart = false;
            'components: for component in 0..COMPONENTS {
                let horizontal = usize::from(scratch.horizontal_sampling[component]);
                let vertical = usize::from(scratch.vertical_sampling[component]);
                for block_y in 0..vertical {
                    for block_x in 0..horizontal {
                        match decode_block(scratch, component) {
                            Ok(has_ac) => inverse_dct(
                                scratch,
                                component,
                                buffer,
                                mcu_x * horizontal + block_x,
                                block_y,
                                has_ac,
                            ),
                            Err(INTERNAL_UNEXPECTED_RESTART) => {
                                recovered_restart = true;
                                break 'components;
                            }
                            Err(status) => return Err(status),
                        }
                    }
                }
            }
            if recovered_restart {
                if scratch.state.restart_interval == 0 {
                    return Err(ERROR_ENTROPY);
                }
                scratch.state.bits = 0;
                scratch.state.bit_count = 0;
                scratch.state.restart_index = scratch.state.unexpected_restart - 0xd0 + 1;
                scratch.state.predictors = [0; COMPONENTS];
                scratch.state.next_restart_mcu = scratch
                    .state
                    .decoded_mcus
                    .saturating_add(1)
                    .saturating_add(scratch.state.restart_interval);
            }
        }
        scratch.state.decoded_mcus += 1;
    }
    scratch.state.next_row = row + 1;
    Ok(())
}

fn copy_row(
    scratch: &mut Scratch,
    component: usize,
    source_buffer: usize,
    source_row: usize,
    target_buffer: usize,
    target_row: usize,
) {
    let offset = scratch.state.plane_offsets[component];
    let width = scratch.state.plane_widths[component];
    for x in 0..width {
        let value = plane_byte(scratch, source_buffer, offset + source_row * width + x);
        set_plane_byte(
            scratch,
            target_buffer,
            offset + target_row * width + x,
            value,
        );
    }
}

fn link_rows(scratch: &mut Scratch) {
    for component in 0..COMPONENTS {
        let last_core = scratch.state.plane_core_heights[component];
        copy_row(
            scratch,
            component,
            scratch.state.current_buffer,
            1,
            scratch.state.pending_buffer,
            last_core + 1,
        );
        copy_row(
            scratch,
            component,
            scratch.state.pending_buffer,
            last_core,
            scratch.state.current_buffer,
            0,
        );
    }
}

fn replicate_top(scratch: &mut Scratch, buffer: usize) {
    for component in 0..COMPONENTS {
        copy_row(scratch, component, buffer, 1, buffer, 0);
    }
}

fn replicate_bottom(scratch: &mut Scratch, buffer: usize) {
    for component in 0..COMPONENTS {
        let last_core = scratch.state.plane_core_heights[component];
        copy_row(scratch, component, buffer, last_core, buffer, last_core + 1);
    }
}

fn rounded_weight(value: f64) -> usize {
    (value * 256.0 + 0.5) as usize
}

#[inline(always)]
fn x_map_index(scratch: &Scratch, component: usize, output_x: usize) -> usize {
    component * scratch.state.width + output_x
}

#[inline(always)]
fn x_left(scratch: &Scratch, component: usize, output_x: usize) -> usize {
    let index = x_map_index(scratch, component, output_x);
    // SAFETY: start validates the complete map ranges and initializes every
    // entry before decoding begins.
    unsafe { *((scratch.state.x_left_pointer + index * 4) as *const u32) as usize }
}

#[inline(always)]
fn x_right(scratch: &Scratch, component: usize, output_x: usize) -> usize {
    let index = x_map_index(scratch, component, output_x);
    unsafe { *((scratch.state.x_right_pointer + index * 4) as *const u32) as usize }
}

#[inline(always)]
fn x_weight(scratch: &Scratch, component: usize, output_x: usize) -> usize {
    let index = x_map_index(scratch, component, output_x);
    unsafe { *((scratch.state.x_weights_pointer + index * 2) as *const u16) as usize }
}

#[inline(always)]
fn component_sample(
    scratch: &Scratch,
    component: usize,
    buffer: usize,
    output_x: usize,
    top_y: usize,
    bottom_y: usize,
    y_weight: usize,
) -> i32 {
    let width = scratch.state.plane_widths[component];
    let left_x = x_left(scratch, component, output_x);
    let right_x = x_right(scratch, component, output_x);
    let x_weight = x_weight(scratch, component, output_x);
    let offset = scratch.state.plane_offsets[component];
    let top = i32::from(plane_byte(scratch, buffer, offset + top_y * width + left_x))
        * (256 - x_weight) as i32
        + i32::from(plane_byte(
            scratch,
            buffer,
            offset + top_y * width + right_x,
        )) * x_weight as i32;
    let bottom = i32::from(plane_byte(
        scratch,
        buffer,
        offset + bottom_y * width + left_x,
    )) * (256 - x_weight) as i32
        + i32::from(plane_byte(
            scratch,
            buffer,
            offset + bottom_y * width + right_x,
        )) * x_weight as i32;
    (top * (256 - y_weight) as i32 + bottom * y_weight as i32 + 32_768) >> 16
}

fn clamp_to_u8(value: f64) -> u8 {
    if value <= 0.0 {
        return 0;
    }
    if value >= 255.0 {
        return 255;
    }
    value as u8
}

#[inline(always)]
fn half_resolution_coordinates(output_x: usize, width: usize) -> (usize, usize, usize) {
    if output_x == 0 {
        return (0, 0, 0);
    }
    let left = (output_x - 1) >> 1;
    if left >= width - 1 {
        return (width - 1, width - 1, 0);
    }
    (left, left + 1, if output_x & 1 == 0 { 192 } else { 64 })
}

#[inline(always)]
fn sample_half_horizontal(
    scratch: &Scratch,
    component: usize,
    buffer: usize,
    left: usize,
    right: usize,
    weight: usize,
    row: usize,
) -> i32 {
    let width = scratch.state.plane_widths[component];
    let offset = scratch.state.plane_offsets[component] + row * width;
    (i32::from(plane_byte(scratch, buffer, offset + left)) * (256 - weight) as i32
        + i32::from(plane_byte(scratch, buffer, offset + right)) * weight as i32
        + 128)
        >> 8
}

#[inline(always)]
fn sample_half_bilinear(
    scratch: &Scratch,
    component: usize,
    buffer: usize,
    left: usize,
    right: usize,
    x_weight: usize,
    top_y: usize,
    bottom_y: usize,
    y_weight: usize,
) -> i32 {
    let width = scratch.state.plane_widths[component];
    let offset = scratch.state.plane_offsets[component];
    let top_offset = offset + top_y * width;
    let bottom_offset = offset + bottom_y * width;
    let top = i32::from(plane_byte(scratch, buffer, top_offset + left)) * (256 - x_weight) as i32
        + i32::from(plane_byte(scratch, buffer, top_offset + right)) * x_weight as i32;
    let bottom = i32::from(plane_byte(scratch, buffer, bottom_offset + left))
        * (256 - x_weight) as i32
        + i32::from(plane_byte(scratch, buffer, bottom_offset + right)) * x_weight as i32;
    (top * (256 - y_weight) as i32 + bottom * y_weight as i32 + 32_768) >> 16
}

#[inline(always)]
fn sample_half_pair_numerators(
    scratch: &Scratch,
    component: usize,
    buffer: usize,
    output_x: usize,
    row: usize,
) -> (i32, i32) {
    let width = scratch.state.plane_widths[component];
    let offset = scratch.state.plane_offsets[component] + row * width;
    let middle = output_x >> 1;
    if output_x == 0 {
        let first = i32::from(plane_byte(scratch, buffer, offset));
        let second = if width == 1 {
            first << 8
        } else {
            let right = i32::from(plane_byte(scratch, buffer, offset + 1));
            first * 192 + right * 64
        };
        return (first << 8, second);
    }
    let left = i32::from(plane_byte(scratch, buffer, offset + middle - 1));
    let center = i32::from(plane_byte(scratch, buffer, offset + middle));
    let first = left * 64 + center * 192;
    let second = if middle >= width - 1 {
        center << 8
    } else {
        let right = i32::from(plane_byte(scratch, buffer, offset + middle + 1));
        center * 192 + right * 64
    };
    (first, second)
}

#[inline(always)]
fn sample_half_vertical(top: i32, bottom: i32, weight: i32) -> i32 {
    ((top * (256 - weight) + bottom * weight + 32_768) >> 16) - 128
}

#[inline(always)]
fn sample_420_pixel(
    scratch: &Scratch,
    buffer: usize,
    output_x: usize,
    y_row: usize,
    top: usize,
    bottom: usize,
    y_weight: usize,
) -> (i32, i32, i32) {
    let y = i32::from(plane_byte(
        scratch,
        buffer,
        scratch.state.plane_offsets[0] + y_row * scratch.state.plane_widths[0] + output_x,
    ));
    let (left, right, x_weight) =
        half_resolution_coordinates(output_x, scratch.state.plane_widths[1]);
    let cb = sample_half_bilinear(
        scratch, 1, buffer, left, right, x_weight, top, bottom, y_weight,
    ) - 128;
    let cr = sample_half_bilinear(
        scratch, 2, buffer, left, right, x_weight, top, bottom, y_weight,
    ) - 128;
    (y, cb, cr)
}

#[inline(always)]
fn write_rgb(scratch: &Scratch, target: usize, y: i32, cb: i32, cr: i32) {
    set_output_byte(
        scratch,
        target,
        clamp_to_u8(f64::from(y) + 1.402 * f64::from(cr)),
    );
    set_output_byte(
        scratch,
        target + 1,
        clamp_to_u8(f64::from(y) - 0.3441363 * f64::from(cb) - 0.71413636 * f64::from(cr)),
    );
    set_output_byte(
        scratch,
        target + 2,
        clamp_to_u8(f64::from(y) + 1.772 * f64::from(cb)),
    );
}

#[cfg(all(target_arch = "wasm32", feature = "simd"))]
#[target_feature(enable = "simd128")]
unsafe fn write_rgb_pair(
    scratch: &Scratch,
    target: usize,
    first: (i32, i32, i32),
    second: (i32, i32, i32),
) {
    use core::arch::wasm32::*;
    let y = f64x2(first.0 as f64, second.0 as f64);
    let cb = f64x2(first.1 as f64, second.1 as f64);
    let cr = f64x2(first.2 as f64, second.2 as f64);
    let red = f64x2_add(y, f64x2_mul(cr, f64x2_splat(1.402)));
    let green = f64x2_sub(
        f64x2_sub(y, f64x2_mul(cb, f64x2_splat(0.3441363))),
        f64x2_mul(cr, f64x2_splat(0.71413636)),
    );
    let blue = f64x2_add(y, f64x2_mul(cb, f64x2_splat(1.772)));
    set_output_byte(scratch, target, clamp_to_u8(f64x2_extract_lane::<0>(red)));
    set_output_byte(
        scratch,
        target + 1,
        clamp_to_u8(f64x2_extract_lane::<0>(green)),
    );
    set_output_byte(
        scratch,
        target + 2,
        clamp_to_u8(f64x2_extract_lane::<0>(blue)),
    );
    set_output_byte(
        scratch,
        target + 3,
        clamp_to_u8(f64x2_extract_lane::<1>(red)),
    );
    set_output_byte(
        scratch,
        target + 4,
        clamp_to_u8(f64x2_extract_lane::<1>(green)),
    );
    set_output_byte(
        scratch,
        target + 5,
        clamp_to_u8(f64x2_extract_lane::<1>(blue)),
    );
}

fn render_420(scratch: &Scratch, height: usize, stride: usize) {
    let buffer = scratch.state.pending_buffer;
    let y_offset = scratch.state.plane_offsets[0];
    let y_width = scratch.state.plane_widths[0];
    for local_y in 0..height {
        let top = (local_y + 1) >> 1;
        let bottom = top + 1;
        let weight = if local_y & 1 == 0 { 192 } else { 64 };
        let y_row_offset = y_offset + (1 + local_y) * y_width;
        let mut x = 0;
        while x + 1 < scratch.state.width {
            let (cb_top_first, cb_top_second) =
                sample_half_pair_numerators(scratch, 1, buffer, x, top);
            let (cb_bottom_first, cb_bottom_second) =
                sample_half_pair_numerators(scratch, 1, buffer, x, bottom);
            let (cr_top_first, cr_top_second) =
                sample_half_pair_numerators(scratch, 2, buffer, x, top);
            let (cr_bottom_first, cr_bottom_second) =
                sample_half_pair_numerators(scratch, 2, buffer, x, bottom);
            let weight = weight as i32;
            let first = (
                i32::from(plane_byte(scratch, buffer, y_row_offset + x)),
                sample_half_vertical(cb_top_first, cb_bottom_first, weight),
                sample_half_vertical(cr_top_first, cr_bottom_first, weight),
            );
            let second = (
                i32::from(plane_byte(scratch, buffer, y_row_offset + x + 1)),
                sample_half_vertical(cb_top_second, cb_bottom_second, weight),
                sample_half_vertical(cr_top_second, cr_bottom_second, weight),
            );
            #[cfg(all(target_arch = "wasm32", feature = "simd"))]
            unsafe {
                write_rgb_pair(scratch, local_y * stride + x * 3, first, second);
            }
            #[cfg(not(all(target_arch = "wasm32", feature = "simd")))]
            {
                write_rgb(scratch, local_y * stride + x * 3, first.0, first.1, first.2);
                write_rgb(
                    scratch,
                    local_y * stride + x * 3 + 3,
                    second.0,
                    second.1,
                    second.2,
                );
            }
            x += 2;
        }
        if x < scratch.state.width {
            let tail = sample_420_pixel(scratch, buffer, x, 1 + local_y, top, bottom, weight);
            write_rgb(scratch, local_y * stride + x * 3, tail.0, tail.1, tail.2);
        }
    }
}

#[inline(always)]
fn sample_422_pixel(
    scratch: &Scratch,
    buffer: usize,
    output_x: usize,
    row: usize,
) -> (i32, i32, i32) {
    let (left, right, weight) =
        half_resolution_coordinates(output_x, scratch.state.plane_widths[1]);
    (
        i32::from(plane_byte(
            scratch,
            buffer,
            scratch.state.plane_offsets[0] + row * scratch.state.plane_widths[0] + output_x,
        )),
        sample_half_horizontal(scratch, 1, buffer, left, right, weight, row) - 128,
        sample_half_horizontal(scratch, 2, buffer, left, right, weight, row) - 128,
    )
}

fn render_422(scratch: &Scratch, height: usize, stride: usize) {
    let buffer = scratch.state.pending_buffer;
    let y_offset = scratch.state.plane_offsets[0];
    let y_width = scratch.state.plane_widths[0];
    for local_y in 0..height {
        let row = local_y + 1;
        let y_row_offset = y_offset + row * y_width;
        let mut x = 0;
        while x + 1 < scratch.state.width {
            let (cb_first, cb_second) = sample_half_pair_numerators(scratch, 1, buffer, x, row);
            let (cr_first, cr_second) = sample_half_pair_numerators(scratch, 2, buffer, x, row);
            let first = (
                i32::from(plane_byte(scratch, buffer, y_row_offset + x)),
                ((cb_first + 128) >> 8) - 128,
                ((cr_first + 128) >> 8) - 128,
            );
            let second = (
                i32::from(plane_byte(scratch, buffer, y_row_offset + x + 1)),
                ((cb_second + 128) >> 8) - 128,
                ((cr_second + 128) >> 8) - 128,
            );
            #[cfg(all(target_arch = "wasm32", feature = "simd"))]
            unsafe {
                write_rgb_pair(scratch, local_y * stride + x * 3, first, second);
            }
            #[cfg(not(all(target_arch = "wasm32", feature = "simd")))]
            {
                write_rgb(scratch, local_y * stride + x * 3, first.0, first.1, first.2);
                write_rgb(
                    scratch,
                    local_y * stride + x * 3 + 3,
                    second.0,
                    second.1,
                    second.2,
                );
            }
            x += 2;
        }
        if x < scratch.state.width {
            let tail = sample_422_pixel(scratch, buffer, x, row);
            write_rgb(scratch, local_y * stride + x * 3, tail.0, tail.1, tail.2);
        }
    }
}

fn render_444(scratch: &Scratch, height: usize, stride: usize) {
    let buffer = scratch.state.pending_buffer;
    let widths = scratch.state.plane_widths;
    let offsets = scratch.state.plane_offsets;
    for local_y in 0..height {
        let row = local_y + 1;
        let mut x = 0;
        while x < scratch.state.width {
            let sample = |output_x: usize| {
                (
                    i32::from(plane_byte(
                        scratch,
                        buffer,
                        offsets[0] + row * widths[0] + output_x,
                    )),
                    i32::from(plane_byte(
                        scratch,
                        buffer,
                        offsets[1] + row * widths[1] + output_x,
                    )) - 128,
                    i32::from(plane_byte(
                        scratch,
                        buffer,
                        offsets[2] + row * widths[2] + output_x,
                    )) - 128,
                )
            };
            let first = sample(x);
            #[cfg(all(target_arch = "wasm32", feature = "simd"))]
            if x + 1 < scratch.state.width {
                let second = sample(x + 1);
                unsafe { write_rgb_pair(scratch, local_y * stride + x * 3, first, second) };
                x += 2;
                continue;
            }
            write_rgb(scratch, local_y * stride + x * 3, first.0, first.1, first.2);
            x += 1;
        }
    }
}

fn render_pending(scratch: &mut Scratch) -> Result<(), u32> {
    let row_start = scratch
        .state
        .pending_row
        .checked_mul(scratch.state.maximum_vertical_sampling)
        .and_then(|value| value.checked_mul(BLOCK))
        .ok_or(ERROR_ARITHMETIC)?;
    let row_end = row_start
        .checked_add(scratch.state.maximum_vertical_sampling * BLOCK)
        .ok_or(ERROR_ARITHMETIC)?
        .min(scratch.state.height);
    if row_start >= row_end {
        return Err(ERROR_CONFIGURATION);
    }
    let height = row_end - row_start;
    let stride = scratch.state.output_stride;
    let required = height.checked_mul(stride).ok_or(ERROR_ARITHMETIC)?;
    if required > scratch.state.output_capacity {
        return Err(ERROR_CAPACITY);
    }
    if scratch.horizontal_sampling == [2, 1, 1] && scratch.vertical_sampling == [2, 1, 1] {
        render_420(scratch, height, stride);
        scratch.state.output_y = row_start;
        scratch.state.output_height = height;
        return Ok(());
    }
    if scratch.horizontal_sampling == [2, 1, 1] && scratch.vertical_sampling == [1, 1, 1] {
        render_422(scratch, height, stride);
        scratch.state.output_y = row_start;
        scratch.state.output_height = height;
        return Ok(());
    }
    if scratch.horizontal_sampling == [1, 1, 1] && scratch.vertical_sampling == [1, 1, 1] {
        render_444(scratch, height, stride);
        scratch.state.output_y = row_start;
        scratch.state.output_height = height;
        return Ok(());
    }
    for local_y in 0..height {
        let output_y = row_start + local_y;
        let mut top_rows = [0usize; COMPONENTS];
        let mut bottom_rows = [0usize; COMPONENTS];
        let mut y_weights = [0usize; COMPONENTS];
        for component in 0..COMPONENTS {
            let vertical = usize::from(scratch.vertical_sampling[component]);
            let y_position = ((output_y as f64 + 0.5) * vertical as f64)
                / scratch.state.maximum_vertical_sampling as f64
                - 0.5
                - (row_start * vertical) as f64 / scratch.state.maximum_vertical_sampling as f64
                + 1.0;
            top_rows[component] = y_position as usize;
            bottom_rows[component] = top_rows[component] + 1;
            y_weights[component] = rounded_weight(y_position - top_rows[component] as f64);
        }
        for x in 0..scratch.state.width {
            let y = component_sample(
                scratch,
                0,
                scratch.state.pending_buffer,
                x,
                top_rows[0],
                bottom_rows[0],
                y_weights[0],
            );
            let cb = component_sample(
                scratch,
                1,
                scratch.state.pending_buffer,
                x,
                top_rows[1],
                bottom_rows[1],
                y_weights[1],
            ) - 128;
            let cr = component_sample(
                scratch,
                2,
                scratch.state.pending_buffer,
                x,
                top_rows[2],
                bottom_rows[2],
                y_weights[2],
            ) - 128;
            let target = local_y * stride + x * 3;
            set_output_byte(
                scratch,
                target,
                clamp_to_u8(f64::from(y) + 1.402 * f64::from(cr)),
            );
            set_output_byte(
                scratch,
                target + 1,
                clamp_to_u8(f64::from(y) - 0.3441363 * f64::from(cb) - 0.71413636 * f64::from(cr)),
            );
            set_output_byte(
                scratch,
                target + 2,
                clamp_to_u8(f64::from(y) + 1.772 * f64::from(cb)),
            );
        }
    }
    scratch.state.output_y = row_start;
    scratch.state.output_height = height;
    Ok(())
}

#[unsafe(no_mangle)]
pub extern "C" fn jpeg_decoder_start(
    input_pointer: u32,
    input_length: u32,
    x_map_pointer: u32,
    x_map_length: u32,
    planes_pointer: u32,
    planes_length: u32,
    output_pointer: u32,
    output_length: u32,
    scan_offset: u32,
    width: u32,
    height: u32,
    maximum_horizontal_sampling: u32,
    maximum_vertical_sampling: u32,
    mcus_per_line: u32,
    mcus_per_column: u32,
    restart_interval: u32,
    tolerant_decoding: u32,
) -> u32 {
    let scratch = scratch();
    let pointer = input_pointer as usize;
    let length = input_length as usize;
    let memory_bytes = core::arch::wasm32::memory_size(0) * PAGE_BYTES;
    let scratch_start = SCRATCH.0.get() as usize;
    let Some(scratch_end) = scratch_start.checked_add(core::mem::size_of::<Scratch>()) else {
        return ERROR_ARITHMETIC;
    };
    let Some(input_end) = pointer.checked_add(length) else {
        return ERROR_ARITHMETIC;
    };
    let map_pointer = x_map_pointer as usize;
    let map_length = x_map_length as usize;
    let Some(map_end) = map_pointer.checked_add(map_length) else {
        return ERROR_ARITHMETIC;
    };
    let Some(map_entries) = (width as usize).checked_mul(COMPONENTS) else {
        return ERROR_ARITHMETIC;
    };
    let Some(left_bytes) = map_entries.checked_mul(4) else {
        return ERROR_ARITHMETIC;
    };
    let Some(right_bytes) = map_entries.checked_mul(4) else {
        return ERROR_ARITHMETIC;
    };
    let Some(weight_bytes) = map_entries.checked_mul(2) else {
        return ERROR_ARITHMETIC;
    };
    let Some(required_map_bytes) = left_bytes
        .checked_add(right_bytes)
        .and_then(|value| value.checked_add(weight_bytes))
    else {
        return ERROR_ARITHMETIC;
    };
    let x_left_pointer = map_pointer;
    let x_right_pointer = x_left_pointer + left_bytes;
    let x_weights_pointer = x_right_pointer + right_bytes;
    let planes_pointer = planes_pointer as usize;
    let planes_length = planes_length as usize;
    let output_pointer = output_pointer as usize;
    let output_length = output_length as usize;
    let Some(planes_end) = planes_pointer.checked_add(planes_length) else {
        return ERROR_ARITHMETIC;
    };
    let Some(output_end) = output_pointer.checked_add(output_length) else {
        return ERROR_ARITHMETIC;
    };
    if length == 0
        || pointer < scratch_end
        || input_end > memory_bytes
        || map_pointer < input_end
        || map_pointer & 3 != 0
        || map_length < required_map_bytes
        || map_end > memory_bytes
        || planes_pointer < map_end
        || planes_end > memory_bytes
        || output_pointer < planes_end
        || output_end > memory_bytes
        || scan_offset as usize >= length
        || width == 0
        || height == 0
        || maximum_horizontal_sampling == 0
        || maximum_vertical_sampling == 0
        || maximum_horizontal_sampling > 4
        || maximum_vertical_sampling > 4
        || mcus_per_line == 0
        || mcus_per_column == 0
        || tolerant_decoding > 1
    {
        return ERROR_CONFIGURATION;
    }

    let mut plane_bytes = 0usize;
    let mut plane_offsets = [0usize; COMPONENTS];
    let mut plane_widths = [0usize; COMPONENTS];
    let mut plane_core_heights = [0usize; COMPONENTS];
    for component in 0..COMPONENTS {
        let horizontal = usize::from(scratch.horizontal_sampling[component]);
        let vertical = usize::from(scratch.vertical_sampling[component]);
        if horizontal == 0
            || vertical == 0
            || horizontal > maximum_horizontal_sampling as usize
            || vertical > maximum_vertical_sampling as usize
        {
            return ERROR_CONFIGURATION;
        }
        let Some(plane_width) = (mcus_per_line as usize)
            .checked_mul(horizontal)
            .and_then(|value| value.checked_mul(BLOCK))
        else {
            return ERROR_ARITHMETIC;
        };
        let plane_core_height = vertical * BLOCK;
        let Some(bytes) = plane_width.checked_mul(plane_core_height + 2) else {
            return ERROR_ARITHMETIC;
        };
        plane_offsets[component] = plane_bytes;
        plane_widths[component] = plane_width;
        plane_core_heights[component] = plane_core_height;
        let Some(next_bytes) = plane_bytes.checked_add(bytes) else {
            return ERROR_ARITHMETIC;
        };
        plane_bytes = next_bytes;
    }
    let Some(output_stride) = (width as usize).checked_mul(3) else {
        return ERROR_ARITHMETIC;
    };
    let Some(maximum_output) = output_stride
        .checked_mul(maximum_vertical_sampling as usize)
        .and_then(|value| value.checked_mul(BLOCK))
    else {
        return ERROR_ARITHMETIC;
    };
    if plane_bytes > PLANE_CAPACITY || maximum_output > OUTPUT_CAPACITY {
        return ERROR_CAPACITY;
    }
    let Some(required_plane_bytes) = plane_bytes.checked_mul(2) else {
        return ERROR_ARITHMETIC;
    };
    if planes_length < required_plane_bytes || output_length < maximum_output {
        return ERROR_CAPACITY;
    }

    for component in 0..COMPONENTS {
        let horizontal = usize::from(scratch.horizontal_sampling[component]);
        let component_width = plane_widths[component];
        for x in 0..width as usize {
            let position =
                ((x as f64 + 0.5) * horizontal as f64) / maximum_horizontal_sampling as f64 - 0.5;
            let left = if position < 0.0 {
                -1
            } else {
                position as isize
            };
            let index = component * width as usize + x;
            let (left_value, right_value, weight_value) = if left < 0 {
                (0, 0, 0)
            } else if left as usize >= component_width - 1 {
                (
                    (component_width - 1) as u32,
                    (component_width - 1) as u32,
                    0,
                )
            } else {
                (
                    left as u32,
                    left as u32 + 1,
                    rounded_weight(position - left as f64) as u16,
                )
            };
            // SAFETY: the map ranges were checked above and index is bounded by
            // COMPONENTS * width.
            unsafe {
                *((x_left_pointer + index * 4) as *mut u32) = left_value;
                *((x_right_pointer + index * 4) as *mut u32) = right_value;
                *((x_weights_pointer + index * 2) as *mut u16) = weight_value;
            }
        }
    }

    for component in 0..COMPONENTS {
        let table_offset = component * HUFFMAN_LENGTHS;
        let symbol_offset = component * HUFFMAN_SYMBOLS;
        let dc_count = scratch.dc_counts[table_offset..table_offset + HUFFMAN_LENGTHS]
            .iter()
            .map(|value| usize::from(*value))
            .sum::<usize>();
        let ac_count = scratch.ac_counts[table_offset..table_offset + HUFFMAN_LENGTHS]
            .iter()
            .map(|value| usize::from(*value))
            .sum::<usize>();
        if dc_count > HUFFMAN_SYMBOLS || ac_count > HUFFMAN_SYMBOLS {
            return ERROR_CONFIGURATION;
        }
        for symbol in &scratch.dc_symbols[symbol_offset..symbol_offset + dc_count] {
            if *symbol > 16 {
                return ERROR_CONFIGURATION;
            }
        }
        if let Err(status) = configure_huffman(
            &scratch.dc_counts[table_offset..table_offset + HUFFMAN_LENGTHS],
            &mut scratch.dc_first_codes[table_offset..table_offset + HUFFMAN_LENGTHS],
            &mut scratch.dc_first_symbols[table_offset..table_offset + HUFFMAN_LENGTHS],
        ) {
            return status;
        }
        let lookup_offset = component * HUFFMAN_LOOKUP_SIZE;
        configure_huffman_lookup(
            &scratch.dc_counts[table_offset..table_offset + HUFFMAN_LENGTHS],
            &scratch.dc_symbols[symbol_offset..symbol_offset + dc_count],
            &mut scratch.dc_lookup_lengths[lookup_offset..lookup_offset + HUFFMAN_LOOKUP_SIZE],
            &mut scratch.dc_lookup_symbols[lookup_offset..lookup_offset + HUFFMAN_LOOKUP_SIZE],
        );
        if let Err(status) = configure_huffman(
            &scratch.ac_counts[table_offset..table_offset + HUFFMAN_LENGTHS],
            &mut scratch.ac_first_codes[table_offset..table_offset + HUFFMAN_LENGTHS],
            &mut scratch.ac_first_symbols[table_offset..table_offset + HUFFMAN_LENGTHS],
        ) {
            return status;
        }
        configure_huffman_lookup(
            &scratch.ac_counts[table_offset..table_offset + HUFFMAN_LENGTHS],
            &scratch.ac_symbols[symbol_offset..symbol_offset + ac_count],
            &mut scratch.ac_lookup_lengths[lookup_offset..lookup_offset + HUFFMAN_LOOKUP_SIZE],
            &mut scratch.ac_lookup_symbols[lookup_offset..lookup_offset + HUFFMAN_LOOKUP_SIZE],
        );
    }

    scratch.state = DecoderState {
        input_pointer: pointer,
        input_length: length,
        input_offset: scan_offset as usize,
        bits: 0,
        bit_count: 0,
        width: width as usize,
        height: height as usize,
        maximum_vertical_sampling: maximum_vertical_sampling as usize,
        mcus_per_line: mcus_per_line as usize,
        mcus_per_column: mcus_per_column as usize,
        restart_interval: restart_interval as usize,
        next_restart_mcu: restart_interval as usize,
        decoded_mcus: 0,
        restart_index: 0,
        tolerant_decoding: tolerant_decoding != 0,
        entropy_ended: false,
        unexpected_restart: 0,
        predictors: [0; COMPONENTS],
        plane_offsets,
        plane_widths,
        plane_core_heights,
        pending_buffer: 0,
        current_buffer: 1,
        pending_row: 0,
        next_row: 0,
        output_y: 0,
        output_height: 0,
        output_stride,
        x_left_pointer,
        x_right_pointer,
        x_weights_pointer,
        planes_pointer,
        plane_buffer_bytes: plane_bytes,
        output_pointer,
        output_capacity: output_length,
        pending: false,
        initialized: true,
        finished: false,
    };
    STATUS_OK
}

#[unsafe(no_mangle)]
pub extern "C" fn jpeg_decoder_next() -> u32 {
    let scratch = scratch();
    if !scratch.state.initialized {
        return ERROR_CONFIGURATION;
    }
    if scratch.state.finished {
        return STATUS_DONE;
    }
    loop {
        if scratch.state.next_row < scratch.state.mcus_per_column {
            let row = scratch.state.next_row;
            let current = scratch.state.current_buffer;
            if let Err(status) = decode_mcu_row(scratch, row, current) {
                return status;
            }
            if !scratch.state.pending {
                replicate_top(scratch, current);
                scratch.state.pending = true;
                scratch.state.pending_buffer = current;
                scratch.state.current_buffer = 1 - current;
                scratch.state.pending_row = row;
                continue;
            }
            link_rows(scratch);
            if let Err(status) = render_pending(scratch) {
                return status;
            }
            let previous_pending = scratch.state.pending_buffer;
            scratch.state.pending_buffer = scratch.state.current_buffer;
            scratch.state.current_buffer = previous_pending;
            scratch.state.pending_row = row;
            return STATUS_OK;
        }
        if scratch.state.pending {
            if let Err(status) = finish_entropy(scratch) {
                return status;
            }
            let pending = scratch.state.pending_buffer;
            replicate_bottom(scratch, pending);
            if let Err(status) = render_pending(scratch) {
                return status;
            }
            scratch.state.pending = false;
            scratch.state.finished = true;
            return STATUS_OK;
        }
        scratch.state.finished = true;
        return STATUS_DONE;
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn jpeg_decoder_output_y() -> u32 {
    scratch().state.output_y as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn jpeg_decoder_output_height() -> u32 {
    scratch().state.output_height as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn jpeg_decoder_output_stride() -> u32 {
    scratch().state.output_stride as u32
}
