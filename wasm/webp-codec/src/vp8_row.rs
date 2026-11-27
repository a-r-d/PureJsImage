// A row is a transaction. Only JS owns the committed planes and entropy
// contexts. A long row can refill its token window between macroblocks.
use super::{
    ERROR_ARGUMENT, STATUS_OK, exclusive_bytes, regions_overlap, shared_bytes, validate_region,
    vp8_coefficients, vp8_predict,
};

// Words 0..5 hold the token reader, 5..29 the quantizers, and 29..38 the
// left contexts. Words 38..42 hold the control reader, 42 the segmentation
// configuration, 43 the skip probability (256 disables it), and 44..48
// the packed loop-filter parameters.
const HEADER: usize = 48 * 4;
const BLOCK: usize = 30; // Y/UV/segment/skip, 16 submodes, 9 above contexts, nonzero
const TILE_STRIDE: usize = 24;
const TILE_PLANE: usize = 17 * TILE_STRIDE;

fn word(bytes: &[u8], index: usize) -> u32 {
    let i = index * 4;
    u32::from_le_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]])
}
fn set_word(bytes: &mut [u8], index: usize, value: u32) {
    bytes[index * 4..index * 4 + 4].copy_from_slice(&value.to_le_bytes());
}

fn borders(
    dst: &mut [u8],
    plane: &[u8],
    stride: usize,
    size: usize,
    col: usize,
    first: bool,
    mode: u8,
) {
    let x = col * size;
    dst[..size + 5].copy_from_slice(&plane[x..x + size + 5]);
    for y in 0..size {
        dst[(y + 1) * TILE_STRIDE] = if col != 0 {
            plane[(y + 1) * stride + x]
        } else if !first && mode == 0 {
            plane[x + 1 + y]
        } else {
            129
        };
    }
    if col == 0 {
        dst[0] = if !first && mode == 0 { plane[0] } else { 129 };
    }
    if first {
        if col > 0 && mode == 0 {
            // Top-row DC substitutes the left edge for the unavailable top.
            for y in 0..size {
                dst[1 + y] = dst[(y + 1) * TILE_STRIDE];
            }
        } else {
            dst[..size + 1].fill(127);
        }
        dst[size + 1..size + 5].fill(127);
    }
}

fn commit_tile(src: &[u8], plane: &mut [u8], stride: usize, size: usize, col: usize) {
    for y in 0..size {
        let start = (y + 1) * stride + col * size + 1;
        plane[start..start + size].copy_from_slice(&src[(y + 1) * TILE_STRIDE + 1..][..size]);
        // The left border is needed as above-left on the next macroblock row.
        if col == 0 {
            plane[start - 1] = src[(y + 1) * TILE_STRIDE];
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn webp_vp8_row(
    input: u32,
    available: u32,
    more: u32,
    probs: u32,
    scratch: u32,
    columns: u32,
    first: u32,
    begin: u32,
    control: u32,
    control_len: u32,
    control_more: u32,
    mode_probs: u32,
    width: u32,
    second: u32,
    simple_filter: u32,
) -> u32 {
    let result = (|| -> Result<(), u32> {
        if !(1..=1024).contains(&columns)
            || begin >= columns
            || available > 16384
            || first > 1
            || more > 1
            || (more != 0 && available < 8192)
        {
            return Err(ERROR_ARGUMENT);
        }
        if control_len > 4096 || control_more > 1 || (control_more != 0 && control_len < 256) {
            return Err(ERROR_ARGUMENT);
        }
        let control_region = validate_region(control, control_len.max(1), 1)?;
        let mode_region = validate_region(mode_probs, 900, 1)?;
        let cols = columns as usize;
        if width == 0 || width.div_ceil(16) != columns || second > 1 || simple_filter > 1 {
            return Err(ERROR_ARGUMENT);
        }
        let width = width as usize;
        let ys = 16 * cols + 6;
        let cs = 8 * cols + 6;
        let rgba_offset =
            (HEADER + BLOCK * cols + 33 * ys + 34 * cs + ys + 2 * cs + 3 * cols + 3) & !3;
        let length = rgba_offset + 16 * width * 4;
        let s = validate_region(scratch, length as u32, 4)?;
        let p = validate_region(probs, 1056, 1)?;
        let d = validate_region(input, available.max(1), 1)?;
        if regions_overlap(s, p)
            || regions_overlap(s, d)
            || regions_overlap(s, control_region)
            || regions_overlap(s, mode_region)
        {
            return Err(ERROR_ARGUMENT);
        }
        // SAFETY: scratch is disjoint from all validated read-only regions.
        let (bytes, probs, data) = unsafe {
            (
                exclusive_bytes(s),
                shared_bytes(p),
                &shared_bytes(d)[..available as usize],
            )
        };
        let (bytes, rgba) = bytes.split_at_mut(rgba_offset);
        let (header, bytes) = bytes.split_at_mut(HEADER);
        let (blocks, planes) = bytes.split_at_mut(cols * BLOCK);
        let (y_full, planes) = planes.split_at_mut(ys * 33);
        let (u_full, planes) = planes.split_at_mut(cs * 17);
        let (v_full, rest) = planes.split_at_mut(cs * 17);
        let yp = &mut y_full[16 * ys..];
        let up = &mut u_full[8 * cs..];
        let vp = &mut v_full[8 * cs..];
        let mut state = [0_u32; 454];
        let mut tile = [0_u8; vp8_predict::TILE_BYTES];
        for i in 0..3 {
            state[i] = word(header, i);
        }
        for i in 0..9 {
            state[11 + i] = word(header, 29 + i);
        }
        // SAFETY: all validated read-only regions are disjoint from scratch.
        let mut modes = vp8_coefficients::Reader {
            data: unsafe { &shared_bytes(control_region)[..control_len as usize] },
            next: 0,
            range: word(header, 38),
            value: word(header, 39),
            bits: word(header, 40) as i32,
        };
        let table = unsafe { shared_bytes(mode_region) };
        if !(128..=255).contains(&modes.range)
            || !(0..=15).contains(&modes.bits)
            || modes.value >= modes.range << modes.bits
        {
            return Err(ERROR_ARGUMENT);
        }
        let skip_probability = word(header, 43);
        let mut pos = 0;
        let mut col = begin as usize;
        while col < cols {
            if more != 0 && data.len().saturating_sub(pos) < 8192 {
                break;
            }
            if control_more != 0 && modes.data.len().saturating_sub(modes.next) < 256 {
                break;
            }
            let off = col * BLOCK;
            if blocks[off] > 4
                || (blocks[off] == 4 && blocks[off + 16..off + 20].iter().any(|&m| m > 9))
                || (col != 0
                    && (blocks[off - BLOCK] > 4
                        || (blocks[off - BLOCK] == 4
                            && blocks[off - BLOCK + 4..off - BLOCK + 20]
                                .iter()
                                .any(|&m| m > 9))))
            {
                return Err(ERROR_ARGUMENT);
            }
            super::vp8_modes::decode(
                &mut modes,
                blocks,
                col,
                BLOCK,
                table,
                &header[42 * 4..42 * 4 + 4],
                skip_probability,
            );
            let cfg = &mut blocks[col * BLOCK..][..BLOCK];
            let (ym, uv, seg, skip) = (cfg[0], cfg[1], cfg[2] as usize, cfg[3]);
            if ym > 4 || uv > 3 || seg > 3 || skip > 1 {
                return Err(ERROR_ARGUMENT);
            }
            for i in 0..9 {
                state[20 + i] = u32::from(cfg[20 + i]);
            }
            if skip == 0 {
                for i in 0..6 {
                    state[5 + i] = word(header, 5 + seg * 6 + i);
                }
                vp8_coefficients::decode(
                    &data[pos.min(data.len())..],
                    probs,
                    &mut state,
                    u32::from(ym == 4),
                )?;
                pos += state[3] as usize;
                cfg[29] = state[4] as u8;
            } else {
                let contexts = if ym == 4 { 8 } else { 9 };
                state[11..11 + contexts].fill(0);
                state[20..20 + contexts].fill(0);
                state[29..].fill(0);
                cfg[29] = 0;
            }
            for i in 0..9 {
                cfg[20 + i] = state[20 + i] as u8;
            }
            tile[..16].copy_from_slice(&cfg[4..20]);
            let (y, other) = tile[16..].split_at_mut(TILE_PLANE);
            let (u, v) = other.split_at_mut(TILE_PLANE);
            borders(y, yp, ys, 16, col, first != 0, ym);
            borders(u, up, cs, 8, col, first != 0, uv);
            borders(v, vp, cs, 8, col, first != 0, uv);
            vp8_predict::predict(
                &state,
                &mut tile,
                u32::from(ym),
                u32::from(uv),
                u32::from(col + 1 == cols),
            )?;
            let (y, other) = tile[16..].split_at(TILE_PLANE);
            let (u, v) = other.split_at(TILE_PLANE);
            commit_tile(y, yp, ys, 16, col);
            commit_tile(u, up, cs, 8, col);
            commit_tile(v, vp, cs, 8, col);
            col += 1;
        }
        if col == cols {
            let (saved_y, rest) = rest.split_at_mut(ys);
            let (saved_u, rest) = rest.split_at_mut(cs);
            let (saved_v, rest) = rest.split_at_mut(cs);
            let params = &mut rest[..3 * cols];
            for (block, param) in blocks.chunks_exact(BLOCK).zip(params.chunks_exact_mut(3)) {
                let split = block[0] == 4;
                if block[2] > 3 {
                    return Err(ERROR_ARGUMENT);
                }
                let index = 44 * 4 + 4 * block[2] as usize + 2 * usize::from(split);
                param.copy_from_slice(&[
                    header[index],
                    header[index + 1],
                    u8::from(split || block[29] != 0),
                ]);
            }
            let previous = first == 0;
            finish_plane(
                y_full,
                saved_y,
                ys,
                16,
                previous,
                params,
                simple_filter != 0,
            );
            finish_plane(u_full, saved_u, cs, 8, previous, params, simple_filter != 0);
            finish_plane(v_full, saved_v, cs, 8, previous, params, simple_filter != 0);
            if previous {
                // SAFETY: scratch is 4-byte aligned, rgba_offset is rounded to
                // four bytes and rgba is a disjoint 16-row output slice.
                let output = unsafe {
                    core::slice::from_raw_parts_mut(rgba.as_mut_ptr().cast::<u32>(), 16 * width)
                };
                for (line, dst) in output.chunks_exact_mut(width).enumerate() {
                    let center = 1 + (line >> 1);
                    let neighbor = if line == 0 && second != 0 {
                        1
                    } else if line & 1 == 0 {
                        center - 1
                    } else {
                        center + 1
                    };
                    let uv_width = width.div_ceil(2);
                    super::vp8_rgba::convert_row(
                        &y_full[(line + 1) * ys + 1..][..width],
                        &u_full[center * cs + 1..][..uv_width],
                        &u_full[neighbor * cs + 1..][..uv_width],
                        &v_full[center * cs + 1..][..uv_width],
                        &v_full[neighbor * cs + 1..][..uv_width],
                        dst,
                    );
                }
            }
        }
        set_word(header, 38, modes.range);
        set_word(header, 39, modes.value);
        set_word(header, 40, modes.bits as u32);
        set_word(header, 41, modes.next as u32);
        for i in 0..3 {
            set_word(header, i, state[i]);
        }
        set_word(header, 3, pos as u32);
        set_word(header, 4, col as u32);
        for i in 0..9 {
            set_word(header, 29 + i, state[11 + i]);
        }
        Ok(())
    })();
    result.map_or_else(|error| error, |_| STATUS_OK)
}

// Prediction consumes the unfiltered last row. Restore its filtered copy for
// deblocking and keep the next predictor border before changing any pixels.
fn finish_plane(
    plane: &mut [u8],
    saved: &mut [u8],
    stride: usize,
    size: usize,
    previous: bool,
    params: &[u8],
    simple_filter: bool,
) {
    if previous {
        plane[size * stride..][..stride].copy_from_slice(saved);
    }
    saved.copy_from_slice(&plane[2 * size * stride..][..stride]);
    let above = if previous { 4 } else { 0 };
    let band = &mut plane[(size + 1 - above) * stride + 1..];
    if simple_filter {
        // The VP8 simple filter changes luma only.
        if size == 16 {
            super::vp8_filter::apply::<true>(band, params, size, stride, above);
        }
    } else {
        super::vp8_filter::apply::<false>(band, params, size, stride, above);
    }
}
