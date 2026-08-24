// The protocol layer. ARCHITECTURE.md §4: "mirrors PROTOCOL.md section for
// section", and function names should match the section names — a design
// constraint, because the audience for this product includes people who will read
// this directory with the specification open beside them.
//
// | file           | PROTOCOL.md |
// |----------------|-------------|
// | pairing.js     | §2 the link, §3 the handshake, §3.6 the short authentication string |
// | code.js        | §2.2 the voice-readable variant, §2.2b its spelling, §2.2c `L` from it |
// | epoch.js       | §4.1 epochs |
// | mailbox.js     | §4.2 mailbox derivation |
// | signing.js     | §5.2 request signing |
// | envelope.js    | §6.4 wire format, §6.5 padding |
// | passphrase.js  | §7.2 key derivation, §7.4 the phrase |
// | wordlist.js    | §7.4 EFF short list #1, frozen |
// | roster.js      | §7.3 the roster blob's encoding |
// | pow.js         | §9.1 proof-of-work |
//
// Not here yet, and each is a later ROADMAP step rather than an omission:
// §6.1-6.3 the Olm session (the wrapper is client/wasm; step 5 wires it),
// §7.3.1 the merge rules and §7.3.2 freshness (step 7), §5.3-5.5 transport (step 6).

export * as pairing from "./pairing.js";
export * as code from "./code.js";
export * as epoch from "./epoch.js";
export * as mailbox from "./mailbox.js";
export * as signing from "./signing.js";
export * as envelope from "./envelope.js";
export * as passphrase from "./passphrase.js";
export * as roster from "./roster.js";
export * as pow from "./pow.js";
