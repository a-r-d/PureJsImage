// Key-frame mode trees and context indices match the TypeScript VP8 reader.
use super::vp8_coefficients::Reader;

const Y: [i8; 8] = [-4, 2, 4, 6, 0, -1, -2, -3];
const UV: [i8; 6] = [0, 2, -1, 4, -2, -3];
const SQUARE: [u8; 4] = [0, 2, 3, 1];

fn tree(r: &mut Reader, tree: &[i8], p: &[u8]) -> u8 {
    let mut i = 0;
    loop {
        let branch = tree[i + r.bit(p[i / 2]) as usize];
        if branch <= 0 {
            return (-branch) as u8;
        }
        i = branch as usize;
    }
}

// The ten 4x4 prediction modes have a fixed tree. Keep its probability
// offsets independent of the previously decoded branch.
fn subblock_mode(r: &mut Reader, p: &[u8]) -> u8 {
    if r.bit(p[0]) == 0 {
        return 0;
    }
    if r.bit(p[1]) == 0 {
        return 1;
    }
    if r.bit(p[2]) == 0 {
        return 2;
    }
    if r.bit(p[3]) == 0 {
        if r.bit(p[4]) == 0 {
            3
        } else {
            5 + r.bit(p[5]) as u8
        }
    } else if r.bit(p[6]) == 0 {
        4
    } else if r.bit(p[7]) == 0 {
        7
    } else {
        8 + r.bit(p[8]) as u8
    }
}

// On entry the descriptor still contains the entire block above.
// The previous block's four rightmost modes are still in the row workspace.
pub(super) fn decode(
    r: &mut Reader,
    blocks: &mut [u8],
    col: usize,
    block_size: usize,
    p: &[u8],
    seg: &[u8],
    skip: u32,
) {
    let (earlier, here) = blocks.split_at_mut(col * block_size);
    let cfg = &mut here[..block_size];
    let mut left = [0; 4];
    if col != 0 {
        let prev = &earlier[earlier.len() - block_size..];
        if prev[0] == 4 {
            for y in 0..4 {
                left[y] = prev[7 + 4 * y];
            }
        } else {
            left.fill(SQUARE[prev[0] as usize]);
        }
    }
    let mut top = [0; 4];
    if cfg[0] == 4 {
        top.copy_from_slice(&cfg[16..20]);
    } else {
        top.fill(SQUARE[cfg[0] as usize]);
    }
    cfg[2] = if seg[0] == 0 {
        0
    } else if r.bit(seg[1]) != 0 {
        2 + r.bit(seg[3]) as u8
    } else {
        r.bit(seg[2]) as u8
    };
    cfg[3] = if skip <= 255 {
        r.bit(skip as u8) as u8
    } else {
        0
    };
    cfg[0] = tree(r, &Y, &[145, 156, 163, 128]);
    if cfg[0] == 4 {
        for i in 0..16 {
            let above = if i < 4 { top[i] } else { cfg[i] };
            let side = if i % 4 == 0 { left[i / 4] } else { cfg[3 + i] };
            let start = 9 * (10 * above as usize + side as usize);
            cfg[4 + i] = subblock_mode(r, &p[start..start + 9]);
        }
    }
    cfg[1] = tree(r, &UV, &[142, 114, 183]);
}
