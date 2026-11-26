// Apply the VP8 normal loop filter to one bounded plane band, preserving the
// column order of vertical, internal, horizontal and internal edges.
use super::{
    ERROR_ARGUMENT, STATUS_OK, exclusive_bytes, regions_overlap, shared_bytes, validate_region,
};

#[inline]
fn byte(value: i32) -> u8 {
    value.clamp(0, 255) as u8
}

fn edge(
    data: &mut [u8],
    start: usize,
    step: usize,
    advance: usize,
    size: usize,
    level: i32,
    interior: i32,
    variance: i32,
    outer: bool,
) {
    let limit = 2 * level + interior;
    for i in 0..size {
        let q = start + i * advance;
        let p1 = i32::from(data[q - 2 * step]);
        let p0 = i32::from(data[q - step]);
        let q0 = i32::from(data[q]);
        let q1 = i32::from(data[q + step]);
        if p0 == q0 && p1 == q1 || 2 * (p0 - q0).abs() + ((p1 - q1).abs() >> 1) > limit {
            continue;
        }
        let p3 = i32::from(data[q - 4 * step]);
        let p2 = i32::from(data[q - 3 * step]);
        let q2 = i32::from(data[q + 2 * step]);
        let q3 = i32::from(data[q + 3 * step]);
        let near = (p1 - p0).abs().max((q1 - q0).abs());
        if near > interior
            || (p3 - p2)
                .abs()
                .max((p2 - p1).abs())
                .max((q2 - q1).abs())
                .max((q3 - q2).abs())
                > interior
        {
            continue;
        }
        let high = near > variance;
        let delta = 3 * (q0 - p0);
        let adjust = if high || outer {
            delta + (p1 - q1).clamp(-128, 127)
        } else {
            delta
        }
        .clamp(-128, 127);
        if outer && !high {
            let d27 = (27 * adjust + 63) >> 7;
            let d18 = (18 * adjust + 63) >> 7;
            let d9 = (9 * adjust + 63) >> 7;
            data[q - step] = byte(p0 + d27);
            data[q] = byte(q0 - d27);
            data[q - 2 * step] = byte(p1 + d18);
            data[q + step] = byte(q1 - d18);
            data[q - 3 * step] = byte(p2 + d9);
            data[q + 2 * step] = byte(q2 - d9);
        } else {
            let first = (adjust + 4).min(127) >> 3;
            let second = (adjust + 3).min(127) >> 3;
            data[q - step] = byte(p0 + second);
            data[q] = byte(q0 - first);
            if !high && !outer {
                let d = (first + 1) >> 1;
                data[q - 2 * step] = byte(p1 + d);
                data[q + step] = byte(q1 - d);
            }
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn webp_vp8_filter_plane(
    data: u32,
    length: u32,
    stride: u32,
    size: u32,
    above: u32,
    params: u32,
    columns: u32,
) -> u32 {
    let result = (|| -> Result<(), u32> {
        if !matches!(size, 8 | 16)
            || columns == 0
            || columns > 1024
            || above > 1
            || stride < columns * size
        {
            return Err(ERROR_ARGUMENT);
        }
        let above_rows = above * 4;
        let required = (size + above_rows - 1)
            .checked_mul(stride)
            .and_then(|n| n.checked_add(columns * size))
            .ok_or(ERROR_ARGUMENT)?;
        if required > length {
            return Err(ERROR_ARGUMENT);
        }
        let plane = validate_region(data, length, 1)?;
        let cfg = validate_region(params, columns * 3, 1)?;
        if regions_overlap(plane, cfg) {
            return Err(ERROR_ARGUMENT);
        }
        // SAFETY: the padded plane and the complete parameter array are bounded and disjoint.
        let (data, params) = unsafe { (exclusive_bytes(plane), shared_bytes(cfg)) };
        let (size, stride) = (size as usize, stride as usize);
        for (col, param) in params.chunks_exact(3).enumerate() {
            let level = i32::from(param[0]);
            if level == 0 {
                continue;
            }
            let interior = i32::from(param[1]);
            let variance = i32::from(level >= 15) + i32::from(level >= 40);
            let subblocks = param[2] != 0;
            let q = above_rows as usize * stride + col * size;
            if col != 0 {
                edge(
                    data,
                    q,
                    1,
                    stride,
                    size,
                    level + 2,
                    interior,
                    variance,
                    true,
                )
            }
            if subblocks {
                for x in (4..size).step_by(4) {
                    edge(
                        data,
                        q + x,
                        1,
                        stride,
                        size,
                        level,
                        interior,
                        variance,
                        false,
                    )
                }
            }
            if above != 0 {
                edge(
                    data,
                    q,
                    stride,
                    1,
                    size,
                    level + 2,
                    interior,
                    variance,
                    true,
                )
            }
            if subblocks {
                for y in (4..size).step_by(4) {
                    edge(
                        data,
                        q + y * stride,
                        stride,
                        1,
                        size,
                        level,
                        interior,
                        variance,
                        false,
                    )
                }
            }
        }
        Ok(())
    })();
    result.map_or_else(|error| error, |_| STATUS_OK)
}
