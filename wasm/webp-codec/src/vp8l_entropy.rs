// Decode a bounded band of the cache-free VP8L image stream. The caller keeps the
// original bit cursor until the last band so a rejected stream can use the reference.
use super::{
    ERROR_ARGUMENT, STATUS_OK, exclusive_u32, regions_overlap, shared_bytes, shared_u32,
    validate_region, validate_u32_region,
};

struct Bits<'a> {
    bytes: &'a [u8],
    used: usize,
}

impl Bits<'_> {
    #[inline]
    fn peek(&self, count: u32) -> u32 {
        let start = self.used >> 3;
        let value = if let Some(word) = self.bytes.get(start..start + 4) {
            u32::from_le_bytes([word[0], word[1], word[2], word[3]])
        } else {
            let mut word = 0;
            for (i, b) in self
                .bytes
                .get(start..)
                .unwrap_or_default()
                .iter()
                .enumerate()
            {
                word |= u32::from(*b) << (8 * i);
            }
            word
        };
        (value >> (self.used & 7)) & ((1 << count) - 1)
    }

    #[inline]
    fn consume(&mut self, count: u32) -> Result<(), u32> {
        self.used += count as usize;
        if self.used > self.bytes.len() * 8 {
            return Err(ERROR_ARGUMENT);
        }
        Ok(())
    }

    fn symbol(&mut self, tables: &[u32], header: usize) -> Result<u32, u32> {
        let root = *tables.get(header).ok_or(ERROR_ARGUMENT)? as usize;
        let bits = *tables.get(header + 1).ok_or(ERROR_ARGUMENT)?;
        if bits > 8 || root >= tables.len() {
            return Err(ERROR_ARGUMENT);
        }
        let mut entry = *tables
            .get(root + self.peek(bits) as usize)
            .ok_or(ERROR_ARGUMENT)?;
        let mut consumed = 0;
        if entry & 31 == 16 {
            self.consume(bits)?;
            consumed = bits;
            while entry & 31 == 16 && consumed < 15 {
                let index = (entry >> 5) as usize + self.peek(1) as usize;
                self.consume(1)?;
                consumed += 1;
                entry = *tables.get(index).ok_or(ERROR_ARGUMENT)?;
            }
        }
        let length = entry & 31;
        if entry < 32 || length > 15 || length < consumed {
            return Err(ERROR_ARGUMENT);
        }
        self.consume(length - consumed)?;
        Ok((entry >> 5) - 1)
    }

    fn prefix(&mut self, prefix: u32) -> Result<u32, u32> {
        if prefix < 4 {
            return Ok(prefix + 1);
        }
        if prefix > 39 {
            return Err(ERROR_ARGUMENT);
        }
        let extra = (prefix - 2) >> 1;
        let value = ((2 + (prefix & 1)) << extra) + self.peek(extra) + 1;
        self.consume(extra)?;
        Ok(value)
    }
}

// Read-only tables begin with the 120 width-dependent backward distances followed
// by five (root, lookup width) pairs per group. The state, history and output share
// one validated mutable allocation; output is not observable until status is OK.
#[unsafe(no_mangle)]
pub extern "C" fn webp_vp8l_entropy_band(
    input: u32,
    bytes: u32,
    tables: u32,
    table_words: u32,
    meta: u32,
    meta_words: u32,
    state: u32,
    history_words: u32,
    width: u32,
    height: u32,
    first_row: u32,
    rows: u32,
    size_bits: u32,
) -> u32 {
    let result = (|| -> Result<(), u32> {
        if width == 0
            || width > 8192
            || height == 0
            || height > 16384
            || rows == 0
            || first_row.checked_add(rows).is_none_or(|end| end > height)
            || rows * width > 8192
            || bytes > 65544
            || !(130..=32768).contains(&table_words)
            || history_words > 16384
            || !history_words.is_power_of_two()
            || size_bits > 9
        {
            return Err(ERROR_ARGUMENT);
        }
        let meta_width = width.div_ceil(1 << size_bits);
        let meta_first = first_row >> size_bits;
        let meta_rows = ((first_row + rows - 1) >> size_bits) - meta_first + 1;
        if meta_words != 0 && meta_words != meta_rows * meta_width {
            return Err(ERROR_ARGUMENT);
        }
        let input_region = validate_region(input, bytes.max(1), 1)?;
        let table_region = validate_u32_region(tables, table_words)?;
        let meta_region = validate_u32_region(meta, meta_words.max(1))?;
        let state_region = validate_u32_region(state, 3 + history_words + width * rows)?;
        if [input_region, table_region, meta_region]
            .iter()
            .any(|&r| regions_overlap(r, state_region))
        {
            return Err(ERROR_ARGUMENT);
        }
        // SAFETY: all immutable regions are bounded and disjoint from the sole mutable region.
        let (input, tables, groups, state) = unsafe {
            (
                &shared_bytes(input_region)[..bytes as usize],
                shared_u32(table_region),
                shared_u32(meta_region),
                exclusive_u32(state_region),
            )
        };
        let (registers, buf) = state.split_at_mut(3);
        let (history, out) = buf.split_at_mut(history_words as usize);
        let mask = history.len() - 1;
        let mut position = (first_row * width) as usize;
        let total = (width * height) as usize;
        let mut pending = registers[1] as usize;
        let mut distance = registers[2] as usize;
        if registers[0] > 7
            || pending > total - position
            || (pending != 0 && (distance == 0 || distance > history.len() || distance > position))
        {
            return Err(ERROR_ARGUMENT);
        }
        let mut bits = Bits {
            bytes: input,
            used: registers[0] as usize,
        };
        for (dy, row) in out.chunks_exact_mut(width as usize).enumerate() {
            let meta_y = (((dy as u32 + first_row) >> size_bits) - meta_first) * meta_width;
            let mut x = 0;
            while x < row.len() {
                if pending != 0 {
                    let run = pending.min(row.len() - x);
                    for pixel in &mut row[x..x + run] {
                        let color = history[(position - distance) & mask];
                        history[position & mask] = color;
                        *pixel = color;
                        position += 1;
                    }
                    x += run;
                    pending -= run;
                    continue;
                }
                let group = if meta_words == 0 {
                    0
                } else {
                    (groups[meta_y as usize + (x >> size_bits)] >> 8) & 65535
                };
                let header = 120 + group as usize * 10;
                let green = bits.symbol(tables, header)?;
                if green < 256 {
                    let red = bits.symbol(tables, header + 2)?;
                    let blue = bits.symbol(tables, header + 4)?;
                    let alpha = bits.symbol(tables, header + 6)?;
                    if red > 255 || blue > 255 || alpha > 255 {
                        return Err(ERROR_ARGUMENT);
                    }
                    let color = alpha << 24 | red << 16 | green << 8 | blue;
                    row[x] = color;
                    history[position & mask] = color;
                    x += 1;
                    position += 1;
                } else if green < 280 {
                    pending = bits.prefix(green - 256)? as usize;
                    let prefix = bits.symbol(tables, header + 8)?;
                    let code = bits.prefix(prefix)?;
                    distance = if code > 120 {
                        code - 120
                    } else {
                        tables[(code - 1) as usize]
                    } as usize;
                    if distance == 0
                        || distance > position
                        || distance > history.len()
                        || pending > total - position
                    {
                        return Err(ERROR_ARGUMENT);
                    }
                } else {
                    return Err(ERROR_ARGUMENT);
                }
            }
        }
        registers.copy_from_slice(&[bits.used as u32, pending as u32, distance as u32]);
        Ok(())
    })();
    result.map_or_else(|error| error, |_| STATUS_OK)
}
