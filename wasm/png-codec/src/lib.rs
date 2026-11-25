#![no_std]

#[cfg(feature = "simd")]
use core::arch::wasm32::v128;

const ABI_VERSION: u32 = 1;
const STATUS_OK: u32 = 0;
const ERROR_ARGUMENT: u32 = 1;
const ERROR_FILTER: u32 = 2;
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

#[cfg(target_arch = "wasm32")]
fn linear_memory_bytes() -> u64 {
    (core::arch::wasm32::memory_size::<0>() as u64) * WASM_PAGE_BYTES
}

#[cfg(not(target_arch = "wasm32"))]
fn linear_memory_bytes() -> u64 {
    usize::MAX as u64
}

fn validate_region(pointer: u32, length: u32, memory_bytes: u64) -> Result<Region, u32> {
    if pointer == 0 || length == 0 || length as usize > isize::MAX as usize {
        return Err(ERROR_ARGUMENT);
    }
    let start = u64::from(pointer);
    let end = start.checked_add(u64::from(length)).ok_or(ERROR_ARGUMENT)?;
    if end > memory_bytes || end > usize::MAX as u64 {
        return Err(ERROR_ARGUMENT);
    }
    Ok(Region {
        pointer: pointer as usize,
        length: length as usize,
        start,
        end,
    })
}

fn regions_overlap(left: Region, right: Region) -> bool {
    left.start < right.end && right.start < left.end
}

fn required_extent(rows: usize, stride: usize, row_length: usize) -> Option<usize> {
    rows.checked_sub(1)?
        .checked_mul(stride)?
        .checked_add(row_length)
}

fn validate_layout(
    input: Region,
    input_stride: usize,
    input_row_length: usize,
    output: Region,
    output_stride: usize,
    output_row_length: usize,
    previous: Region,
    row_bytes: usize,
    rows: usize,
) -> Result<(), u32> {
    if input_stride < input_row_length
        || output_stride < output_row_length
        || previous.length < row_bytes
        || regions_overlap(input, output)
        || regions_overlap(input, previous)
        || regions_overlap(output, previous)
    {
        return Err(ERROR_ARGUMENT);
    }
    let input_required =
        required_extent(rows, input_stride, input_row_length).ok_or(ERROR_ARGUMENT)?;
    let output_required =
        required_extent(rows, output_stride, output_row_length).ok_or(ERROR_ARGUMENT)?;
    if input_required > input.length || output_required > output.length {
        return Err(ERROR_ARGUMENT);
    }
    Ok(())
}

// SAFETY: exported functions call these helpers only after validating that the entire non-null
// region lies in the current linear memory, its byte length fits `isize`, and all mutable and
// immutable regions are pairwise disjoint for the duration of the call.
unsafe fn shared_bytes(region: Region) -> &'static [u8] {
    unsafe { core::slice::from_raw_parts(region.pointer as *const u8, region.length) }
}

// SAFETY: see `shared_bytes`; pairwise region validation additionally guarantees unique mutable
// access to every byte represented by this slice.
unsafe fn exclusive_bytes(region: Region) -> &'static mut [u8] {
    unsafe { core::slice::from_raw_parts_mut(region.pointer as *mut u8, region.length) }
}

#[inline(always)]
fn paeth(left: u8, above: u8, upper_left: u8) -> u8 {
    let left = i32::from(left);
    let above = i32::from(above);
    let upper_left = i32::from(upper_left);
    let prediction = left + above - upper_left;
    let left_distance = (prediction - left).abs();
    let above_distance = (prediction - above).abs();
    let upper_left_distance = (prediction - upper_left).abs();
    if left_distance <= above_distance && left_distance <= upper_left_distance {
        left as u8
    } else if above_distance <= upper_left_distance {
        above as u8
    } else {
        upper_left as u8
    }
}

#[inline(always)]
fn filtered_magnitude(value: u8) -> u64 {
    if value < 128 {
        u64::from(value)
    } else {
        u64::from(256 - u16::from(value))
    }
}

#[cfg(all(target_arch = "wasm32", feature = "simd"))]
#[target_feature(enable = "simd128")]
unsafe fn copy_bytes_simd(source: &[u8], destination: &mut [u8]) {
    use core::arch::wasm32::{v128, v128_load, v128_store};

    let mut index = 0;
    while index + 16 <= source.len() {
        let value = unsafe { v128_load(source.as_ptr().add(index) as *const v128) };
        unsafe { v128_store(destination.as_mut_ptr().add(index) as *mut v128, value) };
        index += 16;
    }
    while index < source.len() {
        destination[index] = source[index];
        index += 1;
    }
}

fn copy_bytes(source: &[u8], destination: &mut [u8]) {
    #[cfg(all(target_arch = "wasm32", feature = "simd"))]
    unsafe {
        // SAFETY: the SIMD build enables simd128 for this function; the caller supplies equal-size,
        // disjoint slices, unaligned vector loads/stores are supported, and the scalar loop handles
        // every byte after the last complete vector.
        copy_bytes_simd(source, destination);
    }
    #[cfg(not(all(target_arch = "wasm32", feature = "simd")))]
    destination.copy_from_slice(source);
}

#[cfg(all(target_arch = "wasm32", feature = "simd"))]
#[target_feature(enable = "simd128")]
unsafe fn unfilter_up_simd(filtered: &[u8], previous: &[u8], output: &mut [u8]) {
    use core::arch::wasm32::{u8x16_add, v128, v128_load, v128_store};

    let mut index = 0;
    while index + 16 <= filtered.len() {
        let encoded = unsafe { v128_load(filtered.as_ptr().add(index) as *const v128) };
        let above = unsafe { v128_load(previous.as_ptr().add(index) as *const v128) };
        let value = u8x16_add(encoded, above);
        unsafe { v128_store(output.as_mut_ptr().add(index) as *mut v128, value) };
        index += 16;
    }
    while index < filtered.len() {
        output[index] = filtered[index].wrapping_add(previous[index]);
        index += 1;
    }
}

fn unfilter_up(filtered: &[u8], previous: &[u8], output: &mut [u8]) {
    #[cfg(all(target_arch = "wasm32", feature = "simd"))]
    unsafe {
        // SAFETY: simd128 is enabled on the specialized function, all slices cover the same row,
        // and complete vectors plus the scalar tail stay within those validated slices.
        unfilter_up_simd(filtered, previous, output);
    }
    #[cfg(not(all(target_arch = "wasm32", feature = "simd")))]
    for index in 0..filtered.len() {
        output[index] = filtered[index].wrapping_add(previous[index]);
    }
}

#[cfg(all(target_arch = "wasm32", feature = "simd"))]
#[target_feature(enable = "simd128")]
unsafe fn filter_up_simd(source: &[u8], previous: &[u8], output: &mut [u8]) {
    use core::arch::wasm32::{u8x16_sub, v128, v128_load, v128_store};

    let mut index = 0;
    while index + 16 <= source.len() {
        let value = unsafe { v128_load(source.as_ptr().add(index) as *const v128) };
        let above = unsafe { v128_load(previous.as_ptr().add(index) as *const v128) };
        let filtered = u8x16_sub(value, above);
        unsafe { v128_store(output.as_mut_ptr().add(index) as *mut v128, filtered) };
        index += 16;
    }
    while index < source.len() {
        output[index] = source[index].wrapping_sub(previous[index]);
        index += 1;
    }
}

fn filter_up(source: &[u8], previous: &[u8], output: &mut [u8]) {
    #[cfg(all(target_arch = "wasm32", feature = "simd"))]
    unsafe {
        // SAFETY: simd128 is enabled on the specialized function, all slices cover the same row,
        // and complete vectors plus the scalar tail stay within those validated slices.
        filter_up_simd(source, previous, output);
    }
    #[cfg(not(all(target_arch = "wasm32", feature = "simd")))]
    for index in 0..source.len() {
        output[index] = source[index].wrapping_sub(previous[index]);
    }
}

// Paeth selects the nearer endpoint when the prediction is tied with the
// corner. Scaling the two midpoint comparisons by two gives these thresholds:
// 3*corner - left - above <= lo selects hi, >= hi selects lo.
#[cfg(feature = "simd")]
#[inline]
fn paeth_lanes(left: v128, above: v128, corner: v128) -> v128 {
    use core::arch::wasm32::*;
    let lo = i16x8_min(left, above);
    let hi = i16x8_max(left, above);
    let t = i16x8_sub(i16x8_sub(i16x8_mul(corner, i16x8_splat(3)), above), left);
    v128_bitselect(
        hi,
        v128_bitselect(lo, corner, i16x8_ge(t, hi)),
        i16x8_le(t, lo),
    )
}

#[cfg(feature = "simd")]
fn paeth_rgba(filtered: &[u8], previous: &[u8], output: &mut [u8]) {
    use core::arch::wasm32::*;
    let mut left = i16x8_splat(0);
    let mut corner = i16x8_splat(0);
    for i in (0..filtered.len()).step_by(4) {
        // SAFETY: dispatch requires equal row lengths divisible by four.
        let (above, residual) = unsafe {
            (
                u16x8_extend_low_u8x16(v128_load32_zero(previous.as_ptr().add(i).cast())),
                u16x8_extend_low_u8x16(v128_load32_zero(filtered.as_ptr().add(i).cast())),
            )
        };
        let predicted = paeth_lanes(left, above, corner);
        left = v128_and(i16x8_add(residual, predicted), i16x8_splat(255));
        let packed = u8x16_narrow_i16x8(left, left);
        // SAFETY: the four output bytes belong to the same validated pixel.
        unsafe {
            v128_store32_lane::<0>(packed, output.as_mut_ptr().add(i).cast());
        }
        corner = above;
    }
}

fn unfilter_row(
    filter: u8,
    filtered: &[u8],
    previous: &[u8],
    bytes_per_pixel: usize,
    output: &mut [u8],
) {
    match filter {
        0 => copy_bytes(filtered, output),
        1 => {
            copy_bytes(&filtered[..bytes_per_pixel], &mut output[..bytes_per_pixel]);
            for index in bytes_per_pixel..filtered.len() {
                output[index] = filtered[index].wrapping_add(output[index - bytes_per_pixel]);
            }
        }
        2 => unfilter_up(filtered, previous, output),
        3 => {
            for index in 0..bytes_per_pixel {
                output[index] = filtered[index].wrapping_add(previous[index] >> 1);
            }
            for index in bytes_per_pixel..filtered.len() {
                let predictor = ((u16::from(output[index - bytes_per_pixel])
                    + u16::from(previous[index]))
                    >> 1) as u8;
                output[index] = filtered[index].wrapping_add(predictor);
            }
        }
        4 => {
            #[cfg(feature = "simd")]
            if bytes_per_pixel == 4 && filtered.len() % 4 == 0 {
                paeth_rgba(filtered, previous, output);
                return;
            }
            for lane in 0..bytes_per_pixel {
                let mut left = 0_u8;
                let mut corner = 0_u8;
                let mut index = lane;
                while index < filtered.len() {
                    let above = previous[index];
                    let predictor = if above == corner {
                        left
                    } else if left == corner {
                        above
                    } else {
                        paeth(left, above, corner)
                    };
                    left = filtered[index].wrapping_add(predictor);
                    output[index] = left;
                    corner = above;
                    index += bytes_per_pixel;
                }
            }
        }
        _ => {}
    }
}

fn score_bytes(
    source: &[u8],
    previous: &[u8],
    bytes_per_pixel: usize,
    range: core::ops::Range<usize>,
    residuals: &mut [u8],
    scores: &mut [u64; 5],
) {
    for index in range {
        let value = source[index];
        let left = if index >= bytes_per_pixel {
            source[index - bytes_per_pixel]
        } else {
            0
        };
        let above = previous[index];
        let upper_left = if index >= bytes_per_pixel {
            previous[index - bytes_per_pixel]
        } else {
            0
        };
        scores[0] += filtered_magnitude(value);
        scores[1] += filtered_magnitude(value.wrapping_sub(left));
        scores[2] += filtered_magnitude(value.wrapping_sub(above));
        scores[3] += filtered_magnitude(
            value.wrapping_sub(((u16::from(left) + u16::from(above)) >> 1) as u8),
        );
        let residual = value.wrapping_sub(paeth(left, above, upper_left));
        residuals[index] = residual;
        scores[4] += filtered_magnitude(residual);
    }
}

#[cfg(feature = "simd")]
mod score_simd {
    use core::arch::wasm32::*;

    #[inline]
    fn magnitude(value: v128) -> v128 {
        u32x4_extadd_pairwise_u16x8(u16x8_extadd_pairwise_u8x16(i8x16_abs(value)))
    }

    pub(super) fn scores(
        source: &[u8],
        previous: &[u8],
        bpp: usize,
        residuals: &mut [u8],
        scores: &mut [u64; 5],
    ) {
        super::score_bytes(source, previous, bpp, 0..bpp, residuals, scores);
        let mut i = bpp;
        while source.len() - i >= 16 {
            // Four bytes per accumulator lane, each contributing at most 128.
            let vectors = ((source.len() - i) / 16).min(65536);
            let mut sums = [u32x4_splat(0); 5];
            for _ in 0..vectors {
                // SAFETY: both rows have the validated row length. i >= bpp and at
                // least 16 bytes remain in each row for all four unaligned loads.
                let (value, left, above, corner) = unsafe {
                    (
                        v128_load(source.as_ptr().add(i).cast()),
                        v128_load(source.as_ptr().add(i - bpp).cast()),
                        v128_load(previous.as_ptr().add(i).cast()),
                        v128_load(previous.as_ptr().add(i - bpp).cast()),
                    )
                };
                let avg = u8x16_sub(
                    u8x16_avgr(left, above),
                    v128_and(v128_xor(left, above), u8x16_splat(1)),
                );
                let lo = super::paeth_lanes(
                    u16x8_extend_low_u8x16(left),
                    u16x8_extend_low_u8x16(above),
                    u16x8_extend_low_u8x16(corner),
                );
                let hi = super::paeth_lanes(
                    u16x8_extend_high_u8x16(left),
                    u16x8_extend_high_u8x16(above),
                    u16x8_extend_high_u8x16(corner),
                );
                let residual = u8x16_sub(value, u8x16_narrow_i16x8(lo, hi));
                // SAFETY: the validated output row has a full vector at i.
                unsafe { v128_store(residuals.as_mut_ptr().add(i).cast(), residual) };

                for (sum, residual) in sums.iter_mut().zip([
                    value,
                    u8x16_sub(value, left),
                    u8x16_sub(value, above),
                    u8x16_sub(value, avg),
                    residual,
                ]) {
                    *sum = u32x4_add(*sum, magnitude(residual));
                }
                i += 16;
            }
            for (score, sum) in scores.iter_mut().zip(sums) {
                *score += u64::from(
                    u32x4_extract_lane::<0>(sum)
                        + u32x4_extract_lane::<1>(sum)
                        + u32x4_extract_lane::<2>(sum)
                        + u32x4_extract_lane::<3>(sum),
                );
            }
        }
        super::score_bytes(source, previous, bpp, i..source.len(), residuals, scores);
    }
}

fn adaptive_filter(
    source: &[u8],
    previous: &[u8],
    bytes_per_pixel: usize,
    residuals: &mut [u8],
) -> u8 {
    // None has score zero and wins every tie on an all-zero row.
    let (words, tail) = source.as_chunks::<8>();
    if words.iter().all(|word| *word == [0; 8]) && tail.iter().all(|&byte| byte == 0) {
        return 0;
    }
    let mut scores = [0_u64; 5];
    #[cfg(feature = "simd")]
    score_simd::scores(source, previous, bytes_per_pixel, residuals, &mut scores);
    #[cfg(not(feature = "simd"))]
    score_bytes(
        source,
        previous,
        bytes_per_pixel,
        0..source.len(),
        residuals,
        &mut scores,
    );
    let mut selected = 0;
    let mut best = scores[0];
    for filter in 1..5 {
        if scores[filter] < best {
            selected = filter;
            best = scores[filter];
        }
    }
    selected as u8
}

fn filter_row(
    filter: u8,
    source: &[u8],
    previous: &[u8],
    bytes_per_pixel: usize,
    output: &mut [u8],
) {
    match filter {
        0 => copy_bytes(source, output),
        1 => {
            copy_bytes(&source[..bytes_per_pixel], &mut output[..bytes_per_pixel]);
            for index in bytes_per_pixel..source.len() {
                output[index] = source[index].wrapping_sub(source[index - bytes_per_pixel]);
            }
        }
        2 => filter_up(source, previous, output),
        3 => {
            for index in 0..bytes_per_pixel {
                output[index] = source[index].wrapping_sub(previous[index] >> 1);
            }
            for index in bytes_per_pixel..source.len() {
                let predictor = ((u16::from(source[index - bytes_per_pixel])
                    + u16::from(previous[index]))
                    >> 1) as u8;
                output[index] = source[index].wrapping_sub(predictor);
            }
        }
        // Adaptive scoring has already written the Paeth residuals.
        _ => {}
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn png_codec_abi_version() -> u32 {
    ABI_VERSION
}

#[unsafe(no_mangle)]
pub extern "C" fn png_codec_simd() -> u32 {
    if cfg!(feature = "simd") { 1 } else { 0 }
}

#[unsafe(no_mangle)]
pub extern "C" fn png_unfilter_rows(
    input_pointer: u32,
    input_length: u32,
    input_stride: u32,
    output_pointer: u32,
    output_capacity: u32,
    output_stride: u32,
    previous_pointer: u32,
    previous_capacity: u32,
    row_bytes: u32,
    bytes_per_pixel: u32,
    row_count: u32,
) -> u32 {
    if row_bytes == 0 || row_count == 0 || bytes_per_pixel == 0 || bytes_per_pixel > row_bytes {
        return ERROR_ARGUMENT;
    }
    let filtered_row_bytes = match row_bytes.checked_add(1) {
        Some(value) => value,
        None => return ERROR_ARGUMENT,
    };
    let memory_bytes = linear_memory_bytes();
    let input = match validate_region(input_pointer, input_length, memory_bytes) {
        Ok(region) => region,
        Err(status) => return status,
    };
    let output = match validate_region(output_pointer, output_capacity, memory_bytes) {
        Ok(region) => region,
        Err(status) => return status,
    };
    let previous = match validate_region(previous_pointer, previous_capacity, memory_bytes) {
        Ok(region) => region,
        Err(status) => return status,
    };
    if let Err(status) = validate_layout(
        input,
        input_stride as usize,
        filtered_row_bytes as usize,
        output,
        output_stride as usize,
        row_bytes as usize,
        previous,
        row_bytes as usize,
        row_count as usize,
    ) {
        return status;
    }

    // SAFETY: all three complete regions were validated against linear memory and checked for
    // pairwise overlap before the slices are created.
    let (input_bytes, output_bytes, previous_bytes) = unsafe {
        (
            shared_bytes(input),
            exclusive_bytes(output),
            exclusive_bytes(previous),
        )
    };
    let input_stride = input_stride as usize;
    let output_stride = output_stride as usize;
    let row_bytes = row_bytes as usize;
    let bytes_per_pixel = bytes_per_pixel as usize;
    let row_count = row_count as usize;

    for row in 0..row_count {
        let filter = input_bytes[row * input_stride];
        if filter > 4 {
            return ERROR_FILTER;
        }
    }
    for row in 0..row_count {
        let input_offset = row * input_stride;
        let output_offset = row * output_stride;
        let filter = input_bytes[input_offset];
        let filtered = &input_bytes[input_offset + 1..input_offset + 1 + row_bytes];
        let output_row = &mut output_bytes[output_offset..output_offset + row_bytes];
        unfilter_row(
            filter,
            filtered,
            &previous_bytes[..row_bytes],
            bytes_per_pixel,
            output_row,
        );
        copy_bytes(output_row, &mut previous_bytes[..row_bytes]);
    }
    STATUS_OK
}

#[unsafe(no_mangle)]
pub extern "C" fn png_filter_rows(
    input_pointer: u32,
    input_length: u32,
    input_stride: u32,
    output_pointer: u32,
    output_capacity: u32,
    output_stride: u32,
    previous_pointer: u32,
    previous_capacity: u32,
    row_bytes: u32,
    bytes_per_pixel: u32,
    row_count: u32,
    adaptive: u32,
) -> u32 {
    if row_bytes == 0
        || row_count == 0
        || bytes_per_pixel == 0
        || bytes_per_pixel > row_bytes
        || adaptive > 1
    {
        return ERROR_ARGUMENT;
    }
    let filtered_row_bytes = match row_bytes.checked_add(1) {
        Some(value) => value,
        None => return ERROR_ARGUMENT,
    };
    let memory_bytes = linear_memory_bytes();
    let input = match validate_region(input_pointer, input_length, memory_bytes) {
        Ok(region) => region,
        Err(status) => return status,
    };
    let output = match validate_region(output_pointer, output_capacity, memory_bytes) {
        Ok(region) => region,
        Err(status) => return status,
    };
    let previous = match validate_region(previous_pointer, previous_capacity, memory_bytes) {
        Ok(region) => region,
        Err(status) => return status,
    };
    if let Err(status) = validate_layout(
        input,
        input_stride as usize,
        row_bytes as usize,
        output,
        output_stride as usize,
        filtered_row_bytes as usize,
        previous,
        row_bytes as usize,
        row_count as usize,
    ) {
        return status;
    }

    // SAFETY: all three complete regions were validated against linear memory and checked for
    // pairwise overlap before the slices are created.
    let (input_bytes, output_bytes, previous_bytes) = unsafe {
        (
            shared_bytes(input),
            exclusive_bytes(output),
            exclusive_bytes(previous),
        )
    };
    let input_stride = input_stride as usize;
    let output_stride = output_stride as usize;
    let row_bytes = row_bytes as usize;
    let bytes_per_pixel = bytes_per_pixel as usize;
    let row_count = row_count as usize;

    for row in 0..row_count {
        let input_offset = row * input_stride;
        let output_offset = row * output_stride;
        let source = &input_bytes[input_offset..input_offset + row_bytes];
        let output_row = &mut output_bytes[output_offset..output_offset + row_bytes + 1];
        let filter = if adaptive == 1 {
            adaptive_filter(
                source,
                &previous_bytes[..row_bytes],
                bytes_per_pixel,
                &mut output_row[1..],
            )
        } else {
            0
        };
        output_row[0] = filter;
        filter_row(
            filter,
            source,
            &previous_bytes[..row_bytes],
            bytes_per_pixel,
            &mut output_row[1..],
        );
        copy_bytes(source, &mut previous_bytes[..row_bytes]);
    }
    STATUS_OK
}
