//! Reads the pinned vodozemac version out of `Cargo.lock` and hands it to the
//! crate as a compile-time constant.
//!
//! Why not just write the version in a string literal: because then there would
//! be two places recording it, and the one the client *reports* would be the one
//! nobody rebuilds. A client that says which cryptography it is running is only
//! worth anything if it cannot be wrong, so this fails the build rather than
//! guess. It reads a committed file and emits a constant, so it adds nothing
//! non-deterministic to the build.

use std::fs;

fn main() {
    println!("cargo:rerun-if-changed=Cargo.lock");

    let lock = fs::read_to_string("Cargo.lock").expect("Cargo.lock must be committed beside Cargo.toml");

    // `Cargo.lock` is a sequence of `[[package]]` tables; find the one named
    // vodozemac and take the `version` line that follows it.
    let mut version = None;
    let mut in_vodozemac = false;
    for line in lock.lines() {
        let line = line.trim();
        if line == "[[package]]" {
            in_vodozemac = false;
        } else if line == r#"name = "vodozemac""# {
            in_vodozemac = true;
        } else if in_vodozemac {
            if let Some(v) = line.strip_prefix("version = ") {
                version = Some(v.trim_matches('"').to_string());
                break;
            }
        }
    }

    let version = version.expect("Cargo.lock contains no vodozemac package - the wrapper cannot report a version it cannot read");
    println!("cargo:rustc-env=LPM_VODOZEMAC_VERSION={version}");
}
