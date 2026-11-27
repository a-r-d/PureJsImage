// Chroma samples sit between four luma samples. Keep the vertical quarter
// sums unrounded until horizontal interpolation completes.
#[inline]
fn pixel(y: u8, u: i32, v: i32) -> u32 {
    let luma = (19_077 * i32::from(y)) >> 8;
    let r = (luma + ((26_149 * v) >> 8) - 14_234) >> 6;
    let g = (luma - ((6_419 * u) >> 8) - ((13_320 * v) >> 8) + 8_708) >> 6;
    let b = (luma + ((33_050 * u) >> 8) - 17_685) >> 6;
    u32::from_le_bytes([
        r.clamp(0, 255) as u8,
        g.clamp(0, 255) as u8,
        b.clamp(0, 255) as u8,
        255,
    ])
}

pub(super) fn convert_row(
    y: &[u8],
    u: &[u8],
    u_other: &[u8],
    v: &[u8],
    v_other: &[u8],
    dst: &mut [u32],
) {
    let vertical = |p: &[u8], q: &[u8], i: usize| 3 * i32::from(p[i]) + i32::from(q[i]);
    let mut left_u = vertical(u, u_other, 0);
    let mut left_v = vertical(v, v_other, 0);
    dst[0] = pixel(y[0], (left_u + 2) >> 2, (left_v + 2) >> 2);
    let mut x = 1;
    #[cfg(feature = "simd")]
    while x + 16 <= y.len() && (x >> 1) + 9 <= u.len() {
        let col = x >> 1;
        simd::pixels(
            &y[x..],
            &u[col..],
            &u_other[col..],
            &v[col..],
            &v_other[col..],
            &mut dst[x..],
        );
        x += 16;
    }
    if x > 1 {
        left_u = vertical(u, u_other, x >> 1);
        left_v = vertical(v, v_other, x >> 1);
    }
    for col in (x >> 1) + 1..u.len() {
        let right_u = vertical(u, u_other, col);
        let right_v = vertical(v, v_other, col);
        dst[x] = pixel(
            y[x],
            (3 * left_u + right_u + 8) >> 4,
            (3 * left_v + right_v + 8) >> 4,
        );
        dst[x + 1] = pixel(
            y[x + 1],
            (left_u + 3 * right_u + 8) >> 4,
            (left_v + 3 * right_v + 8) >> 4,
        );
        left_u = right_u;
        left_v = right_v;
        x += 2;
    }
    if x < y.len() {
        dst[x] = pixel(y[x], (left_u + 2) >> 2, (left_v + 2) >> 2);
    }
}

#[cfg(feature = "simd")]
mod simd {
    use core::arch::wasm32::*;

    // Each lane is an unsigned byte held in a u16. Splitting the coefficient
    // preserves floor(k*x/256) using two 16-bit products.
    #[inline(always)]
    fn term(x: v128, k: u16) -> v128 {
        u16x8_add(
            u16x8_mul(x, u16x8_splat(k >> 8)),
            u16x8_shr(u16x8_mul(x, u16x8_splat(k & 255)), 8),
        )
    }

    #[inline(always)]
    fn channels(y: v128, u: v128, v: v128) -> [v128; 3] {
        let l = term(y, 19077);
        let r = i16x8_add(l, i16x8_sub(term(v, 26149), i16x8_splat(14234)));
        let g = i16x8_sub(
            i16x8_sub(i16x8_add(l, i16x8_splat(8708)), term(u, 6419)),
            term(v, 13320),
        );
        // Out-of-range positive blue saturates to 255 in the final narrowing.
        let b = i16x8_add_sat(l, i16x8_sub(term(u, 33050), i16x8_splat(17685)));
        [i16x8_shr(r, 6), i16x8_shr(g, 6), i16x8_shr(b, 6)]
    }
    #[inline(always)]
    fn mix(near: &[u8], far: &[u8]) -> (v128, v128) {
        let vertical = |i| {
            // SAFETY: the caller supplies nine chroma samples, and i is 0 or 1.
            let a = unsafe { i16x8_load_extend_u8x8(near.as_ptr().add(i)) };
            let b = unsafe { i16x8_load_extend_u8x8(far.as_ptr().add(i)) };
            u16x8_add(u16x8_mul(a, u16x8_splat(3)), b)
        };
        let left = vertical(0);
        let right = vertical(1);
        let sum = u16x8_add(u16x8_add(left, right), u16x8_splat(8));
        let a = u16x8_shr(u16x8_add(sum, u16x8_shl(left, 1)), 4);
        let b = u16x8_shr(u16x8_add(sum, u16x8_shl(right, 1)), 4);
        (
            i16x8_shuffle::<0, 8, 1, 9, 2, 10, 3, 11>(a, b),
            i16x8_shuffle::<4, 12, 5, 13, 6, 14, 7, 15>(a, b),
        )
    }
    #[inline(always)]
    pub(super) fn pixels(
        y: &[u8],
        u: &[u8],
        u_other: &[u8],
        v: &[u8],
        v_other: &[u8],
        dst: &mut [u32],
    ) {
        // SAFETY: convert_row consumes sixteen luma/output pixels and nine
        // chroma samples per vector group, inside the validated row extents.
        let luma = unsafe { v128_load(y.as_ptr().cast()) };
        let (u0, u1) = mix(u, u_other);
        let (v0, v1) = mix(v, v_other);
        let a = channels(u16x8_extend_low_u8x16(luma), u0, v0);
        let b = channels(u16x8_extend_high_u8x16(luma), u1, v1);
        let r = u8x16_narrow_i16x8(a[0], b[0]);
        let g = u8x16_narrow_i16x8(a[1], b[1]);
        let blue = u8x16_narrow_i16x8(a[2], b[2]);
        let alpha = u8x16_splat(255);
        let rg0 = i8x16_shuffle::<0, 16, 1, 17, 2, 18, 3, 19, 4, 20, 5, 21, 6, 22, 7, 23>(r, g);
        let rg1 =
            i8x16_shuffle::<8, 24, 9, 25, 10, 26, 11, 27, 12, 28, 13, 29, 14, 30, 15, 31>(r, g);
        let ba0 =
            i8x16_shuffle::<0, 16, 1, 17, 2, 18, 3, 19, 4, 20, 5, 21, 6, 22, 7, 23>(blue, alpha);
        let ba1 = i8x16_shuffle::<8, 24, 9, 25, 10, 26, 11, 27, 12, 28, 13, 29, 14, 30, 15, 31>(
            blue, alpha,
        );
        let p = dst.as_mut_ptr();
        unsafe {
            v128_store(
                p.cast(),
                i16x8_shuffle::<0, 8, 1, 9, 2, 10, 3, 11>(rg0, ba0),
            );
            v128_store(
                p.add(4).cast(),
                i16x8_shuffle::<4, 12, 5, 13, 6, 14, 7, 15>(rg0, ba0),
            );
            v128_store(
                p.add(8).cast(),
                i16x8_shuffle::<0, 8, 1, 9, 2, 10, 3, 11>(rg1, ba1),
            );
            v128_store(
                p.add(12).cast(),
                i16x8_shuffle::<4, 12, 5, 13, 6, 14, 7, 15>(rg1, ba1),
            );
        }
    }
}
