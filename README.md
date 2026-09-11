# ScopeMatch Console

ScopeMatch Console is a wallet-connected StudioNet application for grant and DAO
operators who need an evidence-backed answer to a hard review question: does a
new proposal duplicate, extend, or differ from the work already funded by one
program?

The console reads and writes directly to the live ScopeMatch GenLayer
Intelligent Contract. It does not make its own overlap decision.

## What a reviewer can do

1. Connect an injected browser wallet on StudioNet.
2. Read an on-chain program and its immutable funded-scope registry.
3. As the recorded program owner, add a public-evidence-backed scope.
4. Open or revise a proposal with a structured deliverable list.
5. Trigger a consensus assessment and follow the submitted-to-finalized
   transaction lifecycle.
6. Read the persisted outcome, confidence, criterion-level classifications, and
   fetched-source snapshot.

The deployed contract is
[`0x887f…3561`](https://explorer-studio.genlayer.com/address/0x887f64fd7B7Fb31851Eb7D78f5629710BaB63561).

## Included Intelligent Contract source

The exact deployed ScopeMatch source is included in
[`contracts/scope_match.py`](contracts/scope_match.py), together with its
[deployment and verification notes](contracts/README.md). Its SHA-256 is
`2e4d2483531833929c572db11224e6cf2a7537e29f98cffd23cc905f82f79fa5`.

This source defines every method the console calls and shows the
source-fetching, normalization, structured-output validation, validator
equivalence, and on-chain persistence path behind `assess_proposal`.

## Live verification

ScopeMatch has been exercised through the same path a regular user follows:
an injected wallet opened a public proposal, then requested a consensus
assessment for its frozen revision.

- [Proposal opening](https://explorer-studio.genlayer.com/tx/0x9d17ffa205efe17841167a1dd1e0ab9003f217b43ffc8551645400132332c045)
- [Finalized consensus assessment](https://explorer-studio.genlayer.com/tx/0xd6632ff6af24c2bace295b097fba1dbfbe15e242ff0fa6ea29ddbe3419ee6336)

The assessment compared an Ethereum Improvement Proposal documentation guide
with a registry entry for Ethereum validator-economics education and cadCAD
models. GenLayer persisted `no_material_overlap` with `high` confidence. The
declared deliverable was classified `distinct` with reason
`DIFFERENT_DELIVERABLE`; both bound public sources were fetched successfully
and recorded healthy.

## Run locally

```powershell
npm install
npm run dev
```

The default contract address is the finalized StudioNet ScopeMatch deployment.
To use another compatible deployment, copy `.env.example` to `.env` and set
`VITE_SCOPEMATCH_CONTRACT_ADDRESS`.

The console reads StudioNet through the same-origin `/api/studionet` proxy by
default, with `VITE_SCOPEMATCH_RPC_URL` available for an explicit RPC override.
The proxy permits only the read methods the console needs. Wallet signing and
transaction submission still happen through the visitor's injected wallet; no
wallet credentials are handled by the proxy. If the wallet needs the network
added, it receives the canonical `https://studio.genlayer.com/api` RPC URL.

## Verify

```powershell
npm test
npm run build
npm run preview
```

Only public HTTPS artifacts belong in ScopeMatch records. Do not submit
credentials, private proposal material, or personal data: the contract stores
inputs and consensus results publicly on-chain.
