// One transaction reconstructs the quantized coefficients and neighbor contexts for one
// macroblock. JS publishes the reader state only after the complete transaction succeeds.
use super::{
    ERROR_ARGUMENT, STATUS_OK, exclusive_u32, regions_overlap, shared_bytes, validate_region,
    validate_u32_region,
};

const BANDS: [usize; 16] = [0, 1, 2, 3, 6, 4, 5, 6, 6, 6, 6, 6, 6, 6, 6, 7];
const ZIGZAG: [usize; 16] = [0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15];
const LEFT: [usize; 25] = [
    0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8,
];
const ABOVE: [usize; 25] = [
    0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 4, 5, 4, 5, 6, 7, 6, 7, 8,
];
const EXTRA: [&[u8]; 6] = [
    &[159],
    &[145, 165],
    &[140, 148, 173],
    &[135, 140, 155, 176],
    &[130, 134, 141, 157, 180],
    &[129, 130, 133, 140, 153, 177, 196, 230, 243, 254, 254],
];
const BASE: [i32; 6] = [5, 7, 11, 19, 35, 67];

pub(super) struct Reader<'a> {
    pub(super) data: &'a [u8],
    pub(super) next: usize,
    packed: u32,
    pub(super) bits: i32,
}

impl<'a> Reader<'a> {
    pub(super) fn new(data: &'a [u8], range: u32, value: u32, bits: u32) -> Result<Self, u32> {
        if !(128..=255).contains(&range) || bits > 15 || value >= range << bits {
            return Err(ERROR_ARGUMENT);
        }
        Ok(Self {
            data,
            next: 0,
            packed: (value << (24 - bits)) | range,
            bits: bits as i32,
        })
    }

    pub(super) fn range(&self) -> u32 {
        self.packed & 255
    }

    pub(super) fn value(&self) -> u32 {
        self.packed >> (24 - self.bits)
    }

    #[inline(always)]
    pub(super) fn bit(&mut self, probability: u8) -> u32 {
        // The low byte holds the normalized interval. The left-aligned
        // arithmetic value has at least nine trailing zero bits.
        let range = self.packed & 255;
        let split = 1 + (((range - 1) * u32::from(probability)) >> 8);
        let boundary = split << 24;
        let one = self.packed >= boundary;
        let next = if one {
            self.packed - (boundary | split)
        } else {
            (self.packed & !255) | split
        };
        let shift = (next & 255).leading_zeros() - 24;
        self.packed = next << shift;
        self.bits -= shift as i32;
        if self.bits < 0 {
            // VP8's reference reader pads exhausted partitions with zeroes.
            let hi = self.data.get(self.next).copied().unwrap_or(0);
            let lo = self.data.get(self.next + 1).copied().unwrap_or(0);
            self.bits += 16;
            self.packed |= u32::from(u16::from_be_bytes([hi, lo])) << (24 - self.bits);
            self.next += 2;
        }
        u32::from(one)
    }

    fn magnitude(&mut self, p: &[u8]) -> i32 {
        if self.bit(p[3]) == 0 {
            return if self.bit(p[4]) == 0 {
                2
            } else {
                3 + self.bit(p[5]) as i32
            };
        }
        let cat = if self.bit(p[6]) == 0 {
            self.bit(p[7])
        } else if self.bit(p[8]) == 0 {
            2 + self.bit(p[9])
        } else {
            4 + self.bit(p[10])
        } as usize;
        let mut value = BASE[cat];
        for (i, &p) in EXTRA[cat].iter().enumerate().rev() {
            value += (self.bit(p) << i) as i32;
        }
        value
    }

    fn block(
        &mut self,
        probs: &[u8],
        kind: usize,
        mut context: usize,
        factors: &[u32],
        out: &mut [u32],
    ) -> u32 {
        let mut check_end = true;
        let mut end = 0;
        for i in usize::from(kind == 0)..16 {
            let start = ((kind * 8 + BANDS[i]) * 3 + context) * 11;
            let p = &probs[start..start + 11];
            if check_end && self.bit(p[0]) == 0 {
                break;
            }
            if self.bit(p[1]) == 0 {
                context = 0;
                check_end = false;
                continue;
            }
            let magnitude = if self.bit(p[2]) == 0 {
                1
            } else {
                self.magnitude(p)
            };
            let signed = if self.bit(128) == 1 {
                -magnitude
            } else {
                magnitude
            };
            out[ZIGZAG[i]] = (signed * factors[usize::from(i != 0)] as i32) as u32;
            end = i as u32 + 1;
            context = if magnitude == 1 { 1 } else { 2 };
            check_end = true;
        }
        end
    }
}

// Word offsets: reader (5), quantizers (6), left and above (9 each), residual
// ends (25), and 25 blocks of 16 coefficients. All pointer regions are checked.
#[unsafe(no_mangle)]
pub extern "C" fn webp_vp8_coefficients(
    input: u32,
    available: u32,
    probabilities: u32,
    state: u32,
    block_mode: u32,
) -> u32 {
    let result = (|| -> Result<(), u32> {
        if available > 16_384 || block_mode > 1 {
            return Err(ERROR_ARGUMENT);
        }
        let data = validate_region(input, available.max(1), 1)?;
        let probs = validate_region(probabilities, 4 * 8 * 3 * 11, 1)?;
        let state = validate_u32_region(state, 54 + 400)?;
        if regions_overlap(data, state) || regions_overlap(probs, state) {
            return Err(ERROR_ARGUMENT);
        }
        // SAFETY: the mutable state is disjoint from both validated read-only regions.
        let (input, probs, words) = unsafe {
            (
                &shared_bytes(data)[..available as usize],
                shared_bytes(probs),
                exclusive_u32(state),
            )
        };
        decode(input, probs, words, block_mode)
    })();
    result.map_or_else(|error| error, |_| STATUS_OK)
}

pub(super) fn decode(
    input: &[u8],
    probs: &[u8],
    words: &mut [u32],
    block_mode: u32,
) -> Result<(), u32> {
    let (header, coeffs) = words.split_at_mut(54);
    let (registers, tail) = header.split_at_mut(5);
    let (factors, tail) = tail.split_at_mut(6);
    let (left, tail) = tail.split_at_mut(9);
    let (above, ends) = tail.split_at_mut(9);
    let mut r = Reader::new(input, registers[0], registers[1], registers[2])?;
    if factors.iter().any(|&f| f > 1024) || left.iter().chain(above.iter()).any(|&c| c > 1) {
        return Err(ERROR_ARGUMENT);
    }
    coeffs.fill(0);
    let mut nonzero = false;
    for it in usize::from(block_mode != 0)..25 {
        let i = if it == 0 { 24 } else { it - 1 };
        let (kind, quant) = if i == 24 {
            (1, 2)
        } else if i >= 16 {
            (2, 4)
        } else if block_mode != 0 {
            (3, 0)
        } else {
            (0, 0)
        };
        let context = (left[LEFT[i]] + above[ABOVE[i]]) as usize;
        let end = r.block(
            probs,
            kind,
            context,
            &factors[quant..quant + 2],
            &mut coeffs[i * 16..i * 16 + 16],
        );
        let flag = u32::from(end != 0);
        left[LEFT[i]] = flag;
        above[ABOVE[i]] = flag;
        ends[i] = end;
        nonzero |= end != 0;
    }
    registers.copy_from_slice(&[
        r.range(),
        r.value(),
        r.bits as u32,
        r.next as u32,
        u32::from(nonzero),
    ]);
    Ok(())
}
