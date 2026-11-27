# nirium-avalanche

[![tests](https://github.com/nirium-protocol/nirium-avalanche/actions/workflows/tests.yml/badge.svg)](https://github.com/nirium-protocol/nirium-avalanche/actions/workflows/tests.yml)
[![CodeQL](https://github.com/nirium-protocol/nirium-avalanche/actions/workflows/codeql.yml/badge.svg)](https://github.com/nirium-protocol/nirium-avalanche/actions/workflows/codeql.yml)
[![npm](https://img.shields.io/npm/v/nirium-avalanche.svg)](https://www.npmjs.com/package/nirium-avalanche)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Pay and charge with x402 on Avalanche, refuse a payment before it is signed, and keep a receipt
that says what the payment was for.

The chain already shows who paid whom, how much, and when. A Nirium receipt adds what the chain
does not keep: which order a payment was for and who declared it, signed by the payer and bound
to one specific USDC `Transfer` log. Anyone can check it against Avalanche with a public RPC and
nothing else from us. A receipt can also be pointed at from an ERC-8004 validation request.

This is [Nirium](https://nirium.xyz) on Avalanche. Nirium started on Stellar; this repo brings
the same receipt format and the same pre-sign policy contract to Avalanche C-Chain and Fuji.

## Status

| Piece | Fuji | C-Chain mainnet |
|---|---|---|
| Receipt verifier (`avalanche/verify-evm-receipt.mjs`) | yes | yes, one team self-test payment |
| Pre-sign policy (`avalanche/policy/`) | yes, DENY / WAIT / ALLOW runs | yes, one team self-test purchase (ALLOWED, SIGNED) |
| Pay and charge library (`avalanche/sdk/`) | yes | yes, the same purchase, with the published npm package |
| x402 market (`avalanche/market/`) | yes | live on Fly; one team self-test sale so far |
| ERC-8004 validation pointing at a receipt (`avalanche/erc8004-fuji/`) | yes | not planned here |

Every payment listed in [`evidence/`](evidence/README.md) was made by the team to test the flow.
They are labeled `selftest` and are not usage. Nothing here has had an external audit.

## What is here

| Path | What it does |
|---|---|
| [`docs/payment-binding-v1.md`](docs/payment-binding-v1.md) | The receipt format and what a verifier checks |
| [`avalanche/verify-evm-receipt.mjs`](avalanche/verify-evm-receipt.mjs) | Checks a receipt against a USDC `Transfer` log (tx hash + block logIndex), the EIP-3009 `AuthorizationUsed` nonce and the payer's signature |
| [`avalanche/sdk/`](avalanche/sdk/README.md) | The library: `x402Serve` to charge, `createX402Fetch` to pay (with an optional policy), `bindReceipt` and `verifyReceipt` |
| [`avalanche/policy/`](avalanche/policy/README.md) | Pre-sign policy: DENY, WAIT, a timeout and every malformed answer sign nothing |
| [`avalanche/market/`](avalanche/market/README.md) | x402 market: Avalanche network conditions (fees, block fill, block time) for $0.01 per query |
| [`avalanche/fuji-demo/`](avalanche/fuji-demo/README.md) | Reference x402 `exact` payment with PayAI as facilitator, then the receipt |
| [`avalanche/erc8004-fuji/`](avalanche/erc8004-fuji/README.md) | Register an agent and point an ERC-8004 validation request at a receipt (Fuji) |
| [`scripts/`](scripts) | Fuji key setup |
| [`evidence/`](evidence/README.md) | The team's test payments, each with its receipt and explorer link |

## Quick start

```bash
npm install nirium-avalanche
```

One package with the library, the pre-sign policy (`nirium-avalanche/policy`) and the receipt verifier
(`nirium-avalanche/verify`, and `npx nirium-verify-evm receipt.json` on the command line). Its own README is
[`avalanche/README.md`](avalanche/README.md).

Check one of the team's receipts against the chain:

```bash
cd avalanche && npm ci
node verify-evm-receipt.mjs ../evidence/2026-11-26/fuji-a2-binding.json
```

Exit code 0 means valid, 1 means a check failed, 2 means bad input. `--no-sig` skips the
signature check and says so in the output; it is only for testing against third-party
transactions.

Charge for your own API and pay for someone else's (Fuji):

```js
import { x402Serve, createX402Fetch, settlementOf, bindReceipt, createRulesPolicy } from "nirium-avalanche";

app.use(x402Serve({ payTo: "0x...", network: "eip155:43113", routes: { "GET /data": "$0.01" } }));

const pay = createX402Fetch({ signer: account, network: "eip155:43113", maxAmountPerPayment: "10000",
  policy: createRulesPolicy({ maxAmount: "10000" }) });
const res = await pay("https://seller.example/data");
const receipt = await bindReceipt({ tx: settlementOf(res).transaction, network: "eip155:43113", ref: "order-42", signer: account });
```

`x402Serve` runs on your server: Nirium runs nothing in the middle and receives nothing. More in
[`avalanche/sdk/README.md`](avalanche/sdk/README.md).

## Tests

| Suite | Command | Network |
|---|---|---|
| Verifier, 10 cases against a real transaction | `cd avalanche && npm ci && bash run-tests.sh` | public C-Chain RPC |
| Pre-sign policy, 19 tests | `cd avalanche && npm ci && npm run test:policy` | none |
| Library, 9 tests | `cd avalanche && npm ci && npm run test:sdk` | one test reads the public Fuji RPC |
| Market, 3 tests | `cd avalanche && npm ci && cd market && npm ci && npm test` | none |
| ERC-8004 dry run | `cd avalanche/erc8004-fuji && npm ci && node register.mjs --dry-run --from 0x... --uri ipfs://x` | public Fuji RPC, simulation only |

CI runs all of them on every pull request. The verifier fixtures point at a third-party payment
and are labeled as such: they test the verifier, they are not usage of this project.

## Rules this code follows

- Non-custodial: every key belongs to whoever pays or receives. Nirium never holds one.
- Mainnet payments need an explicit opt-in on the client (`NIRIUM_ALLOW_MAINNET=1` or
  `allowMainnet: true`).
- Settlement is done by PayAI, an independent facilitator. Nirium runs no facilitator.
- Receipts are tamper-evident, not tamper-proof: an edited receipt no longer matches its hash or
  its signature. A receipt does not prove that goods or a service were delivered.
- Keys never go in this repo. The key script writes outside it and refuses to run inside it.

## Security

See [SECURITY.md](SECURITY.md). Please report vulnerabilities privately, not in a public issue.

## History

This repo was split out of a combined Solana + Avalanche repo,
[`nirium-multichain`](https://github.com/nirium-protocol/nirium-multichain), on 26 Nov 2026. The
history before that date was kept, so early commits mention both chains. The ERC-8004 records on
Fuji point at files in that original repo (see [`evidence/`](evidence/README.md)). Solana lives in
[`nirium-solana`](https://github.com/nirium-protocol/nirium-solana).

## License

[Apache-2.0](LICENSE)
