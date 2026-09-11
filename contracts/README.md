# ScopeMatch Intelligent Contract

This directory contains the exact source of the ScopeMatch GenLayer Intelligent
Contract used by ScopeMatch Console at
[`0x887f…3561`](https://explorer-studio.genlayer.com/address/0x887f64fd7B7Fb31851Eb7D78f5629710BaB63561).

- Deployment transaction: [`0xd8bc…c9fc`](https://explorer-studio.genlayer.com/tx/0xd8bc717b5352c013a49b62e27afa280ca178651adb5d9ab606ba0790b221c9fc)
- Contract source: [`scope_match.py`](scope_match.py)
- SHA-256: `2e4d2483531833929c572db11224e6cf2a7537e29f98cffd23cc905f82f79fa5`
- License: [MIT](LICENSE)

The console's `src/lib/scopeMatch.ts` reads and calls the public methods in
this source: `get_program_ids`, `get_program`, `get_scope_ids_for_revision`,
`get_funded_scope`, `get_proposal_revision`, `get_assessment`,
`create_program`, `register_funded_scope`, `open_proposal`,
`revise_proposal`, and `assess_proposal`.

## What happens during an assessment

`assess_proposal` reads the proposal's immutable registry snapshot, then runs
the non-deterministic comparison flow. The contract:

1. Fetches the proposal artifact and each bound public evidence source with
   `gl.nondet.web.get`.
2. Removes markup and protected blocks, applies hard response bounds, and
   fails closed when a source cannot be safely used.
3. Requests a structured deliverable-by-deliverable comparison with
   `gl.nondet.exec_prompt`.
4. Rejects incomplete, duplicate, out-of-snapshot, or internally
   contradictory classifications before a result can be stored.
5. Requires validators to agree on outcome, confidence, complete
   classification map, source snapshot, and source health. Freeform rationale
   remains readable but is not a consensus field.

The contract records the result and its source snapshot on-chain. The frontend
only submits permitted transactions and renders those persisted records; it
does not make an overlap decision itself.
