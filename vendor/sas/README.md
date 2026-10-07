# Vendored Solana Attestation Service program (test use only)

This binary is used **only** for local tests (LiteSVM) and the optional local
validator (`npm run localnet`). Devnet proofs use the program already deployed
by the Solana Foundation at `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG`.

- Source: https://github.com/solana-foundation/solana-attestation-service
- Commit: `af8fd171672647535fa9dddef8d293bd78161a3f` (program v2.0.0, `main`)
- Built with: `cargo-build-sbf` from Agave v4.2.2
- sha256: `740fdb9c4b1d9b34fb186eb250f7ef613bae653902fba98ac669eecf06990fa6`
- License: MIT (see LICENSE)

Program v2.0.0 is not yet deployed (per the upstream CHANGELOG). Its changes from
the deployed binary are bug fixes and build-profile changes, with no
instruction/account layout changes, so instruction and account encoding tested
here matches devnet. Re-run the proof flow against devnet before relying on it.
