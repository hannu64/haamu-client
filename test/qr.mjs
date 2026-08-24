// PROTOCOL.md §2.1.2 — the QR symbol, checked where a wrong number can hide.
//
// ⚠️⚠️ WHAT THIS SUITE EXISTS FOR: A BROKEN QR SYMBOL LOOKS EXACTLY LIKE A WORKING ONE.
// Every other artefact in this client fails visibly when it is wrong — a screen is
// blank, a request 401s, a message does not arrive. A symbol with one bad format bit
// is a square of black and white squares that a person cannot fault and a camera
// cannot read, and the person's conclusion will be that their friend's phone is
// broken. So the checks here are on the module matrix, not on the appearance.
//
// ⭐ THE VECTOR AT THE BOTTOM WAS FROZEN AGAINST AN INDEPENDENT ENCODER AND AN
// INDEPENDENT DECODER, NOT AGAINST THIS FILE. `scratchpad/qr-oracle/compare.mjs`
// compares all ten versions and all eight masks module-for-module against
// node-qrcode with the mask forced on both sides, and decodes the rendered pixels
// with jsQR. That comparison cannot live here — this client has no dependencies and
// will not acquire two npm packages to test a drawing — so what lives here is the
// frozen result of having run it, plus the properties that a later edit could break.
//
// ⚠️ AND ONE OF THOSE CHECKS IS A REGRESSION TEST FOR A DEFECT THE DECODER PASSED.
// See `timing patterns survive the format area` below, and D-123.

import { readFileSync } from "node:fs";
import { check, equal, section, done } from "./harness.mjs";
import { encode, limits, sizeOf, QUIET } from "../src/ui/qr.js";

const REAL_PAYLOAD = "https://haamu.app/c#AAAAAAAAAAAAAAAAAAAAAA";

section("§2.1.2 — the version and codeword arithmetic, two ways");

// ⭐ THIS IS A CROSS-CHECK AND NOT A TABLE. `qr.js` computes total codewords from the
// module count, because tabulating forty numbers nothing verifies is exactly D-115's
// shape. The list below is the standard's own published total for each version, which
// is an independent statement of the same fact — so the two routes disagreeing means
// one of them is wrong, and neither is trusted on its own.
const PUBLISHED_TOTALS = [null, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
for (let v = 1; v <= limits.maxVersion; v++) {
  equal(`version ${v}: total codewords, derived from the module count`, limits.totalCodewords(v), PUBLISHED_TOTALS[v]);
}

for (let v = 1; v <= limits.maxVersion; v++) {
  const data = limits.dataCodewords(v);
  check(
    `version ${v}: data codewords leave room for level M's correction`,
    data > 0 && data < limits.totalCodewords(v),
    `${data} of ${limits.totalCodewords(v)}`
  );
}

for (let v = 1; v <= limits.maxVersion; v++) {
  check(
    `version ${v}: capacity is smaller than the data it is carved from`,
    limits.capacityBytes(v) < limits.dataCodewords(v),
    `${limits.capacityBytes(v)} bytes from ${limits.dataCodewords(v)} codewords`
  );
}

check(
  "capacity grows with version, every step",
  Array.from({ length: limits.maxVersion - 1 }, (_, i) => i + 1).every(
    (v) => limits.capacityBytes(v) < limits.capacityBytes(v + 1)
  )
);

section("§2.1.2 — the payload this product actually draws");

equal("the production link is 42 bytes", REAL_PAYLOAD.length, 42);

// ⚠️⚠️ MEASURED, AND THE FIRST WRITTEN ANSWER WAS WRONG. `qr.js` said version 3 holds 53
// bytes; 53 is level **L**. At level M — the level §2.1.2 specifies — it holds 42, and
// the production payload is 42. There is no margin whatsoever, which is a fact worth
// asserting rather than discovering: it means the symbol's size is a property of the
// host name's length, and `haamu.app` happens to be short enough.
equal("version 3 at level M holds exactly 42 bytes", limits.capacityBytes(3), 42);
equal("so the production link reaches version 3", encode(REAL_PAYLOAD).version, 3);
equal("and one more character reaches version 4", encode(REAL_PAYLOAD + "x").version, 4);
equal("version 3 is 29 modules square", encode(REAL_PAYLOAD).size, 29);

// The longest host this product uses in development, so the dev path is not a surprise.
equal("the development host reaches version 4", encode("https://dev.haamu.app/c#" + "A".repeat(22)).version, 4);

check(
  "a payload past version 10 throws instead of truncating",
  (() => {
    try {
      encode("x".repeat(limits.capacityBytes(limits.maxVersion) + 1));
      return false;
    } catch (e) {
      return /does not fit/.test(e.message);
    }
  })()
);

check(
  "a non-string is refused",
  (() => {
    try {
      encode(new Uint8Array(8));
      return false;
    } catch (e) {
      return /expected a string/.test(e.message);
    }
  })()
);

section("§2.1.2 — structure that must hold for every version and every mask");

// ⚠️⚠️ THE REGRESSION TEST FOR D-123, AND IT IS THE REASON THIS SECTION IS NOT ABOUT
// APPEARANCE. The first version of `qr.js` reserved the format-information area with a
// loop over 0..8, which is one module wider than the field: the format bits step AROUND
// the timing patterns at (8,6) and (6,8), so two timing modules were cleared and never
// written back. ➡️ AN INDEPENDENT DECODER RETURNED THE EXACT PAYLOAD ANYWAY — format
// information carries its own BCH code, so the decoder repaired the area and read on.
// Only a module-for-module comparison against an independent ENCODER saw it. Nothing
// that asks "does it scan?" can protect this.
for (let v = 1; v <= limits.maxVersion; v++) {
  for (let mask = 0; mask < 8; mask++) {
    const sym = encode(REAL_PAYLOAD.slice(0, Math.min(REAL_PAYLOAD.length, limits.capacityBytes(v))), {
      forceMask: mask,
    });
    if (sym.version !== v) continue; // that payload does not reach this version
    check(
      `v${v} mask ${mask}: timing patterns survive the format area (D-123)`,
      sym.at(8, 6) && sym.at(6, 8)
    );
  }
}

for (let v = 1; v <= limits.maxVersion; v++) {
  const sym = encode("x".repeat(limits.capacityBytes(v)));
  equal(`v${v}: size is 4×version + 17`, sym.size, sizeOf(v));

  // The three finder patterns, walked outward from each centre. A symbol missing one is
  // not found at all, and this is cheap enough to check on every version.
  //
  // ⚠️ THE PROFILE IS DARK-DARK-LIGHT-DARK, AND THE FIRST VERSION OF THIS CHECK SAID
  // DARK-LIGHT-DARK. It failed on all ten versions while the oracle comparison reported
  // the same matrices as node-qrcode module for module — so the assertion was wrong and
  // the encoder was not. A finder pattern's centre is a 3×3 dark block, not a single
  // module: the neighbour at distance 1 is part of the centre.
  const finders = [
    [3, 3],
    [sym.size - 4, 3],
    [3, sym.size - 4],
  ];
  check(
    `v${v}: three finder patterns, each dark-dark-light-dark from its centre`,
    finders.every(
      ([cx, cy]) => sym.at(cx, cy) && sym.at(cx + 1, cy) && !sym.at(cx + 2, cy) && sym.at(cx + 3, cy)
    )
  );

  // The full timing patterns, not only the two modules D-123 broke.
  let timingOk = true;
  for (let i = 8; i < sym.size - 8; i++) {
    if (sym.at(i, 6) !== (i % 2 === 0)) timingOk = false;
    if (sym.at(6, i) !== (i % 2 === 0)) timingOk = false;
  }
  check(`v${v}: both timing patterns alternate across the whole symbol`, timingOk);

  // The module beside the format information that is dark in every symbol ever made.
  check(`v${v}: the always-dark module is dark`, sym.at(8, sym.size - 8));

  // ⚠️ NON-VACUITY. Every check above would pass on an all-dark grid or a grid where
  // `at` returns nonsense, so the balance is asserted too: rule 4 of the mask penalty
  // drives a real symbol towards half dark, and anything outside a wide band means the
  // data never reached the matrix.
  let dark = 0;
  for (const m of sym.modules) dark += m;
  const share = dark / (sym.size * sym.size);
  check(`v${v}: between a third and two thirds of modules are dark`, share > 0.33 && share < 0.67, `${(share * 100).toFixed(1)}%`);
}

section("§2.1.2 — the mask is chosen, not fixed");

// If the penalty scoring were broken in the direction of always returning the same
// number, `encode` would silently always pick mask 0 and still produce valid symbols.
// Ten payloads that reach different versions should not all land on one mask.
const chosen = new Set();
for (let v = 1; v <= limits.maxVersion; v++) chosen.add(encode("x".repeat(limits.capacityBytes(v))).mask);
check("ten versions do not all choose the same mask", chosen.size >= 3, `${chosen.size} distinct masks`);

check(
  "forcing a mask is honoured",
  Array.from({ length: 8 }, (_, m) => encode(REAL_PAYLOAD, { forceMask: m }).mask === m).every(Boolean)
);

check(
  "the same payload encodes identically twice",
  (() => {
    const a = encode(REAL_PAYLOAD);
    const b = encode(REAL_PAYLOAD);
    return a.mask === b.mask && a.modules.every((m, i) => m === b.modules[i]);
  })()
);

section("§2.1.2 rules 2 and 5 — the two MUST NOTs, checked against the source");

// ⭐ THESE TWO READ THE FILES RATHER THAN CALL THEM, because what they forbid cannot be
// caught by exercising a function: rule 2 forbids code that is never written, and rule
// 5 forbids a colour becoming a token. Both are things a later edit ADDS.
const qrSource = readFileSync(new URL("../src/ui/qr.js", import.meta.url), "utf8");

/**
 * The same file with its comments removed.
 *
 * ⚠️⚠️ THIS EXISTS BECAUSE THE FIRST FORM OF RULE 5'S CHECK SCANNED THE WHOLE FILE AND
 * THEN FAILED ON ITS OWN DOCUMENTATION. Explaining in `qr.js` *why* the symbol must not
 * follow `prefers-color-scheme` put that phrase in `qr.js`, and the scan cannot tell a
 * prohibition from an instance of the thing prohibited. ➡️ A text-scan guard forbidding a
 * word makes the word unsayable in the file it guards — so the guard has to be about
 * CODE, which is what it always meant.
 *
 * ⚠️ Stripping comments with a regular expression is exactly the kind of shortcut that
 * can quietly delete everything and leave a check that passes on nothing, so the result
 * is asserted below before anything is scanned.
 */
const qrCode = qrSource.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

check(
  "⚠️ NON-VACUITY — stripping the comments left the code that the next two checks scan",
  qrCode.includes("ctx.fillStyle") && qrCode.includes("imageSmoothingEnabled") && qrCode.length > qrSource.length * 0.25,
  `${qrCode.length} of ${qrSource.length} bytes are code`
);

// ⚠️⚠️ RULE 5, AND THE PAGE IT PROTECTS AGAINST ALREADY EXISTS. `app.css` has answered
// `prefers-color-scheme: dark` from long before this feature, so a reader whose system
// asks for dark sees a dark page today — and the obvious move during a design pass, to
// replace every literal colour with a token, would invert the symbol for exactly those
// readers. Inverted is outside the standard and works on some scanners and not others, so
// the person sees a QR code and their friend's phone does nothing. The literals ARE the
// requirement, and `scratchpad/browser-qr.mjs` checks the rendered pixels with the dark
// preference emulated.
check("the drawing colours are literal white and black", /#ffffff/.test(qrCode) && /#000000/.test(qrCode));
check(
  "no theme token, computed style or currentColor reaches the symbol",
  !/var\(--|currentColor|getComputedStyle|prefers-color-scheme/.test(qrCode)
);
check("smoothing is turned off before drawing (rule 7)", /imageSmoothingEnabled\s*=\s*false/.test(qrCode));
check(
  "clearing a symbol drops the backing store, not only the pixels (rule 4)",
  /clearRect/.test(qrCode) && /canvas\.width\s*=\s*0/.test(qrCode)
);

// ⚠️⚠️ RULE 2 IS A PROPERTY OF THE WHOLE CLIENT, NOT OF THIS FILE. It says a client MUST
// NOT read QR codes: no camera, no permission prompt, and `Permissions-Policy:
// camera=()` left exactly as ARCHITECTURE §6 has it. The sabotage that would break it
// is one line added anywhere, so the check reads everything that ships.
const shipped = ["../src/ui/qr.js", "../app/app.js", "../app/index.html", "../app/app.css"].map((p) =>
  readFileSync(new URL(p, import.meta.url), "utf8")
);
check(
  "nothing in the client reaches for a camera (rule 2)",
  !shipped.some((src) => /getUserMedia|BarcodeDetector|mediaDevices|"camera"|'camera'/.test(src))
);

section("§2.1.2 — the frozen symbol");

// ⭐ THE AUTHORITY FOR THIS DIGEST IS NOT THIS FILE. It was taken after
// `scratchpad/qr-oracle/compare.mjs` reported 184 checks green: every version 1..10 at
// both boundary lengths and all eight masks, module-for-module against node-qrcode with
// the mask forced on both sides, plus jsQR decoding the rendered pixels back to the
// exact payload. This digest is how that afternoon's result survives into a suite with
// no dependencies. ⚠️ If it fails, do not update it — re-run the oracle.
const FROZEN = {
  payload: REAL_PAYLOAD,
  version: 3,
  size: 29,
  mask: 1,
  digest: "0e8e088a339d21c2fa45d3016f2c38b2",
};

const frozen = encode(FROZEN.payload);
equal("frozen: version", frozen.version, FROZEN.version);
equal("frozen: size", frozen.size, FROZEN.size);
equal("frozen: chosen mask", frozen.mask, FROZEN.mask);

const digest = Buffer.from(await crypto.subtle.digest("SHA-256", frozen.modules)).toString("hex").slice(0, 32);
equal("frozen: the module matrix, SHA-256 (first 128 bits)", digest, FROZEN.digest);

equal("the quiet zone is four modules (rule 5)", QUIET, 4);

done();
