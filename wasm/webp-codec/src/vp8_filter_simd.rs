use core::arch::wasm32::*;

// Each vector contains two 8-byte rows. Gather four rows at a time, then
// interleave the two groups into eight columns. The inverse is the same transpose.
#[inline(always)]
fn transpose([a, b, c, d]: [v128; 4]) -> [v128; 4] {
    let low =
        |a, b| i8x16_shuffle::<0, 8, 16, 24, 1, 9, 17, 25, 2, 10, 18, 26, 3, 11, 19, 27>(a, b);
    let high =
        |a, b| i8x16_shuffle::<4, 12, 20, 28, 5, 13, 21, 29, 6, 14, 22, 30, 7, 15, 23, 31>(a, b);
    let (lo1, lo2) = (low(a, b), low(c, d));
    let (hi1, hi2) = (high(a, b), high(c, d));
    [
        i32x4_shuffle::<0, 4, 1, 5>(lo1, lo2),
        i32x4_shuffle::<2, 6, 3, 7>(lo1, lo2),
        i32x4_shuffle::<0, 4, 1, 5>(hi1, hi2),
        i32x4_shuffle::<2, 6, 3, 7>(hi1, hi2),
    ]
}

pub(super) fn edge<const VERTICAL: bool>(
    data: &mut [u8],
    q: usize,
    stride: usize,
    level: i32,
    interior: i32,
    variance: i32,
    outer: bool,
) {
    let origin = if VERTICAL { q - 4 } else { q - 4 * stride };
    let load = |i: usize| {
        let a = &data[origin + i * stride..][..8];
        let b = &data[origin + (i + 1) * stride..][..8];
        // SAFETY: each of these bounded slices contains the eight bytes loaded.
        unsafe { v128_load64_lane::<1>(v128_load64_zero(a.as_ptr().cast()), b.as_ptr().cast()) }
    };
    let rows = [load(0), load(2), load(4), load(6)];
    let [a, b, c, d] = if VERTICAL { transpose(rows) } else { rows };
    let p3 = u16x8_extend_low_u8x16(a);
    let mut p2 = u16x8_extend_high_u8x16(a);
    let p1 = u16x8_extend_low_u8x16(b);
    let p0 = u16x8_extend_high_u8x16(b);
    let q0 = u16x8_extend_low_u8x16(c);
    let q1 = u16x8_extend_high_u8x16(c);
    let mut q2 = u16x8_extend_low_u8x16(d);
    let q3 = u16x8_extend_high_u8x16(d);
    let diff = |a, b| i16x8_abs(i16x8_sub(a, b));
    let near = i16x8_max(diff(p1, p0), diff(q1, q0));
    let far = i16x8_max(
        i16x8_max(diff(p3, p2), diff(p2, p1)),
        i16x8_max(diff(q2, q1), diff(q3, q2)),
    );
    let boundary = i16x8_add(i16x8_shl(diff(p0, q0), 1), i16x8_shr(diff(p1, q1), 1));
    let mask = v128_and(
        i16x8_le(i16x8_max(near, far), i16x8_splat(interior as i16)),
        i16x8_le(boundary, i16x8_splat((2 * level + interior) as i16)),
    );
    if !v128_any_true(mask) {
        return;
    }
    let high = i16x8_gt(near, i16x8_splat(variance as i16));
    let signed = |a| i16x8_min(i16x8_max(a, i16x8_splat(-128)), i16x8_splat(127));
    let side = signed(i16x8_sub(p1, q1));
    let delta = i16x8_mul(i16x8_sub(q0, p0), i16x8_splat(3));
    let adjustment = v128_and(
        mask,
        signed(i16x8_add(
            delta,
            if outer { side } else { v128_and(high, side) },
        )),
    );
    let mut first = i16x8_shr(
        i16x8_min(i16x8_add(adjustment, i16x8_splat(4)), i16x8_splat(127)),
        3,
    );
    let mut second = i16x8_shr(
        i16x8_min(i16x8_add(adjustment, i16x8_splat(3)), i16x8_splat(127)),
        3,
    );
    let side = if outer {
        let wide = |k| {
            i16x8_shr(
                i16x8_add(i16x8_mul(adjustment, i16x8_splat(k)), i16x8_splat(63)),
                7,
            )
        };
        let d = wide(27);
        first = v128_bitselect(first, d, high);
        second = v128_bitselect(second, d, high);
        let d9 = v128_andnot(wide(9), high);
        p2 = i16x8_add(p2, d9);
        q2 = i16x8_sub(q2, d9);
        v128_andnot(wide(18), high)
    } else {
        v128_andnot(i16x8_shr(i16x8_add(first, i16x8_splat(1)), 1), high)
    };

    let output = [
        u8x16_narrow_i16x8(p3, p2),
        u8x16_narrow_i16x8(i16x8_add(p1, side), i16x8_add(p0, second)),
        u8x16_narrow_i16x8(i16x8_sub(q0, first), i16x8_sub(q1, side)),
        u8x16_narrow_i16x8(q2, q3),
    ];
    let rows = if VERTICAL { transpose(output) } else { output };
    for (i, pair) in rows.into_iter().enumerate() {
        let off = origin + 2 * i * stride;
        if VERTICAL || i != 0 {
            data[off..][..8].copy_from_slice(&u64x2_extract_lane::<0>(pair).to_le_bytes());
        }
        if VERTICAL || i != 3 {
            data[off + stride..][..8].copy_from_slice(&u64x2_extract_lane::<1>(pair).to_le_bytes());
        }
    }
}
