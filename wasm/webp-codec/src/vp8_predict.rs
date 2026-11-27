use super::{
    ERROR_ARGUMENT, STATUS_OK, exclusive_bytes, regions_overlap, shared_u32, validate_region,
    validate_u32_region,
};
// Each plane has a top row, one left column and space for four above-right samples.
const STRIDE: usize = 24;
const PLANE_BYTES: usize = 17 * STRIDE;
fn average2(a: u8, b: u8) -> u8 {
    ((u16::from(a) + u16::from(b) + 1) >> 1) as u8
}

fn average3(a: u8, b: u8, c: u8) -> u8 {
    ((u16::from(a) + 2 * u16::from(b) + u16::from(c) + 2) >> 2) as u8
}

fn predict_square(plane: &mut [u8], offset: usize, size: usize, mode: u8) {
    let dc = if mode == 0 {
        let mut sum = size as u32;
        for i in 0..size {
            sum +=
                u32::from(plane[offset - STRIDE + i]) + u32::from(plane[offset - 1 + i * STRIDE]);
        }
        (sum / (2 * size) as u32) as u8
    } else {
        0
    };
    let corner = i32::from(plane[offset - STRIDE - 1]);
    for y in 0..size {
        let row = offset + y * STRIDE;
        let left = plane[row - 1];
        match mode {
            1 => {
                plane.copy_within(offset - STRIDE..offset - STRIDE + size, row);
            }
            2 => plane[row..row + size].fill(left),
            3 => {
                for x in 0..size {
                    plane[row + x] = (i32::from(left) + i32::from(plane[offset - STRIDE + x])
                        - corner)
                        .clamp(0, 255) as u8;
                }
            }
            _ => plane[row..row + size].fill(dc),
        }
    }
}

fn predict_block(plane: &mut [u8], offset: usize, mode: u8) {
    if mode <= 1 {
        predict_square(plane, offset, 4, if mode == 1 { 3 } else { 0 });
        return;
    }
    let above = offset - STRIDE;
    let corner = plane[above - 1];
    let t0 = plane[above];
    let t1 = plane[above + 1];
    let t2 = plane[above + 2];
    let t3 = plane[above + 3];
    let t4 = plane[above + 4];
    let t5 = plane[above + 5];
    let t6 = plane[above + 6];
    let t7 = plane[above + 7];
    let l0 = plane[offset - 1];
    let l1 = plane[offset - 1 + STRIDE];
    let l2 = plane[offset - 1 + 2 * STRIDE];
    let l3 = plane[offset - 1 + 3 * STRIDE];
    if mode == 2 {
        let c0 = average3(corner, t0, t1);
        let c1 = average3(t0, t1, t2);
        let c2 = average3(t1, t2, t3);
        let c3 = average3(t2, t3, t4);
        plane[offset..][..4].copy_from_slice(&[c0, c1, c2, c3]);
        plane[offset + STRIDE..][..4].copy_from_slice(&[c0, c1, c2, c3]);
        plane[offset + 2 * STRIDE..][..4].copy_from_slice(&[c0, c1, c2, c3]);
        plane[offset + 3 * STRIDE..][..4].copy_from_slice(&[c0, c1, c2, c3]);
        return;
    }
    if mode == 3 {
        let c0 = average3(corner, l0, l1);
        let c1 = average3(l0, l1, l2);
        let c2 = average3(l1, l2, l3);
        let c3 = average3(l2, l3, l3);
        plane[offset..][..4].copy_from_slice(&[c0, c0, c0, c0]);
        plane[offset + STRIDE..][..4].copy_from_slice(&[c1, c1, c1, c1]);
        plane[offset + 2 * STRIDE..][..4].copy_from_slice(&[c2, c2, c2, c2]);
        plane[offset + 3 * STRIDE..][..4].copy_from_slice(&[c3, c3, c3, c3]);
        return;
    }
    if mode == 4 {
        let a01 = average3(t0, t1, t2);
        let a12 = average3(t1, t2, t3);
        let a23 = average3(t2, t3, t4);
        let a34 = average3(t3, t4, t5);
        let a45 = average3(t4, t5, t6);
        let a56 = average3(t5, t6, t7);
        let a67 = average3(t6, t7, t7);
        plane[offset..][..4].copy_from_slice(&[a01, a12, a23, a34]);
        plane[offset + STRIDE..][..4].copy_from_slice(&[a12, a23, a34, a45]);
        plane[offset + 2 * STRIDE..][..4].copy_from_slice(&[a23, a34, a45, a56]);
        plane[offset + 3 * STRIDE..][..4].copy_from_slice(&[a34, a45, a56, a67]);
        return;
    }
    if mode == 7 {
        plane[offset..][..4].copy_from_slice(&[
            average2(t0, t1),
            average2(t1, t2),
            average2(t2, t3),
            average2(t3, t4),
        ]);
        plane[offset + STRIDE..][..4].copy_from_slice(&[
            average3(t0, t1, t2),
            average3(t1, t2, t3),
            average3(t2, t3, t4),
            average3(t3, t4, t5),
        ]);
        plane[offset + 2 * STRIDE..][..4].copy_from_slice(&[
            average2(t1, t2),
            average2(t2, t3),
            average2(t3, t4),
            average3(t4, t5, t6),
        ]);
        plane[offset + 3 * STRIDE..][..4].copy_from_slice(&[
            average3(t1, t2, t3),
            average3(t2, t3, t4),
            average3(t3, t4, t5),
            average3(t5, t6, t7),
        ]);
        return;
    }
    if mode == 5 {
        plane[offset..][..4].copy_from_slice(&[
            average3(l0, corner, t0),
            average3(corner, t0, t1),
            average3(t0, t1, t2),
            average3(t1, t2, t3),
        ]);
        plane[offset + STRIDE..][..4].copy_from_slice(&[
            average3(l1, l0, corner),
            average3(l0, corner, t0),
            average3(corner, t0, t1),
            average3(t0, t1, t2),
        ]);
        plane[offset + 2 * STRIDE..][..4].copy_from_slice(&[
            average3(l2, l1, l0),
            average3(l1, l0, corner),
            average3(l0, corner, t0),
            average3(corner, t0, t1),
        ]);
        plane[offset + 3 * STRIDE..][..4].copy_from_slice(&[
            average3(l3, l2, l1),
            average3(l2, l1, l0),
            average3(l1, l0, corner),
            average3(l0, corner, t0),
        ]);
        return;
    }
    if mode == 6 {
        let a0 = average2(corner, t0);
        let a1 = average2(t0, t1);
        let a2 = average2(t1, t2);
        let a3 = average2(t2, t3);
        let b0 = average3(l0, corner, t0);
        let b1 = average3(corner, t0, t1);
        let b2 = average3(t0, t1, t2);
        plane[offset..][..4].copy_from_slice(&[a0, a1, a2, a3]);
        plane[offset + STRIDE..][..4].copy_from_slice(&[b0, b1, b2, average3(t1, t2, t3)]);
        plane[offset + 2 * STRIDE..][..4].copy_from_slice(&[average3(l1, l0, corner), a0, a1, a2]);
        plane[offset + 3 * STRIDE..][..4].copy_from_slice(&[average3(l2, l1, l0), b0, b1, b2]);
        return;
    }
    if mode == 8 {
        let a0 = average2(l0, corner);
        let a1 = average3(l0, corner, t0);
        let b0 = average2(l1, l0);
        let b1 = average3(l1, l0, corner);
        let c0 = average2(l2, l1);
        let c1 = average3(l2, l1, l0);
        plane[offset..][..4].copy_from_slice(&[
            a0,
            a1,
            average3(corner, t0, t1),
            average3(t0, t1, t2),
        ]);
        plane[offset + STRIDE..][..4].copy_from_slice(&[b0, b1, a0, a1]);
        plane[offset + 2 * STRIDE..][..4].copy_from_slice(&[c0, c1, b0, b1]);
        plane[offset + 3 * STRIDE..][..4].copy_from_slice(&[
            average2(l3, l2),
            average3(l3, l2, l1),
            c0,
            c1,
        ]);
        return;
    }
    plane[offset..][..4].copy_from_slice(&[
        average2(l0, l1),
        average3(l0, l1, l2),
        average2(l1, l2),
        average3(l1, l2, l3),
    ]);
    plane[offset + STRIDE..][..4].copy_from_slice(&[
        average2(l1, l2),
        average3(l1, l2, l3),
        average2(l2, l3),
        average3(l2, l3, l3),
    ]);
    plane[offset + 2 * STRIDE..][..4].copy_from_slice(&[
        average2(l2, l3),
        average3(l2, l3, l3),
        l3,
        l3,
    ]);
    plane[offset + 3 * STRIDE..][..4].copy_from_slice(&[l3, l3, l3, l3]);
}

// The reference multiplies in Number and applies a signed 32-bit shift.
#[inline]
fn idct(x: [i32; 4]) -> [i32; 4] {
    let [dc, one, two, three] = x;
    let a = dc + two;
    let b = dc - two;
    let c = (one.wrapping_mul(35468) >> 16) - three - (three.wrapping_mul(20091) >> 16);
    let d = one + (one.wrapping_mul(20091) >> 16) + (three.wrapping_mul(35468) >> 16);
    [a + d, b + c, b - c, a - d]
}

#[inline]
fn walsh(x: [i32; 4]) -> [i32; 4] {
    let a = x[0] + x[3];
    let b = x[1] + x[2];
    let c = x[1] - x[2];
    let d = x[0] - x[3];
    [a + b, c + d, a - b, d - c]
}

fn luma_dc(words: &[u32]) -> [i32; 16] {
    let mut temp = [0_i32; 16];
    for x in 0..4 {
        let col = walsh([
            words[x] as i32,
            words[x + 4] as i32,
            words[x + 8] as i32,
            words[x + 12] as i32,
        ]);
        for y in 0..4 {
            temp[4 * y + x] = col[y];
        }
    }
    for row in temp.as_chunks_mut::<4>().0 {
        *row = walsh(*row).map(|value| (value + 3) >> 3);
    }
    temp
}

fn add_residual(plane: &mut [u8], offset: usize, block: &[u32], end: u32, dc: i32) {
    if end <= 1 {
        let delta = (dc + 4) >> 3;
        if delta != 0 {
            for y in 0..4 {
                for pixel in &mut plane[offset + y * STRIDE..][..4] {
                    *pixel = (i32::from(*pixel) + delta).clamp(0, 255) as u8;
                }
            }
        }
        return;
    }
    let mut temp = [0_i32; 16];
    for x in 0..4 {
        let col = idct([
            if x == 0 { dc } else { block[x] as i32 },
            block[x + 4] as i32,
            block[x + 8] as i32,
            block[x + 12] as i32,
        ]);
        for y in 0..4 {
            temp[y * 4 + x] = col[y];
        }
    }
    for (y, row) in temp.as_chunks::<4>().0.iter().enumerate() {
        for (pixel, delta) in plane[offset + y * STRIDE..][..4].iter_mut().zip(idct(*row)) {
            *pixel = (i32::from(*pixel) + ((delta + 4) >> 3)).clamp(0, 255) as u8;
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn webp_predict_tile(
    state: u32,
    tile: u32,
    y_mode: u32,
    uv_mode: u32,
    right: u32,
) -> u32 {
    let result = (|| -> Result<(), u32> {
        if y_mode > 4 || uv_mode > 3 || right > 1 {
            return Err(ERROR_ARGUMENT);
        }
        let st = validate_u32_region(state, 454)?;
        let tile = validate_region(tile, (16 + PLANE_BYTES * 3) as u32, 1)?;
        if regions_overlap(st, tile) {
            return Err(ERROR_ARGUMENT);
        }
        // SAFETY: the validated state and tile are disjoint.
        let (state, tile) = unsafe { (shared_u32(st), exclusive_bytes(tile)) };
        predict(state, tile, y_mode, uv_mode, right)
    })();
    result.map_or_else(|e| e, |_| STATUS_OK)
}

pub(super) const TILE_BYTES: usize = 16 + PLANE_BYTES * 3;
pub(super) fn predict(
    state: &[u32],
    tile: &mut [u8],
    y_mode: u32,
    uv_mode: u32,
    right: u32,
) -> Result<(), u32> {
    let (modes, planes) = tile.split_at_mut(16);
    if y_mode == 4 && modes.iter().any(|&mode| mode > 9) {
        return Err(ERROR_ARGUMENT);
    }
    let ends = &state[29..54];
    let words = &state[54..];
    let dc = if y_mode == 4 {
        None
    } else {
        Some(luma_dc(&words[384..400]))
    };
    for (i, plane) in planes.chunks_exact_mut(PLANE_BYTES).enumerate() {
        let size = if i == 0 { 16 } else { 8 };
        let start = STRIDE + 1;
        let split = i == 0 && y_mode == 4;
        if split {
            if right != 0 {
                let last = plane[16];
                plane[17..21].fill(last);
            }
            for y in [3, 7, 11] {
                plane.copy_within(17..21, start + y * STRIDE + 16);
            }
        } else {
            predict_square(
                plane,
                start,
                size,
                if i == 0 { y_mode as u8 } else { uv_mode as u8 },
            );
        }
        for y in 0..size / 4 {
            for x in 0..size / 4 {
                let index = y * (size / 4) + x;
                let off = start + 4 * y * STRIDE + 4 * x;
                if split {
                    predict_block(plane, off, modes[index]);
                }
                let block_index = index + [0, 16, 20][i];
                let block = &words[16 * block_index..][..16];
                let dc = if i == 0 {
                    dc.as_ref().map_or(block[0] as i32, |dc| dc[index])
                } else {
                    block[0] as i32
                };
                add_residual(plane, off, block, ends[block_index], dc);
            }
        }
    }
    Ok(())
}
