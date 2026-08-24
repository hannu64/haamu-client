// PROTOCOL.md §2.1.2 — §2.1's link drawn as a QR symbol, and nothing else.
//
// ⭐ THIS FILE ENCODES NO SECRET AND DEFINES NO FORMAT. §2.2's spoken code is a
// different secret at a different strength, so offering it has to restart a pairing
// (D-117); a QR symbol is the same 128 bits already on the screen, in a different ink.
// Everything here is presentation, which is why it lives under `ui/` beside `copy.js`
// rather than under `protocol/` — nothing in §3 can be reached from this file.
//
// ⚠️⚠️ THE PROPERTY THIS FILE MUST HAVE IS NOT "LOOKS LIKE A QR CODE". A wrong mask, a
// wrong format bit, one transposed table entry — each yields a symbol a person cannot
// tell from a working one, and a camera simply fails on it. So the numbers below are
// computed where they can be computed, and `test/qr.mjs` measures the matrix against
// an independent encoder and the rendered pixels against an independent decoder.
// Comparing our encoder against itself would prove consistency, not conformance.
//
// The implementation is ISO/IEC 18004: byte mode, error correction level M, smallest
// version that fits, mask chosen by the standard's penalty rules (§2.1.2 rule 6).

/**
 * §2.1.2 rule 5 — the light border the standard requires around the symbol, in
 * modules. Not decoration: without it the finder patterns have no edge and many
 * scanners will not lock on.
 */
export const QUIET = 4;

/**
 * Level M's two-bit field as it appears in the format information. M is `00`.
 *
 * ⚠️ This is NOT the ordinal of the level. The four levels are numbered L=01, M=00,
 * Q=11, H=10 in the standard — deliberately not in strength order — so anybody
 * extending this file must take the value from the standard and not from a list.
 */
const ECC_FORMAT_BITS = 0b00;

/**
 * Level M's block structure per version: `[eccCodewordsPerBlock, numberOfBlocks]`.
 *
 * ⚠️ VERSIONS 1–10 ONLY, AND THAT IS A DECISION RATHER THAN AN OMISSION. §2.1.2's
 * payload is `https://<host>/c#` plus 22 characters of base64url — 42 bytes on
 * `haamu.app`, 46 on the longest development host. Version 10 holds 213, so this
 * table covers a host name four times longer than any this product will have, and
 * `encode` throws rather than silently truncating or quietly dropping to a weaker
 * correction level.
 *
 * ⭐ MEASURED, BECAUSE THIS COMMENT FIRST SAID 53: version 3 at level **M** holds
 * exactly **42** bytes, so the production payload saturates it — 42 of 42, no margin
 * at all. 53 is version 3 at level **L**, which is not the level §2.1.2 specifies. The
 * wrong number was harmless (the version is computed, never assumed) and it is
 * D-115's shape again: a stated capacity nobody had counted. `test/qr.mjs` now asserts
 * the exact figure and the fact that one more character moves to version 4.
 *
 * These twenty numbers are the only ones here that cannot be derived, so they are the
 * only ones a typo can hide in. The test compares all ten versions against an
 * independent encoder for exactly that reason.
 */
const ECC_M = [
  null, // there is no version 0
  [10, 1],
  [16, 1],
  [26, 1],
  [18, 2],
  [24, 2],
  [16, 4],
  [18, 4],
  [22, 4],
  [22, 5],
  [26, 5],
];

const MAX_VERSION = ECC_M.length - 1;

/** The two byte values the standard pads with, alternating, after the terminator. */
const PAD_BYTES = [0xec, 0x11];

/** Byte mode's indicator, and the width of the character count that follows it. */
const MODE_BYTE = 0b0100;
const MODE_BITS = 4;

/**
 * Total codewords in a version, computed from the module count rather than tabulated.
 *
 * ⭐ IT IS COMPUTED BECAUSE THE TABULATED FORM IS D-115's SHAPE: forty numbers nothing
 * checks, in a file where being wrong by one produces a symbol that looks correct.
 * Function modules are subtracted in the order the standard adds them — the three
 * finder patterns with their separators and the timing patterns are the constant 64,
 * the alignment patterns are the quadratic term, and version information (two 18-bit
 * copies, present from version 7) is the 36.
 *
 * ⚠️ The result is in BITS and is not always a multiple of eight: versions 2–6 leave
 * seven remainder bits over, which stay light before masking. `Math.floor` is the
 * standard's behaviour and not a rounding convenience.
 */
function rawDataModuleBits(version) {
  let bits = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    bits -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) bits -= 36;
  }
  return bits;
}

const totalCodewords = (version) => Math.floor(rawDataModuleBits(version) / 8);

/** Codewords left for data once level M's error correction is taken out. */
function dataCodewords(version) {
  const [eccPerBlock, blocks] = ECC_M[version];
  return totalCodewords(version) - eccPerBlock * blocks;
}

/** Byte mode's character count is eight bits up to version 9 and sixteen after it. */
const charCountBits = (version) => (version <= 9 ? 8 : 16);

/** How many payload bytes a version holds at level M, after the header. */
function capacityBytes(version) {
  return Math.floor((dataCodewords(version) * 8 - MODE_BITS - charCountBits(version)) / 8);
}

/** The size of a version's symbol in modules, excluding the quiet zone. */
export const sizeOf = (version) => version * 4 + 17;

/**
 * The smallest version that holds `len` payload bytes at level M.
 *
 * It throws rather than falling back to a bigger table or a lower correction level: a
 * payload this long means the host name changed under a file that was told the payload
 * is a link, and guessing at that is worse than stopping.
 */
function chooseVersion(len) {
  for (let version = 1; version <= MAX_VERSION; version++) {
    if (capacityBytes(version) >= len) return version;
  }
  throw new RangeError(
    `qr: ${len} bytes does not fit version ${MAX_VERSION} at level M (${capacityBytes(MAX_VERSION)} max)`
  );
}

// ----------------------------------------------------------------- GF(256), for RS
//
// Reed–Solomon over GF(2⁸) with the standard's primitive polynomial x⁸+x⁴+x³+x²+1.
// Built once at load: 512 entries of exp so that a product's exponents can be added
// without a modulo, which is the usual way this is written and the reason the table
// is twice as long as the field.

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);

/** The generator polynomial for `degree` error correction codewords. */
function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** The error correction codewords for one block. */
function rsRemainder(data, generator) {
  const degree = generator.length - 1;
  const remainder = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.copyWithin(0, 1);
    remainder[degree - 1] = 0;
    for (let i = 0; i < degree; i++) remainder[i] ^= gfMul(generator[i + 1], factor);
  }
  return remainder;
}

// ------------------------------------------------------------------- the codewords

/**
 * The payload as data codewords for `version`: header, bytes, terminator, padding.
 *
 * The terminator is "up to four zero bits" and not "four zero bits" — a payload that
 * exactly fills the version gets none of it, which is why the loop is bounded by the
 * capacity rather than counted out.
 */
function dataBits(bytes, version) {
  const capacity = dataCodewords(version) * 8;
  const bits = [];
  const push = (value, width) => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };

  push(MODE_BYTE, MODE_BITS);
  push(bytes.length, charCountBits(version));
  for (const byte of bytes) push(byte, 8);

  for (let i = 0; i < 4 && bits.length < capacity; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = new Uint8Array(capacity / 8);
  for (let i = 0; i < bits.length; i++) codewords[i >>> 3] |= bits[i] << (7 - (i & 7));
  for (let i = bits.length / 8, p = 0; i < codewords.length; i++, p++) {
    codewords[i] = PAD_BYTES[p % PAD_BYTES.length];
  }
  return codewords;
}

/**
 * Data and error correction codewords, split into blocks and interleaved.
 *
 * ⚠️ THE BLOCK LENGTHS ARE DERIVED, NOT TABULATED, and the derivation is the
 * standard's own: every block holds the same number of data codewords except that the
 * last few hold one more. So `ECC_M` needs two numbers per version instead of four,
 * and the two that are easiest to transpose are not there to transpose.
 *
 * Interleaving is what makes a scratch across the symbol survivable — it spreads the
 * damage across blocks instead of destroying one block past its correction limit.
 */
function codewords(bytes, version) {
  const [eccPerBlock, numBlocks] = ECC_M[version];
  const total = dataCodewords(version);
  const shortLen = Math.floor(total / numBlocks);
  const numLong = total % numBlocks;

  const all = dataBits(bytes, version);
  const generator = rsGenerator(eccPerBlock);
  const blocks = [];
  let offset = 0;
  for (let b = 0; b < numBlocks; b++) {
    const len = shortLen + (b >= numBlocks - numLong ? 1 : 0);
    const data = all.subarray(offset, offset + len);
    offset += len;
    blocks.push({ data, ecc: rsRemainder(data, generator) });
  }

  const out = [];
  for (let i = 0; i <= shortLen; i++) {
    for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
  }
  for (let i = 0; i < eccPerBlock; i++) {
    for (const block of blocks) out.push(block.ecc[i]);
  }
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------- the module matrix

/**
 * Where a version's alignment patterns are centred.
 *
 * The step is computed the way every conforming encoder computes it, because the
 * standard publishes the coordinates as a table and the table has no closed form that
 * covers version 32 — which is outside this file's range and handled anyway, so that
 * raising `MAX_VERSION` cannot introduce a defect here.
 */
function alignmentPositions(version) {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const size = sizeOf(version);
  const step = version === 32 ? 26 : Math.ceil((size - 13) / (numAlign * 2 - 2)) * 2;
  const positions = [6];
  for (let pos = size - 7; positions.length < numAlign; pos -= step) positions.splice(1, 0, pos);
  return positions.sort((a, b) => a - b);
}

/** A grid of modules plus the map of which ones are function patterns. */
function blankGrid(version) {
  const size = sizeOf(version);
  return {
    size,
    dark: new Uint8Array(size * size),
    fixed: new Uint8Array(size * size),
  };
}

const idx = (grid, x, y) => y * grid.size + x;

function setFunction(grid, x, y, isDark) {
  if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) return;
  grid.dark[idx(grid, x, y)] = isDark ? 1 : 0;
  grid.fixed[idx(grid, x, y)] = 1;
}

/**
 * The patterns a scanner finds the symbol by, before any data is placed.
 *
 * Finder patterns are drawn nine modules wide rather than seven so that the
 * separators come out of the same loop: at Chebyshev distance 4 the modules are the
 * light border, and off-symbol coordinates are dropped by `setFunction`.
 */
function drawFunctionPatterns(grid, version) {
  const { size } = grid;

  for (let i = 0; i < size; i++) {
    setFunction(grid, 6, i, i % 2 === 0);
    setFunction(grid, i, 6, i % 2 === 0);
  }

  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(grid, cx + dx, cy + dy, dist !== 2 && dist !== 4);
      }
    }
  }

  const positions = alignmentPositions(version);
  for (const cy of positions) {
    for (const cx of positions) {
      // The three that would sit on a finder pattern are not drawn.
      const onFinder =
        (cx === 6 && cy === 6) ||
        (cx === 6 && cy === size - 7) ||
        (cx === size - 7 && cy === 6);
      if (onFinder) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFunction(grid, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // ⚠️⚠️ NOTHING RESERVES THE FORMAT-INFORMATION AREA HERE, AND THAT IS THE FIX FOR THE
  // FIRST DEFECT THIS FILE HAD. `drawFormatBits` writes exactly the modules the field
  // occupies and marks them itself, so it is the only thing that may touch them.
  //
  // The version this replaced reserved the area with two loops over `0..8`, which is
  // one module wider than the field: the format information steps AROUND the timing
  // patterns at (8,6) and (6,8), so the loops cleared two timing modules that nothing
  // then wrote back. ➡️ The symbol still scanned. Format information carries its own
  // BCH code, so a decoder repairs the area and reads the payload out — which means
  // every check short of comparing modules against an independent encoder passed,
  // including an independent decoder returning the exact payload. See D-123.

  if (version >= 7) drawVersionBits(grid, version);
}

/** Version information, two copies, BCH(18,6) — present from version 7 only. */
function drawVersionBits(grid, version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const isDark = ((bits >>> i) & 1) === 1;
    const a = grid.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunction(grid, a, b, isDark);
    setFunction(grid, b, a, isDark);
  }
}

/**
 * Format information: the correction level and the mask, BCH(15,5), twice.
 *
 * ⚠️⚠️ THIS IS THE FIELD WHOSE FAILURE IS INVISIBLE. Everything else wrong in a symbol
 * changes what a person sees; these fifteen bits tell the scanner which mask to undo,
 * so getting them wrong yields a symbol that is pixel-for-pixel plausible and decodes
 * to nothing. The final XOR with `0x5412` exists so that a symbol at level M with
 * mask 0 is not all-light in this area, and omitting it is a silent failure of exactly
 * this kind.
 */
function drawFormatBits(grid, mask) {
  const data = (ECC_FORMAT_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i) => ((bits >>> i) & 1) === 1;

  for (let i = 0; i <= 5; i++) setFunction(grid, 8, i, bit(i));
  setFunction(grid, 8, 7, bit(6));
  setFunction(grid, 8, 8, bit(7));
  setFunction(grid, 7, 8, bit(8));
  for (let i = 9; i < 15; i++) setFunction(grid, 14 - i, 8, bit(i));

  for (let i = 0; i < 8; i++) setFunction(grid, grid.size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) setFunction(grid, 8, grid.size - 15 + i, bit(i));
  setFunction(grid, 8, grid.size - 8, true);
}

/**
 * The codewords, placed in the standard's two-module-wide upward-and-downward scan.
 *
 * Column 6 is skipped because the vertical timing pattern occupies it; the scan is
 * over column *pairs*, so skipping it means stepping the pair rather than the column.
 * Modules left over at the end — the remainder bits — stay light and are then masked,
 * which is what the standard requires and not an omission.
 */
function drawCodewords(grid, data) {
  let bit = 0;
  for (let right = grid.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < grid.size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? grid.size - 1 - vert : vert;
        if (!grid.fixed[idx(grid, x, y)] && bit < data.length * 8) {
          grid.dark[idx(grid, x, y)] = (data[bit >>> 3] >>> (7 - (bit & 7))) & 1;
          bit++;
        }
      }
    }
  }
}

/** The eight mask conditions, verbatim from the standard. `true` means invert. */
const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(grid, mask) {
  const condition = MASKS[mask];
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      if (!grid.fixed[idx(grid, x, y)] && condition(x, y)) grid.dark[idx(grid, x, y)] ^= 1;
    }
  }
}

/** The two eleven-module runs a scanner can mistake for a finder pattern. */
const FINDER_LIKE = [
  [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1],
];

/**
 * The standard's four penalty rules. Lower is better; the mask with the lowest total
 * is the one drawn.
 *
 * This is not an aesthetic score. Each rule names something that makes a real scanner
 * fail — long same-colour runs and 2×2 blocks defeat the binariser, the eleven-module
 * pattern impersonates a finder, and an unbalanced symbol drifts under uneven light.
 */
function penalty(grid) {
  const { size } = grid;
  const at = (x, y) => grid.dark[idx(grid, x, y)];
  let score = 0;

  // Rule 1 — runs of five or more.
  for (let i = 0; i < size; i++) {
    for (const rowwise of [true, false]) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        const prev = rowwise ? at(j - 1, i) : at(i, j - 1);
        const cur = rowwise ? at(j, i) : at(i, j);
        if (cur === prev) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }

  // Rule 2 — 2×2 blocks of one colour.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = at(x, y);
      if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) score += 3;
    }
  }

  // Rule 3 — the finder-like pattern, in rows and in columns.
  for (let i = 0; i < size; i++) {
    for (let j = 0; j + 11 <= size; j++) {
      for (const pattern of FINDER_LIKE) {
        let rowMatch = true;
        let colMatch = true;
        for (let k = 0; k < 11; k++) {
          if (at(j + k, i) !== pattern[k]) rowMatch = false;
          if (at(i, j + k) !== pattern[k]) colMatch = false;
        }
        if (rowMatch) score += 40;
        if (colMatch) score += 40;
      }
    }
  }

  // Rule 4 — how far the proportion of dark modules is from half.
  let dark = 0;
  for (const module of grid.dark) dark += module;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/**
 * §2.1.2: a string as a QR symbol. Returns the modules, not pixels and not markup.
 *
 * Keeping this pure is what lets `test/qr.mjs` compare the matrix against an
 * independent encoder in Node, where there is no canvas — and the pixels are checked
 * separately, in a browser, by an independent decoder. Neither test can stand in for
 * the other: the first catches a wrong table, the second catches a symbol that is
 * correct in memory and unreadable on a screen.
 *
 * `forceMask` exists for that first test and for nothing else. Two conforming encoders
 * may score a penalty tie differently and pick different masks, and both symbols are
 * valid — so comparing matrices requires holding the mask still, or the comparison
 * measures the tie-break instead of the encoding.
 */
export function encode(text, { forceMask } = {}) {
  if (typeof text !== "string") throw new TypeError("qr: expected a string");
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length);
  const data = codewords(bytes, version);

  let best = null;
  const masks = forceMask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [forceMask];
  for (const mask of masks) {
    const grid = blankGrid(version);
    drawFunctionPatterns(grid, version);
    // ⚠️ THE ORDER OF THESE THREE IS LOAD-BEARING. Format information goes down before
    // the codewords because writing it is also what marks its modules as function
    // modules — which is what keeps `drawCodewords` from placing data on top of it and
    // `applyMask` from inverting it. Drawing it last, after the mask, is the arrangement
    // that produced D-123.
    drawFormatBits(grid, mask);
    drawCodewords(grid, data);
    applyMask(grid, mask);
    const score = penalty(grid);
    if (best === null || score < best.score) best = { grid, mask, score };
  }

  return {
    version,
    size: best.grid.size,
    mask: best.mask,
    /** 1 for a dark module, row-major, excluding the quiet zone. */
    modules: best.grid.dark,
    at: (x, y) => best.grid.dark[y * best.grid.size + x] === 1,
  };
}

/** What `encode` can hold, exposed so a test can assert the real payload fits. */
export const limits = Object.freeze({
  maxVersion: MAX_VERSION,
  capacityBytes,
  totalCodewords,
  dataCodewords,
});

// --------------------------------------------------------------------- the drawing

/**
 * Draw a symbol into a canvas: dark on light, integer device pixels per module.
 *
 * ⚠️⚠️ THE COLOURS ARE FIXED HERE AND MUST NOT BECOME TOKENS (§2.1.2 rule 5). A symbol
 * that followed the page would come out inverted — outside the standard, and supported
 * by some scanners and not others. The person would see a QR code and their friend's
 * phone would sit there doing nothing. A camera does not read our palette.
 *
 * ⚠️⚠️ AND THIS IS NOT A GUARD AGAINST A PALETTE SOMEBODY MIGHT WRITE LATER. `app.css`
 * has carried `@media (prefers-color-scheme: dark)` all along, so a reader whose system
 * asks for dark is looking at a dark page RIGHT NOW — tokens here would have shipped an
 * inverted symbol to them on day one. The first version of this comment said the dark
 * palette was "the next queued item", which was a premise nobody had checked: the queued
 * item is a design pass over a theme that already exists.
 *
 * ⚠️ AND THE MODULE SIZE IS COMPUTED IN DEVICE PIXELS, NOT CSS PIXELS (rule 7). On a
 * phone at devicePixelRatio 3, a canvas sized in CSS pixels is resampled on the way to
 * the glass and every module edge is a gradient. The symbol still looks like a symbol.
 * So the backing store is an exact multiple of the module count and CSS is told to
 * match it, which leaves the browser nothing to interpolate.
 *
 * Returns the drawn side length in CSS pixels, so a caller can lay out around it.
 */
export function draw(canvas, symbol, { targetCss = 260, dpr = globalThis.devicePixelRatio || 1 } = {}) {
  const modules = symbol.size + 2 * QUIET;
  const scale = Math.max(1, Math.floor((targetCss * dpr) / modules));
  const side = modules * scale;

  canvas.width = side;
  canvas.height = side;
  canvas.style.width = `${side / dpr}px`;
  canvas.style.height = `${side / dpr}px`;

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, side, side);
  ctx.fillStyle = "#000000";
  for (let y = 0; y < symbol.size; y++) {
    for (let x = 0; x < symbol.size; x++) {
      if (symbol.at(x, y)) ctx.fillRect((x + QUIET) * scale, (y + QUIET) * scale, scale, scale);
    }
  }
  return side / dpr;
}

/**
 * Wipe a canvas and shrink its backing store to nothing.
 *
 * §2.1.2 rule 4: the symbol goes when the link it draws goes. ⚠️ `clearRect` alone
 * leaves the pixels' storage allocated and is a wipe by convention only — setting the
 * dimensions is what discards the buffer the secret was drawn into. This product has
 * already shipped the text version of this defect once, where a spent link's text
 * stayed in the DOM underneath a later screen.
 */
export function clear(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;
  canvas.style.width = "";
  canvas.style.height = "";
}
