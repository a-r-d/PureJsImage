use std::cell::RefCell;

const MAX_WORKSPACE_BYTES: u64 = 4 * 1024 * 1024;

// Each transform owns its instance. All host views point at fixed-size Rust
// allocations; no allocation or memory growth occurs while processing rows.
#[derive(Default)]
struct Filter {
    channels: usize,
    filtered: usize,
    output_channels: usize,
    capacity: usize,
    source: Vec<u8>,
    rgb: Vec<[f64; 3]>,
    offsets: Vec<u32>,
    indices: Vec<u32>,
    weights: Vec<f64>,
    ring: Vec<f32>,
    vertical_indices: Vec<u32>,
    vertical_weights: Vec<f64>,
    sum: Vec<f32>,
    output: Vec<u8>,
}

thread_local! {
    static FILTER: RefCell<Filter> = RefCell::new(Filter::default());
}

#[unsafe(no_mangle)]
pub extern "C" fn abi_version() -> u32 {
    1
}

#[unsafe(no_mangle)]
pub extern "C" fn simd() -> u32 {
    cfg!(feature = "simd") as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn prepare(
    src: u32,
    dst: u32,
    channels: u32,
    filtered: u32,
    out: u32,
    capacity: u32,
    taps: u32,
) -> u32 {
    if src == 0
        || dst == 0
        || capacity == 0
        || capacity > 256
        || taps < dst
        || !matches!((channels, filtered, out), (3, 3, 3 | 4) | (4, 3 | 4, 4))
    {
        return 0;
    }
    let row = u64::from(dst) * u64::from(filtered);
    // The row cap keeps the complete byte calculation within u64.
    let bytes = u64::from(src) * u64::from(channels)
        + u64::from(src) * 24
        + (u64::from(dst) + 1) * 4
        + u64::from(taps) * 12
        + row * (u64::from(capacity) + 1) * 4
        + u64::from(capacity) * 12
        + u64::from(dst) * u64::from(out);
    if bytes > MAX_WORKSPACE_BYTES {
        return 0;
    }
    let (src, dst, channels, filtered, out, capacity, taps) = (
        src as usize,
        dst as usize,
        channels as usize,
        filtered as usize,
        out as usize,
        capacity as usize,
        taps as usize,
    );
    FILTER.with_borrow_mut(|f| {
        *f = Filter {
            channels,
            filtered,
            output_channels: out,
            capacity,
            source: vec![0; src * channels],
            rgb: vec![[0.; 3]; src],
            offsets: vec![0; dst + 1],
            indices: vec![0; taps],
            weights: vec![0.; taps],
            ring: vec![0.; dst * filtered * capacity],
            vertical_indices: vec![0; capacity],
            vertical_weights: vec![0.; capacity],
            sum: vec![0.; dst * filtered],
            output: vec![0; dst * out],
        }
    });
    1
}

#[unsafe(no_mangle)]
pub extern "C" fn buffer(id: u32) -> usize {
    FILTER.with_borrow_mut(|f| match id {
        0 => f.source.as_mut_ptr() as usize,
        1 => f.offsets.as_mut_ptr() as usize,
        2 => f.indices.as_mut_ptr() as usize,
        3 => f.weights.as_mut_ptr() as usize,
        4 => f.ring.as_mut_ptr() as usize,
        5 => f.vertical_indices.as_mut_ptr() as usize,
        6 => f.vertical_weights.as_mut_ptr() as usize,
        7 => f.output.as_mut_ptr() as usize,
        _ => 0,
    })
}

fn filter_horizontal<const SRC: usize, const DST: usize, const ALPHA: bool>(
    f: &mut Filter,
    slot: usize,
) -> Option<()> {
    let stride = f.sum.len();
    let (pixels, _) = f.source.as_chunks::<SRC>();
    // Every overlapping horizontal filter reads these premultiplied samples.
    for (rgb, pixel) in f.rgb.iter_mut().zip(pixels) {
        let scale = if ALPHA {
            f64::from(pixel[3]) / 255.
        } else {
            1.
        };
        for c in 0..3 {
            rgb[c] = f64::from(pixel[c]) * scale;
        }
    }
    let row = f.ring.get_mut(slot * stride..(slot + 1) * stride)?;
    for (bounds, output) in f.offsets.windows(2).zip(row.chunks_exact_mut(DST)) {
        let range = bounds[0] as usize..bounds[1] as usize;
        let mut rgb = [0.; 3];
        let mut alpha = 0.;
        for (&index, &weight) in f
            .indices
            .get(range.clone())?
            .iter()
            .zip(f.weights.get(range)?)
        {
            let index = index as usize;
            let color = f.rgb.get(index)?;
            for c in 0..3 {
                rgb[c] += color[c] * weight;
            }
            if ALPHA {
                alpha += f64::from(pixels.get(index)?[3]) * weight;
            }
        }
        for c in 0..3 {
            output[c] = rgb[c] as f32;
        }
        if DST == 4 {
            output[3] = if ALPHA { alpha as f32 } else { 255. };
        }
    }
    Some(())
}

#[unsafe(no_mangle)]
pub extern "C" fn horizontal(slot: usize) -> u32 {
    FILTER.with_borrow_mut(|f| {
        if slot >= f.capacity {
            return 0;
        }
        let ok = match (f.channels, f.filtered) {
            (3, 3) => filter_horizontal::<3, 3, false>(f, slot),
            (4, 3) => filter_horizontal::<4, 3, false>(f, slot),
            (4, 4) if f.source.chunks_exact(4).all(|p| p[3] == 255) => {
                filter_horizontal::<4, 4, false>(f, slot)
            }
            (4, 4) => filter_horizontal::<4, 4, true>(f, slot),
            _ => None,
        };
        ok.is_some() as u32
    })
}

#[inline]
fn byte(v: f64) -> u8 {
    // The value immediately below 0.5 rounds to 1 when added to 0.5.
    if v < 0.5 { 0 } else { (v + 0.5) as u8 }
}

#[unsafe(no_mangle)]
pub extern "C" fn vertical(count: usize) -> u32 {
    FILTER.with_borrow_mut(|f| {
        if count == 0 || count > f.capacity {
            return 0;
        }
        let stride = f.sum.len();
        f.sum.fill(0.);
        let mut opaque_alpha = 0_f32;
        for i in 0..count {
            let weight = f.vertical_weights[i];
            let slot = f.vertical_indices[i] as usize % f.capacity;
            for (sum, &v) in f
                .sum
                .iter_mut()
                .zip(&f.ring[slot * stride..(slot + 1) * stride])
            {
                *sum = (f64::from(*sum) + f64::from(v) * weight) as f32;
            }
            opaque_alpha = (f64::from(opaque_alpha) + 255. * weight) as f32;
        }
        // RGB to RGB needs neither unpremultiplication nor an alpha channel.
        if f.channels == 3 && f.output_channels == 3 {
            for (out, &value) in f.output.iter_mut().zip(&f.sum) {
                *out = byte(f64::from(value));
            }
            return 1;
        }
        for (pixel, out) in f
            .sum
            .chunks_exact(f.filtered)
            .zip(f.output.chunks_exact_mut(f.output_channels))
        {
            let alpha = if f.filtered == 4 {
                pixel[3]
            } else if f.channels == 4 {
                opaque_alpha
            } else {
                255.
            };
            let alpha = f64::from(alpha).clamp(0., 255.);
            let scale = if alpha > 0. { 255. / alpha } else { 0. };
            for c in 0..3 {
                out[c] = byte(f64::from(pixel[c]) * scale);
            }
            if out.len() == 4 {
                out[3] = byte(alpha);
            }
        }
        1
    })
}

#[derive(Default)]
struct BoxFilter {
    channels: usize,
    factor: usize,
    source: Vec<u8>,
    sums: [Vec<f64>; 2],
    output: Vec<u8>,
}
thread_local! { static BOX: RefCell<BoxFilter> = RefCell::new(BoxFilter::default()); }

#[unsafe(no_mangle)]
pub extern "C" fn box_prepare(width: u32, channels: u32, factor: u32) -> u32 {
    if width == 0
        || !(3..=4).contains(&channels)
        || !factor.is_power_of_two()
        || width % factor != 0
    {
        return 0;
    }
    let bytes = u64::from(width) * u64::from(channels);
    let stride = bytes / u64::from(factor);
    if bytes + stride * 17 > MAX_WORKSPACE_BYTES {
        return 0;
    }
    BOX.with_borrow_mut(|b| {
        *b = BoxFilter {
            channels: channels as usize,
            factor: factor as usize,
            source: vec![0; bytes as usize],
            sums: [vec![0.; stride as usize], vec![0.; stride as usize]],
            output: vec![0; stride as usize],
        }
    });
    1
}

#[unsafe(no_mangle)]
pub extern "C" fn box_buffer(id: u32) -> usize {
    BOX.with_borrow_mut(|b| match id {
        0 => b.source.as_mut_ptr() as usize,
        1 | 2 => b.sums[(id - 1) as usize].as_mut_ptr() as usize,
        3 => b.output.as_mut_ptr() as usize,
        _ => 0,
    })
}

fn box_add_row<const C: usize>(
    src: &[u8],
    factor: usize,
    previous: &[f64],
    next: &mut [f64],
    first: bool,
) {
    for ((group, prev), dst) in src
        .chunks_exact(C * factor)
        .zip(previous.chunks_exact(C))
        .zip(next.chunks_exact_mut(C))
    {
        let mut sums = [0_f64; 4];
        for pixel in group.chunks_exact(C) {
            let a = if C == 4 { f64::from(pixel[3]) } else { 1. };
            for c in 0..3 {
                sums[c] += f64::from(pixel[c]) * a;
            }
            sums[3] += a;
        }
        for c in 0..C {
            dst[c] = if first { sums[c] } else { prev[c] + sums[c] };
        }
    }
}

// Four RGBA pixels have channel sums below 4 * 255 * 255. Accumulate
// these exact products in integer registers before adding the previous rows.
fn box_rgba_four(source: &[u8], previous: &[f64], next: &mut [f64], first: bool) {
    for ((group, prev), out) in source
        .chunks_exact(16)
        .zip(previous.chunks_exact(4))
        .zip(next.chunks_exact_mut(4))
    {
        let mut sums = [0_u32; 4];
        for pixel in group.chunks_exact(4) {
            let alpha = u32::from(pixel[3]);
            for c in 0..3 {
                sums[c] += u32::from(pixel[c]) * alpha;
            }
            sums[3] += alpha;
        }
        for c in 0..4 {
            out[c] = f64::from(sums[c]) + if first { 0. } else { prev[c] };
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn box_add(previous: usize, first: u32) -> u32 {
    BOX.with_borrow_mut(|b| {
        if previous > 1 || b.factor == 0 {
            return 0;
        }
        let [a, z] = &mut b.sums;
        let (prev, next) = if previous == 0 { (a, z) } else { (z, a) };
        if b.channels == 3 {
            box_add_row::<3>(&b.source, b.factor, prev, next, first != 0);
        } else if b.factor == 4 {
            box_rgba_four(&b.source, prev, next, first != 0);
        } else {
            box_add_row::<4>(&b.source, b.factor, prev, next, first != 0);
        }
        1
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn box_write(slot: usize, rows: u32) -> u32 {
    BOX.with_borrow_mut(|b| {
        if slot > 1 || rows == 0 || b.factor == 0 {
            return 0;
        }
        let area = b.factor as f64 * f64::from(rows);
        for (sum, out) in b.sums[slot]
            .chunks_exact(b.channels)
            .zip(b.output.chunks_exact_mut(b.channels))
        {
            if b.channels == 4 {
                let scale = if sum[3] > 0. { 1. / sum[3] } else { 0. };
                for c in 0..3 {
                    out[c] = byte(sum[c] * scale);
                }
                out[3] = byte(sum[3] / area);
            } else {
                for c in 0..3 {
                    out[c] = byte(sum[c] / area);
                }
            }
        }
        1
    })
}
