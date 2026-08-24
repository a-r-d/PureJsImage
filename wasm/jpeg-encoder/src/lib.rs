#![no_std]

use core::cell::UnsafeCell;

const ABI_VERSION: u32 = 1;
const STATUS_OK: u32 = 0;
const STATUS_DONE: u32 = 1;
const ERROR_CONFIGURATION: u32 = 10;
const ERROR_INPUT: u32 = 11;
const ERROR_CAPACITY: u32 = 12;
const ERROR_STATE: u32 = 13;
#[cfg(not(feature = "aan"))]
const BLOCK_VALUES: usize = 64;
const WASM_PAGE_BYTES: u64 = 65_536;

#[cfg(feature = "aan")]
type Sample = f32;
#[cfg(not(feature = "aan"))]
type Sample = f64;

const ZIG_ZAG: [usize; 64] = [
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
    13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59,
    52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];
const LUMINANCE_QUANTIZATION: [u8; 64] = [
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
    92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const CHROMINANCE_QUANTIZATION: [u8; 64] = [
    17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99,
    47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];
const LUMINANCE_DC_COUNTS: [u8; 16] = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const LUMINANCE_DC_VALUES: [u8; 12] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const LUMINANCE_AC_COUNTS: [u8; 16] = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 125];
const LUMINANCE_AC_VALUES: [u8; 162] = [
    1, 2, 3, 0, 4, 17, 5, 18, 33, 49, 65, 6, 19, 81, 97, 7, 34, 113, 20, 50, 129, 145, 161, 8, 35,
    66, 177, 193, 21, 82, 209, 240, 36, 51, 98, 114, 130, 9, 10, 22, 23, 24, 25, 26, 37, 38, 39,
    40, 41, 42, 52, 53, 54, 55, 56, 57, 58, 67, 68, 69, 70, 71, 72, 73, 74, 83, 84, 85, 86, 87, 88,
    89, 90, 99, 100, 101, 102, 103, 104, 105, 106, 115, 116, 117, 118, 119, 120, 121, 122, 131,
    132, 133, 134, 135, 136, 137, 138, 146, 147, 148, 149, 150, 151, 152, 153, 154, 162, 163, 164,
    165, 166, 167, 168, 169, 170, 178, 179, 180, 181, 182, 183, 184, 185, 186, 194, 195, 196, 197,
    198, 199, 200, 201, 202, 210, 211, 212, 213, 214, 215, 216, 217, 218, 225, 226, 227, 228, 229,
    230, 231, 232, 233, 234, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250,
];
const CHROMINANCE_DC_COUNTS: [u8; 16] = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const CHROMINANCE_AC_COUNTS: [u8; 16] = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 119];
const CHROMINANCE_AC_VALUES: [u8; 162] = [
    0, 1, 2, 3, 17, 4, 5, 33, 49, 6, 18, 65, 81, 7, 97, 113, 19, 34, 50, 129, 8, 20, 66, 145, 161,
    177, 193, 9, 35, 51, 82, 240, 21, 98, 114, 209, 10, 22, 36, 52, 225, 37, 241, 23, 24, 25, 26,
    38, 39, 40, 41, 42, 53, 54, 55, 56, 57, 58, 67, 68, 69, 70, 71, 72, 73, 74, 83, 84, 85, 86, 87,
    88, 89, 90, 99, 100, 101, 102, 103, 104, 105, 106, 115, 116, 117, 118, 119, 120, 121, 122, 130,
    131, 132, 133, 134, 135, 136, 137, 138, 146, 147, 148, 149, 150, 151, 152, 153, 154, 162, 163,
    164, 165, 166, 167, 168, 169, 170, 178, 179, 180, 181, 182, 183, 184, 185, 186, 194, 195, 196,
    197, 198, 199, 200, 201, 202, 210, 211, 212, 213, 214, 215, 216, 217, 218, 226, 227, 228, 229,
    230, 231, 232, 233, 234, 242, 243, 244, 245, 246, 247, 248, 249, 250,
];

#[cfg(not(feature = "aan"))]
const DCT_BASIS: [f64; BLOCK_VALUES] = [
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
struct State {
    active: bool,
    finished: bool,
    width: usize,
    height: usize,
    format: u8,
    channels: usize,
    grayscale: bool,
    luminance_horizontal: usize,
    luminance_vertical: usize,
    mcu_width: usize,
    row_height: usize,
    restart_interval: usize,
    background: [u8; 3],
    output_pointer: usize,
    output_capacity: usize,
    output_length: usize,
    pending: u64,
    pending_bits: u8,
    received_rows: usize,
    mcu: usize,
    restart: usize,
    previous_y: i32,
    previous_cb: i32,
    previous_cr: i32,
    luminance_table: [u8; 64],
    chrominance_table: [u8; 64],
    luminance_reciprocals: [f32; 64],
    chrominance_reciprocals: [f32; 64],
    luminance_dc_values: [u16; 256],
    luminance_dc_lengths: [u8; 256],
    luminance_ac_values: [u16; 256],
    luminance_ac_lengths: [u8; 256],
    chrominance_dc_values: [u16; 256],
    chrominance_dc_lengths: [u8; 256],
    chrominance_ac_values: [u16; 256],
    chrominance_ac_lengths: [u8; 256],
}

impl State {
    const fn new() -> Self {
        Self {
            active: false,
            finished: false,
            width: 0,
            height: 0,
            format: 0,
            channels: 0,
            grayscale: false,
            luminance_horizontal: 1,
            luminance_vertical: 1,
            mcu_width: 8,
            row_height: 8,
            restart_interval: 0,
            background: [255; 3],
            output_pointer: 0,
            output_capacity: 0,
            output_length: 0,
            pending: 0,
            pending_bits: 0,
            received_rows: 0,
            mcu: 0,
            restart: 0,
            previous_y: 0,
            previous_cb: 0,
            previous_cr: 0,
            luminance_table: [0; 64],
            chrominance_table: [0; 64],
            luminance_reciprocals: [0.0; 64],
            chrominance_reciprocals: [0.0; 64],
            luminance_dc_values: [0; 256],
            luminance_dc_lengths: [0; 256],
            luminance_ac_values: [0; 256],
            luminance_ac_lengths: [0; 256],
            chrominance_dc_values: [0; 256],
            chrominance_dc_lengths: [0; 256],
            chrominance_ac_values: [0; 256],
            chrominance_ac_lengths: [0; 256],
        }
    }
}

#[repr(C, align(16))]
struct Scratch {
    state: State,
    luminance_samples: [Sample; 64],
    blue_difference_samples: [Sample; 64],
    red_difference_samples: [Sample; 64],
    luminance_plane: [Sample; 256],
    red_plane: [Sample; 256],
    green_plane: [Sample; 256],
    blue_plane: [Sample; 256],
    intermediate: [f64; 64],
    aan_samples: [f32; 64],
    coefficients: [i32; 64],
}

struct SharedScratch(UnsafeCell<Scratch>);
unsafe impl Sync for SharedScratch {}
static SCRATCH: SharedScratch = SharedScratch(UnsafeCell::new(Scratch {
    state: State::new(),
    luminance_samples: [0.0; 64],
    blue_difference_samples: [0.0; 64],
    red_difference_samples: [0.0; 64],
    luminance_plane: [0.0; 256],
    red_plane: [0.0; 256],
    green_plane: [0.0; 256],
    blue_plane: [0.0; 256],
    intermediate: [0.0; 64],
    aan_samples: [0.0; 64],
    coefficients: [0; 64],
}));

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}
fn scratch() -> &'static mut Scratch {
    unsafe { &mut *SCRATCH.0.get() }
}

#[derive(Clone, Copy)]
struct Region {
    start: u64,
    end: u64,
}

fn external_region(pointer: u32, length: u32) -> Option<Region> {
    if pointer == 0 || length == 0 {
        return None;
    }
    let start = u64::from(pointer);
    let end = start.checked_add(u64::from(length))?;
    let memory_bytes = (core::arch::wasm32::memory_size::<0>() as u64) * WASM_PAGE_BYTES;
    let scratch_start = SCRATCH.0.get() as usize as u64;
    let scratch_end = scratch_start.checked_add(core::mem::size_of::<Scratch>() as u64)?;
    if end > memory_bytes || (start < scratch_end && scratch_start < end) {
        return None;
    }
    Some(Region { start, end })
}

fn regions_overlap(left: Region, right: Region) -> bool {
    left.start < right.end && right.start < left.end
}

struct Writer<'a> {
    state: &'a mut State,
}
impl Writer<'_> {
    fn byte(&mut self, value: u8) -> Result<(), u32> {
        if self.state.output_length >= self.state.output_capacity {
            return Err(ERROR_CAPACITY);
        }
        unsafe {
            *((self.state.output_pointer + self.state.output_length) as *mut u8) = value;
        }
        self.state.output_length += 1;
        Ok(())
    }
    fn word(&mut self, value: u16) -> Result<(), u32> {
        self.byte((value >> 8) as u8)?;
        self.byte(value as u8)
    }
    fn bits(&mut self, value: u64, length: u8) -> Result<(), u32> {
        let mask = if length == 64 {
            u64::MAX
        } else {
            (1u64 << length) - 1
        };
        self.state.pending = (self.state.pending << length) | (value & mask);
        self.state.pending_bits += length;
        while self.state.pending_bits >= 8 {
            let remaining = self.state.pending_bits - 8;
            let output = ((self.state.pending >> remaining) & 0xff) as u8;
            self.byte(output)?;
            if output == 0xff {
                self.byte(0)?;
            }
            self.state.pending_bits = remaining;
            self.state.pending &= if remaining == 0 {
                0
            } else {
                (1u64 << remaining) - 1
            };
        }
        Ok(())
    }
    fn flush_bits(&mut self) -> Result<(), u32> {
        if self.state.pending_bits == 0 {
            return Ok(());
        }
        let length = 8 - self.state.pending_bits;
        self.bits((1u64 << length) - 1, length)
    }
}

fn build_codes(
    counts: &[u8; 16],
    symbols: &[u8],
    values: &mut [u16; 256],
    lengths: &mut [u8; 256],
) {
    values.fill(0);
    lengths.fill(0);
    let mut code = 0u16;
    let mut symbol_index = 0usize;
    for (length_index, count) in counts.iter().enumerate() {
        let length = (length_index + 1) as u8;
        for _ in 0..*count {
            let symbol = symbols[symbol_index] as usize;
            values[symbol] = code;
            lengths[symbol] = length;
            code += 1;
            symbol_index += 1;
        }
        code <<= 1;
    }
}

fn quantization_table(base: &[u8; 64], quality: u32, output: &mut [u8; 64]) {
    let scale = if quality < 50 {
        5000 / quality
    } else {
        200 - quality * 2
    };
    for index in 0..64 {
        let value = ((base[index] as u32 * scale + 50) / 100).clamp(1, 255);
        output[index] = value as u8;
    }
}

fn write_table(
    writer: &mut Writer<'_>,
    class: u8,
    id: u8,
    counts: &[u8; 16],
    symbols: &[u8],
) -> Result<(), u32> {
    writer.byte((class << 4) | id)?;
    for value in counts {
        writer.byte(*value)?;
    }
    for value in symbols {
        writer.byte(*value)?;
    }
    Ok(())
}

fn write_header(state: &mut State) -> Result<(), u32> {
    let grayscale = state.grayscale;
    let sampling = ((state.luminance_horizontal as u8) << 4) | state.luminance_vertical as u8;
    let width = state.width as u16;
    let height = state.height as u16;
    let luminance = state.luminance_table;
    let chrominance = state.chrominance_table;
    let restart_interval = state.restart_interval as u16;
    let mut writer = Writer { state };
    writer.word(0xffd8)?;
    writer.word(0xffe0)?;
    writer.word(16)?;
    for value in [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0] {
        writer.byte(value)?;
    }
    writer.word(0xffdb)?;
    writer.word(if grayscale { 67 } else { 132 })?;
    writer.byte(0)?;
    for index in ZIG_ZAG {
        writer.byte(luminance[index])?;
    }
    if !grayscale {
        writer.byte(1)?;
        for index in ZIG_ZAG {
            writer.byte(chrominance[index])?;
        }
    }
    writer.word(0xffc0)?;
    writer.word(if grayscale { 11 } else { 17 })?;
    writer.byte(8)?;
    writer.word(height)?;
    writer.word(width)?;
    writer.byte(if grayscale { 1 } else { 3 })?;
    writer.byte(1)?;
    writer.byte(sampling)?;
    writer.byte(0)?;
    if !grayscale {
        writer.byte(2)?;
        writer.byte(0x11)?;
        writer.byte(1)?;
        writer.byte(3)?;
        writer.byte(0x11)?;
        writer.byte(1)?;
    }
    writer.word(0xffc4)?;
    writer.word(if grayscale { 210 } else { 418 })?;
    write_table(
        &mut writer,
        0,
        0,
        &LUMINANCE_DC_COUNTS,
        &LUMINANCE_DC_VALUES,
    )?;
    write_table(
        &mut writer,
        1,
        0,
        &LUMINANCE_AC_COUNTS,
        &LUMINANCE_AC_VALUES,
    )?;
    if !grayscale {
        write_table(
            &mut writer,
            0,
            1,
            &CHROMINANCE_DC_COUNTS,
            &LUMINANCE_DC_VALUES,
        )?;
        write_table(
            &mut writer,
            1,
            1,
            &CHROMINANCE_AC_COUNTS,
            &CHROMINANCE_AC_VALUES,
        )?;
    }
    if restart_interval > 0 {
        writer.word(0xffdd)?;
        writer.word(4)?;
        writer.word(restart_interval)?;
    }
    writer.word(0xffda)?;
    writer.word(if grayscale { 8 } else { 12 })?;
    writer.byte(if grayscale { 1 } else { 3 })?;
    writer.byte(1)?;
    writer.byte(0)?;
    if !grayscale {
        writer.byte(2)?;
        writer.byte(0x11)?;
        writer.byte(3)?;
        writer.byte(0x11)?;
    }
    writer.byte(0)?;
    writer.byte(63)?;
    writer.byte(0)?;
    Ok(())
}

// SAFETY: callers use this only after `jpeg_encoder_write` has validated the
// complete MCU-row extent against `input_length`.
#[inline(always)]
unsafe fn validated_input_byte(pointer: usize, offset: usize) -> u8 {
    unsafe { *((pointer + offset) as *const u8) }
}

#[inline(always)]
fn rgb<const RGBA: bool, const CLAMP: bool>(
    state: &State,
    pointer: usize,
    stride: usize,
    row: usize,
    x: usize,
) -> (Sample, Sample, Sample) {
    let x = if CLAMP { x.min(state.width - 1) } else { x };
    let offset = row * stride + x * state.channels;
    if !RGBA {
        return unsafe {
            (
                validated_input_byte(pointer, offset) as Sample,
                validated_input_byte(pointer, offset + 1) as Sample,
                validated_input_byte(pointer, offset + 2) as Sample,
            )
        };
    }
    let alpha = unsafe { validated_input_byte(pointer, offset + 3) } as u32;
    let inverse = 255 - alpha;
    let red = (unsafe { validated_input_byte(pointer, offset) } as u32 * alpha
        + state.background[0] as u32 * inverse
        + 127)
        / 255;
    let green = (unsafe { validated_input_byte(pointer, offset + 1) } as u32 * alpha
        + state.background[1] as u32 * inverse
        + 127)
        / 255;
    let blue = (unsafe { validated_input_byte(pointer, offset + 2) } as u32 * alpha
        + state.background[2] as u32 * inverse
        + 127)
        / 255;
    (red as Sample, green as Sample, blue as Sample)
}

fn fill_gray(
    state: &State,
    pointer: usize,
    stride: usize,
    origin_x: usize,
    output: &mut [Sample; 64],
) {
    for y in 0..8 {
        for x in 0..8 {
            output[y * 8 + x] = unsafe {
                validated_input_byte(pointer, y * stride + (origin_x + x).min(state.width - 1))
            } as Sample
                - 128.0;
        }
    }
}
#[inline(always)]
fn store_color(
    red: Sample,
    green: Sample,
    blue: Sample,
    index: usize,
    luminance: &mut [Sample; 256],
    red_plane: &mut [Sample; 256],
    green_plane: &mut [Sample; 256],
    blue_plane: &mut [Sample; 256],
) {
    luminance[index] = 0.299 * red + 0.587 * green + 0.114 * blue - 128.0;
    red_plane[index] = red;
    green_plane[index] = green;
    blue_plane[index] = blue;
}

fn fill_color_planes_inner<const RGBA: bool, const CLAMP: bool>(
    state: &State,
    pointer: usize,
    stride: usize,
    origin_x: usize,
    luminance: &mut [Sample; 256],
    red_plane: &mut [Sample; 256],
    green_plane: &mut [Sample; 256],
    blue_plane: &mut [Sample; 256],
) {
    for y in 0..state.row_height {
        for x in 0..state.mcu_width {
            let pixel = rgb::<RGBA, CLAMP>(state, pointer, stride, y, origin_x + x);
            store_color(
                pixel.0,
                pixel.1,
                pixel.2,
                y * state.mcu_width + x,
                luminance,
                red_plane,
                green_plane,
                blue_plane,
            );
        }
    }
}

fn fill_color_planes_format<const RGBA: bool>(
    state: &State,
    pointer: usize,
    stride: usize,
    origin_x: usize,
    luminance: &mut [Sample; 256],
    red_plane: &mut [Sample; 256],
    green_plane: &mut [Sample; 256],
    blue_plane: &mut [Sample; 256],
) {
    if origin_x + state.mcu_width <= state.width {
        fill_color_planes_inner::<RGBA, false>(
            state,
            pointer,
            stride,
            origin_x,
            luminance,
            red_plane,
            green_plane,
            blue_plane,
        );
    } else {
        fill_color_planes_inner::<RGBA, true>(
            state,
            pointer,
            stride,
            origin_x,
            luminance,
            red_plane,
            green_plane,
            blue_plane,
        );
    }
}

#[cfg(all(target_arch = "wasm32", feature = "simd"))]
#[target_feature(enable = "simd128")]
unsafe fn fill_rgb_planes_simd(
    state: &State,
    pointer: usize,
    stride: usize,
    origin_x: usize,
    luminance: &mut [Sample; 256],
    red_plane: &mut [Sample; 256],
    green_plane: &mut [Sample; 256],
    blue_plane: &mut [Sample; 256],
) {
    use core::arch::wasm32::*;
    for y in 0..state.row_height {
        for x in (0..state.mcu_width).step_by(4) {
            let source = y * stride + (origin_x + x) * 3;
            let red = f32x4(
                unsafe { validated_input_byte(pointer, source) } as f32,
                unsafe { validated_input_byte(pointer, source + 3) } as f32,
                unsafe { validated_input_byte(pointer, source + 6) } as f32,
                unsafe { validated_input_byte(pointer, source + 9) } as f32,
            );
            let green = f32x4(
                unsafe { validated_input_byte(pointer, source + 1) } as f32,
                unsafe { validated_input_byte(pointer, source + 4) } as f32,
                unsafe { validated_input_byte(pointer, source + 7) } as f32,
                unsafe { validated_input_byte(pointer, source + 10) } as f32,
            );
            let blue = f32x4(
                unsafe { validated_input_byte(pointer, source + 2) } as f32,
                unsafe { validated_input_byte(pointer, source + 5) } as f32,
                unsafe { validated_input_byte(pointer, source + 8) } as f32,
                unsafe { validated_input_byte(pointer, source + 11) } as f32,
            );
            let target = y * state.mcu_width + x;
            unsafe {
                v128_store(red_plane.as_mut_ptr().add(target) as *mut v128, red);
                v128_store(green_plane.as_mut_ptr().add(target) as *mut v128, green);
                v128_store(blue_plane.as_mut_ptr().add(target) as *mut v128, blue);
                let value = f32x4_sub(
                    f32x4_add(
                        f32x4_add(
                            f32x4_mul(red, f32x4_splat(0.299)),
                            f32x4_mul(green, f32x4_splat(0.587)),
                        ),
                        f32x4_mul(blue, f32x4_splat(0.114)),
                    ),
                    f32x4_splat(128.0),
                );
                v128_store(luminance.as_mut_ptr().add(target) as *mut v128, value);
            }
        }
    }
}

#[cfg(all(target_arch = "wasm32", feature = "simd"))]
#[target_feature(enable = "simd128")]
unsafe fn fill_rgba_planes_simd(
    state: &State,
    pointer: usize,
    stride: usize,
    origin_x: usize,
    luminance: &mut [Sample; 256],
    red_plane: &mut [Sample; 256],
    green_plane: &mut [Sample; 256],
    blue_plane: &mut [Sample; 256],
) {
    use core::arch::wasm32::*;
    let zero = i32x4_splat(0);
    let maximum = i32x4_splat(255);
    for y in 0..state.row_height {
        for x in (0..state.mcu_width).step_by(4) {
            let source = y * stride + (origin_x + x) * 4;
            let pixels = unsafe { v128_load((pointer + source) as *const v128) };
            let red = i8x16_shuffle::<0, 16, 16, 16, 4, 16, 16, 16, 8, 16, 16, 16, 12, 16, 16, 16>(
                pixels, zero,
            );
            let green = i8x16_shuffle::<1, 16, 16, 16, 5, 16, 16, 16, 9, 16, 16, 16, 13, 16, 16, 16>(
                pixels, zero,
            );
            let blue = i8x16_shuffle::<2, 16, 16, 16, 6, 16, 16, 16, 10, 16, 16, 16, 14, 16, 16, 16>(
                pixels, zero,
            );
            let alpha = i8x16_shuffle::<3, 16, 16, 16, 7, 16, 16, 16, 11, 16, 16, 16, 15, 16, 16, 16>(
                pixels, zero,
            );
            let inverse = i32x4_sub(maximum, alpha);
            let composite = |channel: v128, background: u8| {
                let numerator = i32x4_add(
                    i32x4_add(
                        i32x4_mul(channel, alpha),
                        i32x4_mul(i32x4_splat(i32::from(background)), inverse),
                    ),
                    i32x4_splat(127),
                );
                i32x4_shr(
                    i32x4_add(
                        i32x4_add(numerator, i32x4_splat(1)),
                        i32x4_shr(numerator, 8),
                    ),
                    8,
                )
            };
            let red = f32x4_convert_i32x4(composite(red, state.background[0]));
            let green = f32x4_convert_i32x4(composite(green, state.background[1]));
            let blue = f32x4_convert_i32x4(composite(blue, state.background[2]));
            let target = y * state.mcu_width + x;
            unsafe {
                v128_store(red_plane.as_mut_ptr().add(target) as *mut v128, red);
                v128_store(green_plane.as_mut_ptr().add(target) as *mut v128, green);
                v128_store(blue_plane.as_mut_ptr().add(target) as *mut v128, blue);
                let value = f32x4_sub(
                    f32x4_add(
                        f32x4_add(
                            f32x4_mul(red, f32x4_splat(0.299)),
                            f32x4_mul(green, f32x4_splat(0.587)),
                        ),
                        f32x4_mul(blue, f32x4_splat(0.114)),
                    ),
                    f32x4_splat(128.0),
                );
                v128_store(luminance.as_mut_ptr().add(target) as *mut v128, value);
            }
        }
    }
}

fn fill_color_planes(
    state: &State,
    pointer: usize,
    stride: usize,
    origin_x: usize,
    luminance: &mut [Sample; 256],
    red_plane: &mut [Sample; 256],
    green_plane: &mut [Sample; 256],
    blue_plane: &mut [Sample; 256],
) {
    if state.format == 4 {
        #[cfg(all(target_arch = "wasm32", feature = "simd"))]
        if origin_x + state.mcu_width <= state.width {
            unsafe {
                fill_rgba_planes_simd(
                    state,
                    pointer,
                    stride,
                    origin_x,
                    luminance,
                    red_plane,
                    green_plane,
                    blue_plane,
                );
            }
            return;
        }
        fill_color_planes_format::<true>(
            state,
            pointer,
            stride,
            origin_x,
            luminance,
            red_plane,
            green_plane,
            blue_plane,
        );
    } else {
        #[cfg(all(target_arch = "wasm32", feature = "simd"))]
        if origin_x + state.mcu_width <= state.width {
            unsafe {
                fill_rgb_planes_simd(
                    state,
                    pointer,
                    stride,
                    origin_x,
                    luminance,
                    red_plane,
                    green_plane,
                    blue_plane,
                );
            }
            return;
        }
        fill_color_planes_format::<false>(
            state,
            pointer,
            stride,
            origin_x,
            luminance,
            red_plane,
            green_plane,
            blue_plane,
        );
    }
}

fn copy_luminance_block(
    plane: &[Sample; 256],
    plane_width: usize,
    block_x: usize,
    block_y: usize,
    output: &mut [Sample; 64],
) {
    for y in 0..8 {
        let source = (block_y * 8 + y) * plane_width + block_x * 8;
        output[y * 8..y * 8 + 8].copy_from_slice(&plane[source..source + 8]);
    }
}

fn downsample_chroma_inner<const HORIZONTAL: usize, const VERTICAL: usize>(
    red_plane: &[Sample; 256],
    green_plane: &[Sample; 256],
    blue_plane: &[Sample; 256],
    blue: &mut [Sample; 64],
    red: &mut [Sample; 64],
) {
    let (cb_red, cb_green, cb_blue, cr_red, cr_green, cr_blue) = match HORIZONTAL * VERTICAL {
        4 => (-0.042184, -0.082816, 0.125, 0.125, -0.104672, -0.020328),
        2 => (-0.084368, -0.165632, 0.25, 0.25, -0.209344, -0.040656),
        _ => (-0.168736, -0.331264, 0.5, 0.5, -0.418688, -0.081312),
    };
    for y in 0..8 {
        for x in 0..8 {
            let mut red_sum = 0.0;
            let mut green_sum = 0.0;
            let mut blue_sum = 0.0;
            for dy in 0..VERTICAL {
                for dx in 0..HORIZONTAL {
                    let offset = (y * VERTICAL + dy) * (HORIZONTAL * 8) + x * HORIZONTAL + dx;
                    red_sum += red_plane[offset];
                    green_sum += green_plane[offset];
                    blue_sum += blue_plane[offset];
                }
            }
            blue[y * 8 + x] = cb_red * red_sum + cb_green * green_sum + cb_blue * blue_sum;
            red[y * 8 + x] = cr_red * red_sum + cr_green * green_sum + cr_blue * blue_sum;
        }
    }
}

fn downsample_chroma(
    state: &State,
    red_plane: &[Sample; 256],
    green_plane: &[Sample; 256],
    blue_plane: &[Sample; 256],
    blue: &mut [Sample; 64],
    red: &mut [Sample; 64],
) {
    if state.luminance_vertical == 2 {
        downsample_chroma_inner::<2, 2>(red_plane, green_plane, blue_plane, blue, red);
    } else if state.luminance_horizontal == 2 {
        downsample_chroma_inner::<2, 1>(red_plane, green_plane, blue_plane, blue, red);
    } else {
        downsample_chroma_inner::<1, 1>(red_plane, green_plane, blue_plane, blue, red);
    }
}

#[inline(always)]
fn round_like_javascript(value: f64) -> i32 {
    let adjusted = value + 0.5;
    let truncated = adjusted as i32;
    if adjusted < truncated as f64 {
        truncated - 1
    } else {
        truncated
    }
}

#[cfg(not(feature = "aan"))]
fn quantize_scalar(
    samples: &[Sample; 64],
    table: &[u8; 64],
    intermediate: &mut [f64; 64],
    output: &mut [i32; 64],
) {
    for row in 0..8 {
        for frequency in 0..8 {
            let mut value = 0.0;
            for x in 0..8 {
                value += samples[row * 8 + x] * DCT_BASIS[frequency * 8 + x];
            }
            intermediate[row * 8 + frequency] = value;
        }
    }
    for vertical in 0..8 {
        for horizontal in 0..8 {
            let mut value = 0.0;
            for y in 0..8 {
                value += DCT_BASIS[vertical * 8 + y] * intermediate[y * 8 + horizontal];
            }
            output[vertical * 8 + horizontal] =
                round_like_javascript(value / table[vertical * 8 + horizontal] as f64);
        }
    }
}

#[cfg(feature = "aan")]
const AAN_SCALE: [f32; 8] = [
    1.0,
    1.387039845,
    1.306562965,
    1.175875602,
    1.0,
    0.785694958,
    0.541196100,
    0.275899379,
];

#[cfg(feature = "aan")]
fn aan_row(data: &mut [f32; 64], offset: usize) {
    let tmp0 = data[offset] + data[offset + 7];
    let tmp7 = data[offset] - data[offset + 7];
    let tmp1 = data[offset + 1] + data[offset + 6];
    let tmp6 = data[offset + 1] - data[offset + 6];
    let tmp2 = data[offset + 2] + data[offset + 5];
    let tmp5 = data[offset + 2] - data[offset + 5];
    let tmp3 = data[offset + 3] + data[offset + 4];
    let tmp4 = data[offset + 3] - data[offset + 4];
    let tmp10 = tmp0 + tmp3;
    let tmp13 = tmp0 - tmp3;
    let tmp11 = tmp1 + tmp2;
    let tmp12 = tmp1 - tmp2;
    data[offset] = tmp10 + tmp11;
    data[offset + 4] = tmp10 - tmp11;
    let z1 = (tmp12 + tmp13) * core::f32::consts::FRAC_1_SQRT_2;
    data[offset + 2] = tmp13 + z1;
    data[offset + 6] = tmp13 - z1;
    let tmp10 = tmp4 + tmp5;
    let tmp11 = tmp5 + tmp6;
    let tmp12 = tmp6 + tmp7;
    let z5 = (tmp10 - tmp12) * 0.382683433;
    let z2 = 0.541196100 * tmp10 + z5;
    let z4 = 1.306562965 * tmp12 + z5;
    let z3 = tmp11 * core::f32::consts::FRAC_1_SQRT_2;
    let z11 = tmp7 + z3;
    let z13 = tmp7 - z3;
    data[offset + 5] = z13 + z2;
    data[offset + 3] = z13 - z2;
    data[offset + 1] = z11 + z4;
    data[offset + 7] = z11 - z4;
}

#[cfg(all(feature = "aan", not(all(target_arch = "wasm32", feature = "simd"))))]
fn aan_columns_scalar(data: &mut [f32; 64]) {
    for column in 0..8 {
        let tmp0 = data[column] + data[56 + column];
        let tmp7 = data[column] - data[56 + column];
        let tmp1 = data[8 + column] + data[48 + column];
        let tmp6 = data[8 + column] - data[48 + column];
        let tmp2 = data[16 + column] + data[40 + column];
        let tmp5 = data[16 + column] - data[40 + column];
        let tmp3 = data[24 + column] + data[32 + column];
        let tmp4 = data[24 + column] - data[32 + column];
        let tmp10 = tmp0 + tmp3;
        let tmp13 = tmp0 - tmp3;
        let tmp11 = tmp1 + tmp2;
        let tmp12 = tmp1 - tmp2;
        data[column] = tmp10 + tmp11;
        data[32 + column] = tmp10 - tmp11;
        let z1 = (tmp12 + tmp13) * core::f32::consts::FRAC_1_SQRT_2;
        data[16 + column] = tmp13 + z1;
        data[48 + column] = tmp13 - z1;
        let tmp10 = tmp4 + tmp5;
        let tmp11 = tmp5 + tmp6;
        let tmp12 = tmp6 + tmp7;
        let z5 = (tmp10 - tmp12) * 0.382683433;
        let z2 = 0.541196100 * tmp10 + z5;
        let z4 = 1.306562965 * tmp12 + z5;
        let z3 = tmp11 * core::f32::consts::FRAC_1_SQRT_2;
        let z11 = tmp7 + z3;
        let z13 = tmp7 - z3;
        data[40 + column] = z13 + z2;
        data[24 + column] = z13 - z2;
        data[8 + column] = z11 + z4;
        data[56 + column] = z11 - z4;
    }
}

#[cfg(all(target_arch = "wasm32", feature = "simd"))]
#[target_feature(enable = "simd128")]
unsafe fn aan_columns(data: &mut [f32; 64]) {
    use core::arch::wasm32::*;
    // Every load and store addresses four contiguous values in the 8x8 matrix.
    unsafe {
        for column in [0, 4] {
            let d0 = v128_load(data.as_ptr().add(column) as *const v128);
            let d1 = v128_load(data.as_ptr().add(8 + column) as *const v128);
            let d2 = v128_load(data.as_ptr().add(16 + column) as *const v128);
            let d3 = v128_load(data.as_ptr().add(24 + column) as *const v128);
            let d4 = v128_load(data.as_ptr().add(32 + column) as *const v128);
            let d5 = v128_load(data.as_ptr().add(40 + column) as *const v128);
            let d6 = v128_load(data.as_ptr().add(48 + column) as *const v128);
            let d7 = v128_load(data.as_ptr().add(56 + column) as *const v128);
            let tmp0 = f32x4_add(d0, d7);
            let tmp7 = f32x4_sub(d0, d7);
            let tmp1 = f32x4_add(d1, d6);
            let tmp6 = f32x4_sub(d1, d6);
            let tmp2 = f32x4_add(d2, d5);
            let tmp5 = f32x4_sub(d2, d5);
            let tmp3 = f32x4_add(d3, d4);
            let tmp4 = f32x4_sub(d3, d4);
            let tmp10 = f32x4_add(tmp0, tmp3);
            let tmp13 = f32x4_sub(tmp0, tmp3);
            let tmp11 = f32x4_add(tmp1, tmp2);
            let tmp12 = f32x4_sub(tmp1, tmp2);
            v128_store(
                data.as_mut_ptr().add(column) as *mut v128,
                f32x4_add(tmp10, tmp11),
            );
            v128_store(
                data.as_mut_ptr().add(32 + column) as *mut v128,
                f32x4_sub(tmp10, tmp11),
            );
            let z1 = f32x4_mul(
                f32x4_add(tmp12, tmp13),
                f32x4_splat(core::f32::consts::FRAC_1_SQRT_2),
            );
            v128_store(
                data.as_mut_ptr().add(16 + column) as *mut v128,
                f32x4_add(tmp13, z1),
            );
            v128_store(
                data.as_mut_ptr().add(48 + column) as *mut v128,
                f32x4_sub(tmp13, z1),
            );
            let tmp10 = f32x4_add(tmp4, tmp5);
            let tmp11 = f32x4_add(tmp5, tmp6);
            let tmp12 = f32x4_add(tmp6, tmp7);
            let z5 = f32x4_mul(f32x4_sub(tmp10, tmp12), f32x4_splat(0.382683433));
            let z2 = f32x4_add(f32x4_mul(tmp10, f32x4_splat(0.541196100)), z5);
            let z4 = f32x4_add(f32x4_mul(tmp12, f32x4_splat(1.306562965)), z5);
            let z3 = f32x4_mul(tmp11, f32x4_splat(core::f32::consts::FRAC_1_SQRT_2));
            let z11 = f32x4_add(tmp7, z3);
            let z13 = f32x4_sub(tmp7, z3);
            v128_store(
                data.as_mut_ptr().add(40 + column) as *mut v128,
                f32x4_add(z13, z2),
            );
            v128_store(
                data.as_mut_ptr().add(24 + column) as *mut v128,
                f32x4_sub(z13, z2),
            );
            v128_store(
                data.as_mut_ptr().add(8 + column) as *mut v128,
                f32x4_add(z11, z4),
            );
            v128_store(
                data.as_mut_ptr().add(56 + column) as *mut v128,
                f32x4_sub(z11, z4),
            );
        }
    }
}

#[cfg(all(target_arch = "wasm32", feature = "simd"))]
#[target_feature(enable = "simd128")]
unsafe fn quantize_aan(
    samples: &[Sample; 64],
    reciprocals: &[f32; 64],
    converted: &mut [f32; 64],
    output: &mut [i32; 64],
) {
    for index in 0..64 {
        converted[index] = samples[index] as f32;
    }
    for row in 0..8 {
        aan_row(converted, row * 8);
    }
    unsafe { aan_columns(converted) };
    for index in 0..64 {
        output[index] = round_like_javascript(converted[index] as f64 * reciprocals[index] as f64);
    }
}

#[cfg(all(feature = "aan", not(all(target_arch = "wasm32", feature = "simd"))))]
fn quantize_aan(
    samples: &[Sample; 64],
    reciprocals: &[f32; 64],
    converted: &mut [f32; 64],
    output: &mut [i32; 64],
) {
    for index in 0..64 {
        converted[index] = samples[index] as f32;
    }
    for row in 0..8 {
        aan_row(converted, row * 8);
    }
    aan_columns_scalar(converted);
    for index in 0..64 {
        output[index] = round_like_javascript(converted[index] as f64 * reciprocals[index] as f64);
    }
}

fn quantize(
    samples: &[Sample; 64],
    table: &[u8; 64],
    reciprocals: &[f32; 64],
    intermediate: &mut [f64; 64],
    output: &mut [i32; 64],
    aan_samples: &mut [f32; 64],
) {
    #[cfg(not(feature = "aan"))]
    {
        let _ = (aan_samples, reciprocals);
        quantize_scalar(samples, table, intermediate, output);
    }
    #[cfg(feature = "aan")]
    {
        let _ = (intermediate, table);
        #[cfg(all(target_arch = "wasm32", feature = "simd"))]
        unsafe {
            quantize_aan(samples, reciprocals, aan_samples, output);
        }
        #[cfg(not(all(target_arch = "wasm32", feature = "simd")))]
        quantize_aan(samples, reciprocals, aan_samples, output);
    }
}

#[inline(always)]
fn magnitude(value: i32) -> u8 {
    if value == 0 {
        0
    } else {
        (32 - value.unsigned_abs().leading_zeros()) as u8
    }
}
#[inline(always)]
fn huffman_code<const CHROMA: bool, const AC: bool>(
    state: &State,
    symbol: usize,
) -> Result<(u64, u8), u32> {
    let (value, length) = if CHROMA {
        if AC {
            (
                state.chrominance_ac_values[symbol],
                state.chrominance_ac_lengths[symbol],
            )
        } else {
            (
                state.chrominance_dc_values[symbol],
                state.chrominance_dc_lengths[symbol],
            )
        }
    } else if AC {
        (
            state.luminance_ac_values[symbol],
            state.luminance_ac_lengths[symbol],
        )
    } else {
        (
            state.luminance_dc_values[symbol],
            state.luminance_dc_lengths[symbol],
        )
    };
    if length == 0 {
        return Err(ERROR_CONFIGURATION);
    }
    Ok((u64::from(value), length))
}

#[inline(always)]
fn write_huffman<const CHROMA: bool, const AC: bool>(
    state: &mut State,
    symbol: usize,
) -> Result<(), u32> {
    let (value, length) = huffman_code::<CHROMA, AC>(state, symbol)?;
    Writer { state }.bits(value, length)
}

fn signed_bits(value: i32, length: u8) -> u64 {
    if value < 0 {
        (value + (1i32 << length) - 1) as u64
    } else {
        value as u64
    }
}

#[inline(always)]
fn write_huffman_signed<const CHROMA: bool, const AC: bool>(
    state: &mut State,
    symbol: usize,
    value: i32,
    value_length: u8,
) -> Result<(), u32> {
    let (code, code_length) = huffman_code::<CHROMA, AC>(state, symbol)?;
    Writer { state }.bits(
        (code << value_length) | signed_bits(value, value_length),
        code_length + value_length,
    )
}

fn encode_block<const CHROMA: bool>(
    state: &mut State,
    coefficients: &[i32; 64],
    previous: i32,
) -> Result<i32, u32> {
    let dc = coefficients[0];
    let difference = dc - previous;
    let category = magnitude(difference);
    write_huffman_signed::<CHROMA, false>(state, category as usize, difference, category)?;
    let mut zeroes = 0usize;
    for index in 1..64 {
        let coefficient = coefficients[ZIG_ZAG[index]];
        if coefficient == 0 {
            zeroes += 1;
            continue;
        }
        while zeroes >= 16 {
            write_huffman::<CHROMA, true>(state, 0xf0)?;
            zeroes -= 16;
        }
        let length = magnitude(coefficient);
        write_huffman_signed::<CHROMA, true>(
            state,
            (zeroes << 4) | length as usize,
            coefficient,
            length,
        )?;
        zeroes = 0;
    }
    if zeroes > 0 {
        write_huffman::<CHROMA, true>(state, 0)?;
    }
    Ok(dc)
}

fn encode_rows(scratch: &mut Scratch, pointer: usize, stride: usize) -> Result<(), u32> {
    let state = &mut scratch.state;
    let mcus = (state.width + state.mcu_width - 1) / state.mcu_width;
    for mcu_x in 0..mcus {
        if state.restart_interval > 0 && state.mcu > 0 && state.mcu % state.restart_interval == 0 {
            let marker = 0xffd0 + (state.restart & 7) as u16;
            {
                let mut writer = Writer { state };
                writer.flush_bits()?;
                writer.word(marker)?;
            }
            state.restart += 1;
            state.previous_y = 0;
            state.previous_cb = 0;
            state.previous_cr = 0;
        }
        if state.grayscale {
            fill_gray(
                state,
                pointer,
                stride,
                mcu_x * 8,
                &mut scratch.luminance_samples,
            );
            quantize(
                &scratch.luminance_samples,
                &state.luminance_table,
                &state.luminance_reciprocals,
                &mut scratch.intermediate,
                &mut scratch.coefficients,
                &mut scratch.aan_samples,
            );
            state.previous_y =
                encode_block::<false>(state, &scratch.coefficients, state.previous_y)?;
            state.mcu += 1;
            continue;
        }
        fill_color_planes(
            state,
            pointer,
            stride,
            mcu_x * state.mcu_width,
            &mut scratch.luminance_plane,
            &mut scratch.red_plane,
            &mut scratch.green_plane,
            &mut scratch.blue_plane,
        );
        for block_y in 0..state.luminance_vertical {
            for block_x in 0..state.luminance_horizontal {
                copy_luminance_block(
                    &scratch.luminance_plane,
                    state.mcu_width,
                    block_x,
                    block_y,
                    &mut scratch.luminance_samples,
                );
                quantize(
                    &scratch.luminance_samples,
                    &state.luminance_table,
                    &state.luminance_reciprocals,
                    &mut scratch.intermediate,
                    &mut scratch.coefficients,
                    &mut scratch.aan_samples,
                );
                state.previous_y =
                    encode_block::<false>(state, &scratch.coefficients, state.previous_y)?;
            }
        }
        downsample_chroma(
            state,
            &scratch.red_plane,
            &scratch.green_plane,
            &scratch.blue_plane,
            &mut scratch.blue_difference_samples,
            &mut scratch.red_difference_samples,
        );
        quantize(
            &scratch.blue_difference_samples,
            &state.chrominance_table,
            &state.chrominance_reciprocals,
            &mut scratch.intermediate,
            &mut scratch.coefficients,
            &mut scratch.aan_samples,
        );
        state.previous_cb = encode_block::<true>(state, &scratch.coefficients, state.previous_cb)?;
        quantize(
            &scratch.red_difference_samples,
            &state.chrominance_table,
            &state.chrominance_reciprocals,
            &mut scratch.intermediate,
            &mut scratch.coefficients,
            &mut scratch.aan_samples,
        );
        state.previous_cr = encode_block::<true>(state, &scratch.coefficients, state.previous_cr)?;
        state.mcu += 1;
    }
    Ok(())
}

#[unsafe(no_mangle)]
pub extern "C" fn jpeg_encoder_abi_version() -> u32 {
    ABI_VERSION
}
#[unsafe(no_mangle)]
pub extern "C" fn jpeg_encoder_simd() -> u32 {
    if cfg!(feature = "simd") { 1 } else { 0 }
}
#[unsafe(no_mangle)]
pub extern "C" fn jpeg_encoder_output_length() -> u32 {
    scratch().state.output_length as u32
}
#[unsafe(no_mangle)]
pub extern "C" fn jpeg_encoder_row_height() -> u32 {
    scratch().state.row_height as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn jpeg_encoder_start(
    width: u32,
    height: u32,
    format: u32,
    quality: u32,
    sampling: u32,
    restart_interval: u32,
    background: u32,
    output_pointer: u32,
    output_capacity: u32,
) -> u32 {
    let Some(_output_region) = external_region(output_pointer, output_capacity) else {
        return ERROR_CONFIGURATION;
    };
    if width == 0
        || height == 0
        || width > 65535
        || height > 65535
        || quality == 0
        || quality > 100
        || restart_interval > 65535
        || output_pointer == 0
        || output_capacity < 1024
    {
        return ERROR_CONFIGURATION;
    }
    let (grayscale, channels) = match format {
        1 => (true, 1),
        3 => (false, 3),
        4 => (false, 4),
        _ => return ERROR_CONFIGURATION,
    };
    let (horizontal, vertical, mcu_width, row_height) = if grayscale {
        (1, 1, 8, 8)
    } else {
        match sampling {
            1 => (2, 2, 16, 16),
            2 => (2, 1, 16, 8),
            3 => (1, 1, 8, 8),
            _ => return ERROR_CONFIGURATION,
        }
    };
    let scratch = scratch();
    scratch.state = State::new();
    let state = &mut scratch.state;
    state.active = true;
    state.width = width as usize;
    state.height = height as usize;
    state.format = format as u8;
    state.channels = channels;
    state.grayscale = grayscale;
    state.luminance_horizontal = horizontal;
    state.luminance_vertical = vertical;
    state.mcu_width = mcu_width;
    state.row_height = row_height;
    state.restart_interval = restart_interval as usize;
    state.background = [
        (background >> 16) as u8,
        (background >> 8) as u8,
        background as u8,
    ];
    state.output_pointer = output_pointer as usize;
    state.output_capacity = output_capacity as usize;
    quantization_table(&LUMINANCE_QUANTIZATION, quality, &mut state.luminance_table);
    quantization_table(
        &CHROMINANCE_QUANTIZATION,
        quality,
        &mut state.chrominance_table,
    );
    #[cfg(feature = "aan")]
    for vertical in 0..8 {
        for horizontal in 0..8 {
            let index = vertical * 8 + horizontal;
            let scale = AAN_SCALE[vertical] * AAN_SCALE[horizontal] * 8.0;
            state.luminance_reciprocals[index] =
                1.0 / (state.luminance_table[index] as f32 * scale);
            state.chrominance_reciprocals[index] =
                1.0 / (state.chrominance_table[index] as f32 * scale);
        }
    }
    build_codes(
        &LUMINANCE_DC_COUNTS,
        &LUMINANCE_DC_VALUES,
        &mut state.luminance_dc_values,
        &mut state.luminance_dc_lengths,
    );
    build_codes(
        &LUMINANCE_AC_COUNTS,
        &LUMINANCE_AC_VALUES,
        &mut state.luminance_ac_values,
        &mut state.luminance_ac_lengths,
    );
    build_codes(
        &CHROMINANCE_DC_COUNTS,
        &LUMINANCE_DC_VALUES,
        &mut state.chrominance_dc_values,
        &mut state.chrominance_dc_lengths,
    );
    build_codes(
        &CHROMINANCE_AC_COUNTS,
        &CHROMINANCE_AC_VALUES,
        &mut state.chrominance_ac_values,
        &mut state.chrominance_ac_lengths,
    );
    match write_header(state) {
        Ok(()) => STATUS_OK,
        Err(error) => {
            state.active = false;
            error
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn jpeg_encoder_write(
    input_pointer: u32,
    input_length: u32,
    stride: u32,
    rows: u32,
) -> u32 {
    let scratch = scratch();
    let state = &mut scratch.state;
    state.output_length = 0;
    if !state.active || state.finished {
        return ERROR_STATE;
    }
    if input_pointer == 0 || stride == 0 || rows as usize != state.row_height {
        return ERROR_INPUT;
    }
    let required = match (state.row_height - 1)
        .checked_mul(stride as usize)
        .and_then(|value| value.checked_add(state.width * state.channels))
    {
        Some(value) => value,
        None => return ERROR_INPUT,
    };
    if required > input_length as usize {
        return ERROR_INPUT;
    }
    let Some(input_region) = external_region(input_pointer, input_length) else {
        return ERROR_INPUT;
    };
    let output_region = Region {
        start: state.output_pointer as u64,
        end: state.output_pointer as u64 + state.output_capacity as u64,
    };
    if regions_overlap(input_region, output_region) {
        return ERROR_INPUT;
    }
    let remaining = state.height - state.received_rows;
    if remaining == 0 {
        return ERROR_STATE;
    }
    match encode_rows(scratch, input_pointer as usize, stride as usize) {
        Ok(()) => {
            scratch.state.received_rows += remaining.min(scratch.state.row_height);
            STATUS_OK
        }
        Err(error) => error,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn jpeg_encoder_finish() -> u32 {
    let state = &mut scratch().state;
    state.output_length = 0;
    if !state.active || state.finished || state.received_rows != state.height {
        return ERROR_STATE;
    }
    let result = {
        let mut writer = Writer { state };
        writer.flush_bits().and_then(|_| writer.word(0xffd9))
    };
    match result {
        Ok(()) => {
            state.finished = true;
            state.active = false;
            STATUS_DONE
        }
        Err(error) => error,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn jpeg_encoder_abort() {
    scratch().state.active = false;
    scratch().state.finished = true;
}
