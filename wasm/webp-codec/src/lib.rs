#![no_std]

const ABI_VERSION: u32 = 1;
const STATUS_OK: u32 = 0;
const ERROR_ARGUMENT: u32 = 1;
const ERROR_MODE: u32 = 2;
const WASM_PAGE_BYTES: u64 = 65_536;

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

#[derive(Clone, Copy)]
struct Region {
    pointer: usize,
    length: usize,
    start: u64,
    end: u64,
}

fn linear_memory_bytes() -> u64 {
    (core::arch::wasm32::memory_size::<0>() as u64) * WASM_PAGE_BYTES
}

fn validate_region(pointer: u32, length: u32, alignment: u32) -> Result<Region, u32> {
    if pointer == 0
        || length == 0
        || pointer % alignment != 0
        || length as usize > isize::MAX as usize
    {
        return Err(ERROR_ARGUMENT);
    }
    let start = u64::from(pointer);
    let end = start.checked_add(u64::from(length)).ok_or(ERROR_ARGUMENT)?;
    if end > linear_memory_bytes() || end > usize::MAX as u64 {
        return Err(ERROR_ARGUMENT);
    }
    Ok(Region {
        pointer: pointer as usize,
        length: length as usize,
        start,
        end,
    })
}

fn validate_u32_region(pointer: u32, elements: u32) -> Result<Region, u32> {
    let bytes = elements.checked_mul(4).ok_or(ERROR_ARGUMENT)?;
    validate_region(pointer, bytes, 4)
}

fn regions_overlap(left: Region, right: Region) -> bool {
    left.start < right.end && right.start < left.end
}

unsafe fn shared_bytes(region: Region) -> &'static [u8] {
    // SAFETY: Every caller validates that the immutable region is aligned, in bounds, and does not
    // overlap any mutable region for the duration of the exported synchronous call.
    unsafe { core::slice::from_raw_parts(region.pointer as *const u8, region.length) }
}

unsafe fn shared_u32(region: Region) -> &'static [u32] {
    // SAFETY: validate_u32_region establishes alignment and bounds before this helper is called.
    unsafe { core::slice::from_raw_parts(region.pointer as *const u32, region.length / 4) }
}

unsafe fn exclusive_u32(region: Region) -> &'static mut [u32] {
    // SAFETY: The exported operation validates that this region is in bounds and does not overlap
    // another live input or output region before constructing the mutable slice.
    unsafe { core::slice::from_raw_parts_mut(region.pointer as *mut u32, region.length / 4) }
}

unsafe fn exclusive_bytes(region: Region) -> &'static mut [u8] {
    // SAFETY: The exported operation validates this exclusive byte region before calling here.
    unsafe { core::slice::from_raw_parts_mut(region.pointer as *mut u8, region.length) }
}

unsafe fn exclusive_u16(region: Region) -> &'static mut [u16] {
    // SAFETY: validate_region establishes two-byte alignment, bounds, and exclusive access.
    unsafe { core::slice::from_raw_parts_mut(region.pointer as *mut u16, region.length / 2) }
}

#[inline(always)]
fn channel(color: u32, shift: u32) -> i32 {
    ((color >> shift) & 255) as i32
}

#[inline(always)]
fn pack(alpha: i32, red: i32, green: i32, blue: i32) -> u32 {
    (((alpha & 255) as u32) << 24)
        | (((red & 255) as u32) << 16)
        | (((green & 255) as u32) << 8)
        | ((blue & 255) as u32)
}

#[inline(always)]
fn clamp_byte(value: i32) -> i32 {
    value.clamp(0, 255)
}

#[inline(always)]
fn average(first: u32, second: u32) -> u32 {
    pack(
        (channel(first, 24) + channel(second, 24)) >> 1,
        (channel(first, 16) + channel(second, 16)) >> 1,
        (channel(first, 8) + channel(second, 8)) >> 1,
        (channel(first, 0) + channel(second, 0)) >> 1,
    )
}

#[inline(always)]
fn select(left: u32, top: u32, top_left: u32) -> u32 {
    let diagonal_blue = channel(top_left, 0);
    let diagonal_green = channel(top_left, 8);
    let diagonal_red = channel(top_left, 16);
    let diagonal_alpha = channel(top_left, 24);
    let left_distance = (channel(top, 0) - diagonal_blue).abs()
        + (channel(top, 8) - diagonal_green).abs()
        + (channel(top, 16) - diagonal_red).abs()
        + (channel(top, 24) - diagonal_alpha).abs();
    let top_distance = (channel(left, 0) - diagonal_blue).abs()
        + (channel(left, 8) - diagonal_green).abs()
        + (channel(left, 16) - diagonal_red).abs()
        + (channel(left, 24) - diagonal_alpha).abs();
    if left_distance < top_distance {
        left
    } else {
        top
    }
}

fn predictor(mode: u32, left: u32, top: u32, top_left: u32, top_right: u32) -> Option<u32> {
    match mode {
        0 => Some(0xff00_0000),
        1 => Some(left),
        2 => Some(top),
        3 => Some(top_right),
        4 => Some(top_left),
        5 => Some(average(average(left, top_right), top)),
        6 => Some(average(left, top_left)),
        7 => Some(average(left, top)),
        8 => Some(average(top_left, top)),
        9 => Some(average(top, top_right)),
        10 => Some(average(average(left, top_left), average(top, top_right))),
        11 => Some(select(left, top, top_left)),
        12 => Some(pack(
            clamp_byte(channel(left, 24) + channel(top, 24) - channel(top_left, 24)),
            clamp_byte(channel(left, 16) + channel(top, 16) - channel(top_left, 16)),
            clamp_byte(channel(left, 8) + channel(top, 8) - channel(top_left, 8)),
            clamp_byte(channel(left, 0) + channel(top, 0) - channel(top_left, 0)),
        )),
        13 => {
            let base = average(left, top);
            Some(pack(
                clamp_byte(channel(base, 24) + (channel(base, 24) - channel(top_left, 24)) / 2),
                clamp_byte(channel(base, 16) + (channel(base, 16) - channel(top_left, 16)) / 2),
                clamp_byte(channel(base, 8) + (channel(base, 8) - channel(top_left, 8)) / 2),
                clamp_byte(channel(base, 0) + (channel(base, 0) - channel(top_left, 0)) / 2),
            ))
        }
        _ => None,
    }
}

#[inline(always)]
fn add_packed(first: u32, second: u32) -> u32 {
    let mask = 0x00ff_00ff;
    let low = (first & mask).wrapping_add(second & mask);
    let high = ((first >> 8) & mask).wrapping_add((second >> 8) & mask);
    (low & mask) | ((high & mask) << 8)
}

#[inline(always)]
fn subtract_packed(first: u32, second: u32) -> u32 {
    pack(
        channel(first, 24) - channel(second, 24),
        channel(first, 16) - channel(second, 16),
        channel(first, 8) - channel(second, 8),
        channel(first, 0) - channel(second, 0),
    )
}

#[inline(always)]
fn signed_byte(value: i32) -> i32 {
    if value < 128 { value } else { value - 256 }
}

#[inline(always)]
fn color_delta(transform: i32, color: i32) -> i32 {
    (signed_byte(transform) * signed_byte(color)) >> 5
}

#[inline(always)]
fn inverse_color(color: u32, element: u32) -> u32 {
    let green = channel(color, 8);
    let red = (channel(color, 16) + color_delta(channel(element, 0), green)) & 255;
    let blue = (channel(color, 0)
        + color_delta(channel(element, 8), green)
        + color_delta(channel(element, 16), red))
        & 255;
    pack(channel(color, 24), red, green, blue)
}

#[inline(always)]
fn forward_color(color: u32, element: u32) -> u32 {
    let green = channel(color, 8);
    let red = channel(color, 16);
    pack(
        channel(color, 24),
        red - color_delta(channel(element, 0), green),
        green,
        channel(color, 0)
            - color_delta(channel(element, 8), green)
            - color_delta(channel(element, 16), red),
    )
}

#[cfg(feature = "simd")]
#[target_feature(enable = "simd128")]
unsafe fn color_transform_simd(row: &mut [u32], elements: &[u32], size_bits: u32, inverse: bool) {
    use core::arch::wasm32::{
        i32x4_add, i32x4_mul, i32x4_shl, i32x4_shr, i32x4_splat, i32x4_sub, u32x4_shl, u32x4_shr,
        v128, v128_and, v128_load, v128_or, v128_store,
    };

    let byte_mask = i32x4_splat(255);
    let alpha_mask = i32x4_splat(-16_777_216);
    let mut x = 0;
    if size_bits >= 2 {
        while x + 4 <= row.len() {
            let element = elements[x >> size_bits];
            let red_to_blue = signed_byte(channel(element, 16));
            let green_to_blue = signed_byte(channel(element, 8));
            let green_to_red = signed_byte(channel(element, 0));
            // SAFETY: The loop condition proves that four u32 lanes remain in the row.
            let color = unsafe { v128_load(row.as_ptr().add(x) as *const v128) };
            let green = v128_and(u32x4_shr(color, 8), byte_mask);
            let red = v128_and(u32x4_shr(color, 16), byte_mask);
            let blue = v128_and(color, byte_mask);
            let signed_green = i32x4_shr(i32x4_shl(green, 24), 24);
            let signed_red = i32x4_shr(i32x4_shl(red, 24), 24);
            let red_delta = i32x4_shr(i32x4_mul(i32x4_splat(green_to_red), signed_green), 5);
            let output_red = v128_and(
                if inverse {
                    i32x4_add(red, red_delta)
                } else {
                    i32x4_sub(red, red_delta)
                },
                byte_mask,
            );
            let blue_green_delta =
                i32x4_shr(i32x4_mul(i32x4_splat(green_to_blue), signed_green), 5);
            let blue_red_source = if inverse {
                i32x4_shr(i32x4_shl(output_red, 24), 24)
            } else {
                signed_red
            };
            let blue_red_delta = i32x4_shr(i32x4_mul(i32x4_splat(red_to_blue), blue_red_source), 5);
            let output_blue = v128_and(
                if inverse {
                    i32x4_add(i32x4_add(blue, blue_green_delta), blue_red_delta)
                } else {
                    i32x4_sub(i32x4_sub(blue, blue_green_delta), blue_red_delta)
                },
                byte_mask,
            );
            let output = v128_or(
                v128_and(color, alpha_mask),
                v128_or(
                    u32x4_shl(output_red, 16),
                    v128_or(u32x4_shl(green, 8), output_blue),
                ),
            );
            // SAFETY: The same four lanes are exclusively borrowed from the mutable row.
            unsafe { v128_store(row.as_mut_ptr().add(x) as *mut v128, output) };
            x += 4;
        }
    }
    while x < row.len() {
        let element = elements[x >> size_bits];
        row[x] = if inverse {
            inverse_color(row[x], element)
        } else {
            forward_color(row[x], element)
        };
        x += 1;
    }
}

#[cfg(feature = "simd")]
#[target_feature(enable = "simd128")]
unsafe fn subtract_green_simd(row: &mut [u32], inverse: bool) {
    use core::arch::wasm32::{
        i32x4_splat, u8x16_add, u8x16_sub, u32x4_shl, u32x4_shr, v128, v128_and, v128_load,
        v128_or, v128_store,
    };

    let mask = i32x4_splat(255);
    let mut index = 0;
    while index + 4 <= row.len() {
        // SAFETY: The loop condition proves that four u32 lanes remain in the validated row slice.
        let value = unsafe { v128_load(row.as_ptr().add(index) as *const v128) };
        let green = v128_and(u32x4_shr(value, 8), mask);
        let delta = v128_or(green, u32x4_shl(green, 16));
        let output = if inverse {
            u8x16_add(value, delta)
        } else {
            u8x16_sub(value, delta)
        };
        // SAFETY: The same four lanes are exclusively borrowed from the mutable row slice.
        unsafe { v128_store(row.as_mut_ptr().add(index) as *mut v128, output) };
        index += 4;
    }
    while index < row.len() {
        let color = row[index];
        let green = (color >> 8) & 255;
        let delta = green | (green << 16);
        row[index] = if inverse {
            add_packed(color, delta)
        } else {
            subtract_packed(color, delta)
        };
        index += 1;
    }
}

fn subtract_green(row: &mut [u32], inverse: bool) {
    #[cfg(feature = "simd")]
    unsafe {
        subtract_green_simd(row, inverse);
    }
    #[cfg(not(feature = "simd"))]
    for color in row {
        let green = (*color >> 8) & 255;
        let delta = green | (green << 16);
        *color = if inverse {
            add_packed(*color, delta)
        } else {
            subtract_packed(*color, delta)
        };
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn webp_codec_abi_version() -> u32 {
    ABI_VERSION
}

#[unsafe(no_mangle)]
pub extern "C" fn webp_codec_simd() -> u32 {
    if cfg!(feature = "simd") { 1 } else { 0 }
}

#[unsafe(no_mangle)]
pub extern "C" fn webp_vp8_yuv_to_argb(
    y_pointer: u32,
    y_length: u32,
    y_stride: u32,
    u_pointer: u32,
    u_length: u32,
    u_stride: u32,
    v_pointer: u32,
    v_length: u32,
    v_stride: u32,
    output_pointer: u32,
    output_elements: u32,
    width: u32,
    height: u32,
) -> u32 {
    let result = (|| -> Result<(), u32> {
        if width == 0
            || height == 0
            || y_stride < width
            || u_stride < width.div_ceil(2)
            || v_stride < width.div_ceil(2)
        {
            return Err(ERROR_ARGUMENT);
        }
        let y_required = (height - 1)
            .checked_mul(y_stride)
            .and_then(|value| value.checked_add(width))
            .ok_or(ERROR_ARGUMENT)?;
        let chroma_height = height.div_ceil(2);
        let chroma_width = width.div_ceil(2);
        let u_required = (chroma_height - 1)
            .checked_mul(u_stride)
            .and_then(|value| value.checked_add(chroma_width))
            .ok_or(ERROR_ARGUMENT)?;
        let v_required = (chroma_height - 1)
            .checked_mul(v_stride)
            .and_then(|value| value.checked_add(chroma_width))
            .ok_or(ERROR_ARGUMENT)?;
        let pixels = width.checked_mul(height).ok_or(ERROR_ARGUMENT)?;
        if y_required > y_length
            || u_required > u_length
            || v_required > v_length
            || pixels > output_elements
        {
            return Err(ERROR_ARGUMENT);
        }
        let y_region = validate_region(y_pointer, y_length, 1)?;
        let u_region = validate_region(u_pointer, u_length, 1)?;
        let v_region = validate_region(v_pointer, v_length, 1)?;
        let output_region = validate_u32_region(output_pointer, output_elements)?;
        if regions_overlap(y_region, output_region)
            || regions_overlap(u_region, output_region)
            || regions_overlap(v_region, output_region)
        {
            return Err(ERROR_ARGUMENT);
        }
        let y_data = unsafe { shared_bytes(y_region) };
        let u_data = unsafe { shared_bytes(u_region) };
        let v_data = unsafe { shared_bytes(v_region) };
        let output = unsafe { exclusive_u32(output_region) };
        let width = width as usize;
        let height = height as usize;
        for row in 0..height {
            let y_offset = row * y_stride as usize;
            let uv_offset = (row >> 1) * u_stride as usize;
            let vv_offset = (row >> 1) * v_stride as usize;
            for x in 0..width {
                let luminance = 76_283 * i32::from(y_data[y_offset + x].saturating_sub(16));
                let u = i32::from(u_data[uv_offset + (x >> 1)]) - 128;
                let v = i32::from(v_data[vv_offset + (x >> 1)]) - 128;
                let blue = clamp_byte((luminance + 132_252 * u + 32_768) >> 16);
                let green = clamp_byte((luminance - 25_624 * u - 53_281 * v + 32_768) >> 16);
                let red = clamp_byte((luminance + 104_595 * v + 32_768) >> 16);
                output[row * width + x] = pack(255, red, green, blue);
            }
        }
        Ok(())
    })();
    result.map_or_else(|error| error, |_| STATUS_OK)
}

#[unsafe(no_mangle)]
pub extern "C" fn webp_vp8_rgb_to_yuv420(
    input_pointer: u32,
    input_length: u32,
    input_stride: u32,
    y_pointer: u32,
    y_length: u32,
    u_pointer: u32,
    u_elements: u32,
    v_pointer: u32,
    v_elements: u32,
    alpha_pointer: u32,
    alpha_length: u32,
    width: u32,
    height: u32,
    channels: u32,
    start_y: u32,
) -> u32 {
    let result = (|| -> Result<(), u32> {
        if width == 0 || height == 0 || !matches!(channels, 1 | 3 | 4) {
            return Err(ERROR_ARGUMENT);
        }
        let row_bytes = width.checked_mul(channels).ok_or(ERROR_ARGUMENT)?;
        if input_stride < row_bytes {
            return Err(ERROR_ARGUMENT);
        }
        let input_required = (height - 1)
            .checked_mul(input_stride)
            .and_then(|value| value.checked_add(row_bytes))
            .ok_or(ERROR_ARGUMENT)?;
        let pixels = width.checked_mul(height).ok_or(ERROR_ARGUMENT)?;
        let chroma_width = width.div_ceil(2);
        let chroma_start_y = start_y >> 1;
        let chroma_end_y = start_y.checked_add(height - 1).ok_or(ERROR_ARGUMENT)? >> 1;
        let chroma_rows = chroma_end_y - chroma_start_y + 1;
        let chroma_elements = chroma_width
            .checked_mul(chroma_rows)
            .ok_or(ERROR_ARGUMENT)?;
        if input_required > input_length
            || pixels > y_length
            || chroma_elements > u_elements
            || chroma_elements > v_elements
            || (channels == 4 && pixels > alpha_length)
        {
            return Err(ERROR_ARGUMENT);
        }
        let input_region = validate_region(input_pointer, input_length, 1)?;
        let y_region = validate_region(y_pointer, y_length, 1)?;
        let u_region = validate_region(
            u_pointer,
            u_elements.checked_mul(2).ok_or(ERROR_ARGUMENT)?,
            2,
        )?;
        let v_region = validate_region(
            v_pointer,
            v_elements.checked_mul(2).ok_or(ERROR_ARGUMENT)?,
            2,
        )?;
        let alpha_region = if channels == 4 {
            Some(validate_region(alpha_pointer, alpha_length, 1)?)
        } else {
            None
        };
        if regions_overlap(input_region, y_region)
            || regions_overlap(input_region, u_region)
            || regions_overlap(input_region, v_region)
            || regions_overlap(y_region, u_region)
            || regions_overlap(y_region, v_region)
            || regions_overlap(u_region, v_region)
        {
            return Err(ERROR_ARGUMENT);
        }
        if let Some(alpha) = alpha_region {
            if regions_overlap(input_region, alpha)
                || regions_overlap(y_region, alpha)
                || regions_overlap(u_region, alpha)
                || regions_overlap(v_region, alpha)
            {
                return Err(ERROR_ARGUMENT);
            }
        }
        let input = unsafe { shared_bytes(input_region) };
        let y_output = unsafe { exclusive_bytes(y_region) };
        let u_output = unsafe { exclusive_u16(u_region) };
        let v_output = unsafe { exclusive_u16(v_region) };
        u_output[..chroma_elements as usize].fill(0);
        v_output[..chroma_elements as usize].fill(0);
        let mut alpha_output = alpha_region.map(|region| unsafe { exclusive_bytes(region) });
        for row in 0..height as usize {
            let source_row = row * input_stride as usize;
            let global_y = start_y as usize + row;
            let chroma_row = ((global_y >> 1) - chroma_start_y as usize) * chroma_width as usize;
            for x in 0..width as usize {
                let source = source_row + x * channels as usize;
                let red = i32::from(input[source]);
                let green = if channels == 1 {
                    red
                } else {
                    i32::from(input[source + 1])
                };
                let blue = if channels == 1 {
                    red
                } else {
                    i32::from(input[source + 2])
                };
                let y_value = clamp_byte(((66 * red + 129 * green + 25 * blue + 128) >> 8) + 16);
                let u_value = clamp_byte(((-38 * red - 74 * green + 112 * blue + 128) >> 8) + 128);
                let v_value = clamp_byte(((112 * red - 94 * green - 18 * blue + 128) >> 8) + 128);
                y_output[row * width as usize + x] = y_value as u8;
                let chroma = chroma_row + (x >> 1);
                u_output[chroma] += u_value as u16;
                v_output[chroma] += v_value as u16;
                if let Some(alpha) = alpha_output.as_deref_mut() {
                    alpha[row * width as usize + x] = input[source + 3];
                }
            }
        }
        Ok(())
    })();
    result.map_or_else(|error| error, |_| STATUS_OK)
}

#[unsafe(no_mangle)]
pub extern "C" fn webp_vp8l_inverse_predictor(
    row_pointer: u32,
    width: u32,
    previous_pointer: u32,
    previous_elements: u32,
    modes_pointer: u32,
    mode_width: u32,
    size_bits: u32,
    y: u32,
) -> u32 {
    let result = (|| -> Result<(), u32> {
        if width == 0 || mode_width == 0 || size_bits > 10 {
            return Err(ERROR_ARGUMENT);
        }
        let row_region = validate_u32_region(row_pointer, width)?;
        let modes_region = validate_u32_region(modes_pointer, mode_width)?;
        if regions_overlap(row_region, modes_region) {
            return Err(ERROR_ARGUMENT);
        }
        let previous_region = if y == 0 {
            None
        } else {
            if previous_elements < width {
                return Err(ERROR_ARGUMENT);
            }
            let region = validate_u32_region(previous_pointer, previous_elements)?;
            if regions_overlap(row_region, region) || regions_overlap(modes_region, region) {
                return Err(ERROR_ARGUMENT);
            }
            Some(region)
        };
        let modes = unsafe { shared_u32(modes_region) };
        let previous = previous_region.map(|region| unsafe { shared_u32(region) });
        let row = unsafe { exclusive_u32(row_region) };
        row[0] = add_packed(
            row[0],
            if y == 0 {
                0xff00_0000
            } else {
                previous.ok_or(ERROR_ARGUMENT)?[0]
            },
        );
        let uniform_select = y > 0 && modes.iter().all(|mode| ((mode >> 8) & 255) == 11);
        if uniform_select {
            let previous = previous.ok_or(ERROR_ARGUMENT)?;
            for x in 1..width as usize {
                let predicted = select(row[x - 1], previous[x], previous[x - 1]);
                row[x] = add_packed(row[x], predicted);
            }
            return Ok(());
        }
        for x in 1..width as usize {
            let predicted = if y == 0 {
                row[x - 1]
            } else {
                let previous = previous.ok_or(ERROR_ARGUMENT)?;
                let mode_index = (x >> size_bits) as usize;
                if mode_index >= modes.len() {
                    return Err(ERROR_ARGUMENT);
                }
                let mode = (modes[mode_index] >> 8) & 255;
                predictor(
                    mode,
                    row[x - 1],
                    previous[x],
                    previous[x - 1],
                    if x + 1 == width as usize {
                        row[0]
                    } else {
                        previous[x + 1]
                    },
                )
                .ok_or(ERROR_MODE)?
            };
            row[x] = add_packed(row[x], predicted);
        }
        Ok(())
    })();
    result.map_or_else(|error| error, |_| STATUS_OK)
}

#[unsafe(no_mangle)]
pub extern "C" fn webp_vp8l_forward_predictor(
    row_pointer: u32,
    width: u32,
    previous_pointer: u32,
    previous_elements: u32,
    modes_pointer: u32,
    mode_width: u32,
    output_pointer: u32,
    output_elements: u32,
    size_bits: u32,
    y: u32,
) -> u32 {
    let result = (|| -> Result<(), u32> {
        if width == 0 || output_elements < width || mode_width == 0 || size_bits > 10 {
            return Err(ERROR_ARGUMENT);
        }
        let row_region = validate_u32_region(row_pointer, width)?;
        let modes_region = validate_u32_region(modes_pointer, mode_width)?;
        let output_region = validate_u32_region(output_pointer, output_elements)?;
        if regions_overlap(row_region, modes_region)
            || regions_overlap(row_region, output_region)
            || regions_overlap(modes_region, output_region)
        {
            return Err(ERROR_ARGUMENT);
        }
        let previous_region = if y == 0 {
            None
        } else {
            if previous_elements < width {
                return Err(ERROR_ARGUMENT);
            }
            let region = validate_u32_region(previous_pointer, previous_elements)?;
            if regions_overlap(region, row_region)
                || regions_overlap(region, modes_region)
                || regions_overlap(region, output_region)
            {
                return Err(ERROR_ARGUMENT);
            }
            Some(region)
        };
        let row = unsafe { shared_u32(row_region) };
        let modes = unsafe { shared_u32(modes_region) };
        let previous = previous_region.map(|region| unsafe { shared_u32(region) });
        let output = unsafe { exclusive_u32(output_region) };
        for x in 0..width as usize {
            let predicted = if x == 0 && y == 0 {
                0xff00_0000
            } else if y == 0 {
                row[x - 1]
            } else if x == 0 {
                previous.ok_or(ERROR_ARGUMENT)?[0]
            } else {
                let previous = previous.ok_or(ERROR_ARGUMENT)?;
                let mode_index = (x >> size_bits) as usize;
                if mode_index >= modes.len() {
                    return Err(ERROR_ARGUMENT);
                }
                let mode = (modes[mode_index] >> 8) & 255;
                predictor(
                    mode,
                    row[x - 1],
                    previous[x],
                    previous[x - 1],
                    if x + 1 == width as usize {
                        row[0]
                    } else {
                        previous[x + 1]
                    },
                )
                .ok_or(ERROR_MODE)?
            };
            output[x] = subtract_packed(row[x], predicted);
        }
        Ok(())
    })();
    result.map_or_else(|error| error, |_| STATUS_OK)
}

fn color_transform(
    row_pointer: u32,
    width: u32,
    elements_pointer: u32,
    element_width: u32,
    size_bits: u32,
    inverse: bool,
) -> u32 {
    let result = (|| -> Result<(), u32> {
        if width == 0 || element_width == 0 || size_bits > 10 {
            return Err(ERROR_ARGUMENT);
        }
        let row_region = validate_u32_region(row_pointer, width)?;
        let elements_region = validate_u32_region(elements_pointer, element_width)?;
        if regions_overlap(row_region, elements_region) {
            return Err(ERROR_ARGUMENT);
        }
        let elements = unsafe { shared_u32(elements_region) };
        let row = unsafe { exclusive_u32(row_region) };
        let required_elements = ((row.len() - 1) >> size_bits) + 1;
        if required_elements > elements.len() {
            return Err(ERROR_ARGUMENT);
        }
        #[cfg(feature = "simd")]
        unsafe {
            color_transform_simd(row, elements, size_bits, inverse);
        }
        #[cfg(not(feature = "simd"))]
        for (x, color) in row.iter_mut().enumerate() {
            *color = if inverse {
                inverse_color(*color, elements[x >> size_bits])
            } else {
                forward_color(*color, elements[x >> size_bits])
            };
        }
        Ok(())
    })();
    result.map_or_else(|error| error, |_| STATUS_OK)
}

#[unsafe(no_mangle)]
pub extern "C" fn webp_vp8l_inverse_color(
    row_pointer: u32,
    width: u32,
    elements_pointer: u32,
    element_width: u32,
    size_bits: u32,
) -> u32 {
    color_transform(
        row_pointer,
        width,
        elements_pointer,
        element_width,
        size_bits,
        true,
    )
}

#[unsafe(no_mangle)]
pub extern "C" fn webp_vp8l_forward_color(
    row_pointer: u32,
    width: u32,
    elements_pointer: u32,
    element_width: u32,
    size_bits: u32,
) -> u32 {
    color_transform(
        row_pointer,
        width,
        elements_pointer,
        element_width,
        size_bits,
        false,
    )
}

fn green_transform(row_pointer: u32, width: u32, inverse: bool) -> u32 {
    let result = (|| -> Result<(), u32> {
        if width == 0 {
            return Err(ERROR_ARGUMENT);
        }
        let row_region = validate_u32_region(row_pointer, width)?;
        let row = unsafe { exclusive_u32(row_region) };
        subtract_green(row, inverse);
        Ok(())
    })();
    result.map_or_else(|error| error, |_| STATUS_OK)
}

#[unsafe(no_mangle)]
pub extern "C" fn webp_vp8l_inverse_subtract_green(row_pointer: u32, width: u32) -> u32 {
    green_transform(row_pointer, width, true)
}

#[unsafe(no_mangle)]
pub extern "C" fn webp_vp8l_forward_subtract_green(row_pointer: u32, width: u32) -> u32 {
    green_transform(row_pointer, width, false)
}

#[unsafe(no_mangle)]
pub extern "C" fn webp_vp8l_inverse_row(
    row_pointer: u32,
    width: u32,
    previous_pointer: u32,
    previous_elements: u32,
    modes_pointer: u32,
    mode_width: u32,
    predictor_size_bits: u32,
    elements_pointer: u32,
    element_width: u32,
    color_size_bits: u32,
    y: u32,
) -> u32 {
    let row_region = match validate_u32_region(row_pointer, width) {
        Ok(region) => region,
        Err(error) => return error,
    };
    let previous_region = match validate_u32_region(previous_pointer, width) {
        Ok(region) => region,
        Err(error) => return error,
    };
    let modes_region = match validate_u32_region(modes_pointer, mode_width) {
        Ok(region) => region,
        Err(error) => return error,
    };
    let elements_region = match validate_u32_region(elements_pointer, element_width) {
        Ok(region) => region,
        Err(error) => return error,
    };
    if regions_overlap(previous_region, row_region)
        || regions_overlap(previous_region, modes_region)
        || regions_overlap(previous_region, elements_region)
    {
        return ERROR_ARGUMENT;
    }
    let color_status = color_transform(
        row_pointer,
        width,
        elements_pointer,
        element_width,
        color_size_bits,
        true,
    );
    if color_status != STATUS_OK {
        return color_status;
    }
    let predictor_status = webp_vp8l_inverse_predictor(
        row_pointer,
        width,
        previous_pointer,
        previous_elements,
        modes_pointer,
        mode_width,
        predictor_size_bits,
        y,
    );
    if predictor_status != STATUS_OK {
        return predictor_status;
    }
    let predictor_row = unsafe { shared_u32(row_region) };
    let predictor_output = unsafe { exclusive_u32(previous_region) };
    predictor_output.copy_from_slice(predictor_row);
    green_transform(row_pointer, width, true)
}
