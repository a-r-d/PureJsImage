use std::cell::RefCell;

const GROUP_PIXELS: usize = 32;
const MAX_WORKSPACE_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone, Default)]
struct RgbaGroup {
    input: std::ops::Range<usize>,
    last_change: u32,
}

#[derive(Default)]
struct VerticalRow {
    oldest: u32,
    count: usize,
    weights: Vec<f64>,
    bytes: Vec<u8>,
}

// Each transform owns its instance. All host views point at fixed-size Rust
// allocations; no allocation or memory growth occurs while processing rows.
#[derive(Default)]
struct Filter {
    channels: usize,
    filtered: usize,
    output_channels: usize,
    capacity: usize,
    source: Vec<u8>,
    prior: Vec<u8>,
    groups: Vec<RgbaGroup>,
    prior_opaque: bool,
    prior_slot: usize,
    sequence: u32,
    slot_sequence: Vec<u32>,
    phase: usize,
    history: [VerticalRow; 2],
    rgb: Vec<[f64; 3]>,
    offsets: Vec<u32>,
    indices: Vec<u32>,
    weights: Vec<f64>,
    ring: Vec<f32>,
    vertical_indices: Vec<u32>,
    vertical_weights: Vec<f64>,
    spans: Vec<(usize, usize)>,
    sum: Vec<f32>,
    output: Vec<u8>,
}

thread_local! {
    static FILTER: RefCell<Filter> = RefCell::new(Filter::default());
}

#[unsafe(no_mangle)]
pub extern "C" fn abi_version() -> u32 {
    2
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
    let rgba_bytes = if filtered == 4 {
        // Previous input, source footprints and change stamps, two packed outputs,
        // two vertical weight lists and one sequence number per ring slot.
        u64::from(src) * 4
            + u64::from(dst.div_ceil(GROUP_PIXELS as u32)) * 12
            + u64::from(dst) * 8
            + u64::from(capacity) * 20
    } else {
        0
    };
    let bytes = rgba_bytes
        + u64::from(src) * u64::from(channels)
        + u64::from(src) * 24
        + (u64::from(dst) + 1) * 4
        + u64::from(taps) * 12
        + row * (u64::from(capacity) + 1) * 4
        + u64::from(capacity) * 20
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
    let (rgba_src, rgba_dst, rgba_slots) = if filtered == 4 {
        (src, dst, capacity)
    } else {
        (0, 0, 0)
    };
    FILTER.with_borrow_mut(|f| {
        *f = Filter {
            channels,
            filtered,
            output_channels: out,
            capacity,
            source: vec![0; src * channels],
            prior: vec![0; rgba_src * 4],
            groups: vec![RgbaGroup::default(); rgba_dst.div_ceil(GROUP_PIXELS)],
            prior_opaque: false,
            prior_slot: capacity,
            sequence: 0,
            slot_sequence: vec![0; rgba_slots],
            phase: 0,
            history: std::array::from_fn(|_| VerticalRow {
                oldest: 0,
                count: 0,
                weights: vec![0.; rgba_slots],
                bytes: vec![0; rgba_dst * 4],
            }),
            rgb: vec![[0.; 3]; if filtered == 4 { 0 } else { src }],
            offsets: vec![0; dst + 1],
            indices: vec![0; taps],
            weights: vec![0.; taps],
            ring: vec![0.; dst * filtered * capacity],
            vertical_indices: vec![0; capacity],
            vertical_weights: vec![0.; capacity],
            spans: vec![(0, dst * filtered); capacity],
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

// Each group can reuse its previous output only when every source tap is unchanged.
fn configure_rgba_groups(f: &mut Filter) -> Option<()> {
    if f.offsets.windows(2).any(|pair| pair[0] >= pair[1]) {
        return None;
    }
    for (group, footprint) in f.groups.iter_mut().enumerate() {
        let first = f.offsets[group * GROUP_PIXELS] as usize;
        let last = f.offsets[((group + 1) * GROUP_PIXELS).min(f.offsets.len() - 1)] as usize;
        let taps = f.indices.get(first..last)?;
        let min = *taps.iter().min()? as usize;
        let max = *taps.iter().max()? as usize;
        if max >= f.source.len() / 4 {
            return None;
        }
        footprint.input = min * 4..(max + 1) * 4;
        // Both premultiplied RGB and source alpha use this group-local index.
        for index in &mut f.indices[first..last] {
            *index -= min as u32;
        }
    }
    let pixels = f.groups.iter().map(|group| group.input.len() / 4).max()?;
    // Do not geometrically grow the scratch beyond the source-row budget
    // when an idle instance is reconfigured for a different crop.
    f.rgb
        .try_reserve_exact(pixels.saturating_sub(f.rgb.len()))
        .ok()?;
    f.rgb.resize(pixels, [0.; 3]);
    Some(())
}

#[unsafe(no_mangle)]
pub extern "C" fn configure_rgba() -> u32 {
    FILTER.with_borrow_mut(|f| {
        if f.filtered != 4 {
            return 0;
        }
        f.sequence = 0;
        f.prior_slot = f.capacity;
        for row in &mut f.history {
            row.oldest = 0;
        }
        configure_rgba_groups(f).is_some() as u32
    })
}

fn filter_horizontal<const SRC: usize, const DST: usize, const ALPHA: bool>(
    f: &mut Filter,
    slot: usize,
    prior_slot: usize,
) -> Option<()> {
    let stride = f.sum.len();
    let (pixels, _) = f.source.as_chunks::<SRC>();
    let width = f.offsets.len() - 1;
    let group_width = if DST == 4 { GROUP_PIXELS } else { width };
    for start in (0..width).step_by(group_width) {
        let end = (start + group_width).min(width);
        let dest = slot * stride + start * DST;
        if DST == 4 && prior_slot < f.capacity {
            let range = f.groups[start / GROUP_PIXELS].input.clone();
            if f.source[range.clone()] == f.prior[range] {
                let prior = prior_slot * stride + start * DST;
                f.ring.copy_within(prior..prior + (end - start) * DST, dest);
                continue;
            }
        }
        if DST == 4 {
            f.groups[start / GROUP_PIXELS].last_change = f.sequence;
        }
        let (first, last) = if DST == 4 {
            let range = &f.groups[start / GROUP_PIXELS].input;
            (range.start / SRC, range.end / SRC)
        } else {
            (0, pixels.len())
        };
        // Every overlapping horizontal filter reads these premultiplied samples.
        let samples = &pixels[first..last];
        for (rgb, pixel) in f.rgb[..samples.len()].iter_mut().zip(samples) {
            let scale = if ALPHA {
                f64::from(pixel[3]) / 255.
            } else {
                1.
            };
            for c in 0..3 {
                rgb[c] = f64::from(pixel[c]) * scale;
            }
        }
        let row = &mut f.ring[dest..dest + (end - start) * DST];
        for (bounds, output) in f.offsets[start..=end]
            .windows(2)
            .zip(row.chunks_exact_mut(DST))
        {
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
                    alpha += f64::from(samples.get(index)?[3]) * weight;
                }
            }
            for c in 0..3 {
                output[c] = rgb[c] as f32;
            }
            if DST == 4 {
                output[3] = if ALPHA { alpha as f32 } else { 255. };
            }
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
        let prior_slot = f.prior_slot;
        if f.filtered == 4 {
            if f.rgb.is_empty() {
                return 0;
            }
            let Some(next) = f.sequence.checked_add(1) else {
                return 0;
            };
            f.sequence = next;
            f.slot_sequence[slot] = next;
            if prior_slot < f.capacity && f.source == f.prior {
                let stride = f.sum.len();
                f.ring.copy_within(
                    prior_slot * stride..(prior_slot + 1) * stride,
                    slot * stride,
                );
                f.spans[slot] = f.spans[prior_slot];
                f.prior_slot = slot;
                return 1;
            }
        }
        let ok = match (f.channels, f.filtered) {
            (3, 3) => filter_horizontal::<3, 3, false>(f, slot, prior_slot),
            (4, 3) => filter_horizontal::<4, 3, false>(f, slot, prior_slot),
            (4, 4) => {
                let opaque = f.source.chunks_exact(4).all(|p| p[3] == 255);
                let reusable = if opaque == f.prior_opaque {
                    prior_slot
                } else {
                    f.capacity
                };
                f.prior_opaque = opaque;
                if opaque {
                    filter_horizontal::<4, 4, false>(f, slot, reusable)
                } else {
                    filter_horizontal::<4, 4, true>(f, slot, reusable)
                }
            }
            _ => None,
        };
        if ok.is_some() && f.filtered == 4 {
            f.prior_slot = slot;
            f.prior.copy_from_slice(&f.source);
            let stride = f.sum.len();
            let (row, _) = f.ring[slot * stride..(slot + 1) * stride].as_chunks::<4>();
            f.spans[slot] = match row.iter().position(|p| *p != [0.; 4]) {
                None => (0, 0),
                Some(left) => (
                    left * 4,
                    (row.iter().rposition(|p| *p != [0.; 4]).unwrap() + 1) * 4,
                ),
            };
        }
        ok.is_some() as u32
    })
}

#[inline]
fn byte(v: f64) -> u8 {
    // The value immediately below 0.5 rounds to 1 when added to 0.5.
    if v < 0.5 { 0 } else { (v + 0.5) as u8 }
}

// The vertical pass only exports bytes. With bounded samples and weights,
// binary32 can certify most of those bytes. Re-evaluate any channel close
// enough to a rounding boundary to depend on the intermediate precision.
#[cfg(all(target_arch = "wasm32", feature = "simd"))]
fn vertical_rgb_bytes(f: &mut Filter, count: usize) -> bool {
    use core::arch::wasm32::*;
    if count > 32 {
        return false;
    }
    let stride = f.sum.len();
    let mut starts = [0; 32];
    let mut absolute_weight = 0.;
    for (i, start) in starts[..count].iter_mut().enumerate() {
        *start = (f.vertical_indices[i] as usize % f.capacity) * stride;
        absolute_weight += f.vertical_weights[i].abs();
    }
    if !(absolute_weight <= 8.) {
        return false;
    }
    let mut out_of_range = i32x4_splat(0);
    f.sum.fill(0.);
    for (i, &start) in starts[..count].iter().enumerate() {
        let weight = f.vertical_weights[i] as f32;
        let (src, tail) = f.ring[start..start + stride].as_chunks::<4>();
        let (sum, rest) = f.sum.as_chunks_mut::<4>();
        for (dest, source) in sum.iter_mut().zip(src) {
            // SAFETY: each chunk contains exactly four contiguous f32 lanes.
            unsafe {
                let v = v128_load(source.as_ptr().cast());
                out_of_range = v128_or(
                    out_of_range,
                    v128_not(f32x4_le(f32x4_abs(v), f32x4_splat(512.))),
                );
                let old = v128_load(dest.as_ptr().cast());
                v128_store(
                    dest.as_mut_ptr().cast(),
                    f32x4_add(old, f32x4_mul(v, f32x4_splat(weight))),
                );
            }
        }
        for (dest, &v) in rest.iter_mut().zip(tail) {
            if !(v.abs() <= 512.) {
                return false;
            }
            *dest += v * weight;
        }
    }
    if v128_any_true(out_of_range) {
        return false;
    }
    // Each exact partial sum is bounded by 512 * sum(abs(weight)). In
    // either arithmetic path, a term incurs at most count+3 roundings
    // (including weight conversion). For count <= 32 the usual gamma_n
    // bound n*u/(1-n*u) is below 2*n*u. Allow both paths, both precisions,
    // and an absolute unit for subnormals. The factor of four includes slack for rounding the bound.
    let bound =
        ((count + 3) as f64 * 4. * f64::from(f32::EPSILON) * (1. + 512. * absolute_weight)) as f32;
    let exact_byte = |c: usize| {
        let mut exact = 0_f32;
        for (i, &start) in starts[..count].iter().enumerate() {
            exact =
                (f64::from(exact) + f64::from(f.ring[start + c]) * f.vertical_weights[i]) as f32;
        }
        byte(f64::from(exact))
    };
    let (groups, tail) = f.sum.as_chunks::<16>();
    let (output, end) = f.output.as_chunks_mut::<16>();
    for (group, (values, bytes)) in groups.iter().zip(output).enumerate() {
        let mut uncertain = 0;
        let mut rounded_channels = [i32x4_splat(0); 4];
        for (lane, (part, result)) in values
            .as_chunks::<4>()
            .0
            .iter()
            .zip(&mut rounded_channels)
            .enumerate()
        {
            // SAFETY: part contains exactly four f32 values.
            let v = unsafe { v128_load(part.as_ptr().cast()) };
            let nearest = f32x4_nearest(v);
            let distance = f32x4_abs(f32x4_sub(v, nearest));
            uncertain |= u32::from(i32x4_bitmask(f32x4_ge(distance, f32x4_splat(0.5 - bound))))
                << (lane * 4);
            *result = i32x4_trunc_sat_f32x4(nearest);
        }
        let a = i16x8_narrow_i32x4(rounded_channels[0], rounded_channels[1]);
        let b = i16x8_narrow_i32x4(rounded_channels[2], rounded_channels[3]);
        // SAFETY: output has exactly sixteen channels in this group.
        unsafe {
            v128_store(bytes.as_mut_ptr().cast(), u8x16_narrow_i16x8(a, b));
        }
        while uncertain != 0 {
            let lane = uncertain.trailing_zeros() as usize;
            bytes[lane] = exact_byte(group * 16 + lane);
            uncertain &= uncertain - 1;
        }
    }
    for (i, out) in end.iter_mut().enumerate() {
        *out = exact_byte(stride - tail.len() + i);
    }
    true
}

fn render_vertical(f: &mut Filter, count: usize, from: usize, to: usize) {
    let stride = f.sum.len();
    f.sum[from..to].fill(0.);
    let mut left = to;
    let mut right = from;
    let mut opaque_alpha = 0_f32;
    for i in 0..count {
        let weight = f.vertical_weights[i];
        let slot = f.vertical_indices[i] as usize % f.capacity;
        let (start, end) = f.spans[slot];
        let start = start.max(from);
        let end = end.min(to);
        if start >= end {
            continue;
        }
        left = left.min(start);
        right = right.max(end);
        for (sum, &v) in f.sum[start..end]
            .iter_mut()
            .zip(&f.ring[slot * stride + start..slot * stride + end])
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
        return;
    }
    if right == from {
        left = from;
    }
    let start = left / f.filtered * f.output_channels;
    let end = right / f.filtered * f.output_channels;
    f.output[from / f.filtered * f.output_channels..start].fill(0);
    f.output[end..to / f.filtered * f.output_channels].fill(0);
    for (pixel, out) in f.sum[left..right]
        .chunks_exact(f.filtered)
        .zip(f.output[start..end].chunks_exact_mut(f.output_channels))
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
}

// Rational resize ratios often repeat their vertical weights after two rows.
// A cached group is exact if its source footprint has not changed since the
// oldest tap of either output. Recompute consecutive misses together.
fn vertical_rgba(f: &mut Filter, count: usize) {
    let phase = f.phase;
    f.phase ^= 1;
    let oldest = f.vertical_indices[..count]
        .iter()
        .map(|&y| f.slot_sequence[y as usize % f.capacity])
        .min()
        .unwrap_or(0);
    let row = &f.history[phase];
    let limit = if row.count == count && row.weights[..count] == f.vertical_weights[..count] {
        oldest.min(row.oldest)
    } else {
        0
    };
    let stride = f.sum.len();
    if limit == 0 {
        render_vertical(f, count, 0, stride);
    } else {
        let mut start = 0;
        for group in 0..f.groups.len() {
            if f.groups[group].last_change > limit {
                continue;
            }
            let left = group * GROUP_PIXELS * 4;
            if start < left {
                render_vertical(f, count, start, left);
            }
            start = (left + GROUP_PIXELS * 4).min(stride);
            f.output[left..start].copy_from_slice(&f.history[phase].bytes[left..start]);
        }
        if start < stride {
            render_vertical(f, count, start, stride);
        }
    }
    let row = &mut f.history[phase];
    row.bytes.copy_from_slice(&f.output);
    row.weights[..count].copy_from_slice(&f.vertical_weights[..count]);
    row.count = count;
    row.oldest = oldest;
}

#[unsafe(no_mangle)]
pub extern "C" fn vertical(count: usize) -> u32 {
    FILTER.with_borrow_mut(|f| {
        if count == 0 || count > f.capacity {
            return 0;
        }
        #[cfg(all(target_arch = "wasm32", feature = "simd"))]
        if f.channels == 3 && f.output_channels == 3 && vertical_rgb_bytes(f, count) {
            return 1;
        }
        if f.filtered == 4 {
            vertical_rgba(f, count);
        } else {
            render_vertical(f, count, 0, f.sum.len());
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
