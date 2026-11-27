# Evidence

Every payment here was made by the team to test the flow. They are labeled `selftest` and are
**not usage**. The mainnet payment used a few cents from the team's own funds. Each receipt can be
checked by anyone with the verifier and a public RPC:

```bash
cd avalanche && npm ci && node verify-evm-receipt.mjs ../evidence/2026-11-26/fuji-a2-binding.json
cd avalanche && npm ci && node verify-evm-receipt.mjs ../evidence/2026-11-26/cchain-mainnet-binding.json
```

## Payments

| Date (UTC) | Network | Transaction | Locator | Amount | Receipt | Verifier |
|---|---|---|---|---|---|---|
| 2026-11-26 14:59 | Avalanche Fuji (`eip155:43113`) | [`0x7ca309a4…29f9`](https://testnet.snowtrace.io/tx/0x7ca309a41b019393d2d9e77ec89aff54a2d644b37657b8f2eaa93331cc6429f9) | logIndex 1 (block 61670610) | 0.01 USDC | `2026-11-26/fuji-a2-binding.json` | VALID, payer-signed |
| 2026-11-26 15:32 | **Avalanche C-Chain mainnet** (`eip155:43114`) | [`0x9b718e42…3f83`](https://snowtrace.io/tx/0x9b718e4249efea418291da2cb4169dcfc344e0b1794d2a2937c7fa08dc4d3f83) | logIndex 12 (block 101457077) | 0.01 USDC | `2026-11-26/cchain-mainnet-binding.json` | VALID, payer-signed |

Both were x402 `exact` payments settled by the PayAI facilitator. The C-Chain one was settled by a
PayAI relayer through Multicall3, so the transaction's `to` is not the USDC contract: the receipt
is bound to the specific `Transfer` log, which is why the locator is a log index. The Fuji receipt
was also checked against altered copies of itself (amount, log index, receiver, nonce, an edited
`purpose`, an altered signature): every altered copy failed for the expected reason.

## Pre-sign policy on Fuji

Three runs of `avalanche/policy/demo-pay.mjs` against the same 0.01 USDC resource, through PayAI
on Fuji. The payer's USDC balance was read on-chain before and after each run.

| Policy | Outcome | Signed | Sent to the seller | Payer balance (atomic USDC) |
|---|---|---|---|---|
| max 5000 | DENY ("amount 10000 above limit 5000") | no | no | 19990000 → 19990000 |
| max 20000, approval above 5000 | WAIT ("needs approval") | no | no | 19990000 → 19990000 |
| max 10000, payTo allowlisted | ALLOWED, SIGNED | yes | yes: [`0x0fd6edd5…1824`](https://testnet.snowtrace.io/tx/0x0fd6edd584258ebff615040f043262d38aeb0deb72886418a54308c541c51824) | 19990000 → 19980000 |

The ALLOW payment has its own payer-signed receipt, `2026-11-26/fuji-policy-allow-binding.json`
(logIndex 1), VALID. A refused payment leaves nothing on-chain by design: there is no
authorization to replay, because none was signed.

## ERC-8004 on Avalanche Fuji

The Fuji receipt above was put through the ERC-8004 validation flow on Fuji:

| Step | Transaction | Result |
|---|---|---|
| `register` (agent card `2026-11-26/fuji-agent-card.json`) | [`0xd91c19b3…1e43`](https://testnet.snowtrace.io/tx/0xd91c19b316e1663d1949b917d92039685ae6b13a93d73bac0927b08aa8b21e43) | agentId 368 |
| `validationRequest` pointing at the receipt | [`0x59de4635…36dc`](https://testnet.snowtrace.io/tx/0x59de463597b207102865f6233dd522257aa7bee116e3609c8c98b728dcb736dc) | requestHash `0xb4a812b5…e3e1` = keccak256 of the receipt file's bytes |
| `validationResponse` by the validator | [`0x7dc27e71…4a58`](https://testnet.snowtrace.io/tx/0x7dc27e71afb3d801b596bcc76ce51c41b3aebdba6cf9ed3ac5a7280e1da44a58) | response 100, tag `nirium-payment-binding-v1`, review `2026-11-26/fuji-a2-validation-review.json` |

The on-chain URIs were written before this repo was split out, so they point at the original
combined repo, `nirium-protocol/nirium-multichain`, pinned to commit `9321ce8`. The files they
point at are the same bytes as the copies in `evidence/2026-11-26/` here; the request and response
hashes bind those exact bytes, so either copy can be checked against the chain. The three
`fuji-a2-*` / `fuji-agent-card` files keep the names used in those URIs for the same reason. The validator is
the payTo key, which is also a team key: this shows the ERC-8004 mechanics, not an independent
third-party validation.

## SDK on Fuji

`avalanche/sdk/examples/selftest.mjs` in one run: a seller charging with `x402Serve`, a buyer
paying with `createX402Fetch` under a rules policy (ALLOWED, SIGNED), PayAI settling, and a
payer-signed receipt from `bindReceipt` checked with `verifyReceipt`.

| Date (UTC) | Network | Transaction | Locator | Amount | Receipt | Verifier |
|---|---|---|---|---|---|---|
| 2026-11-27 | Avalanche Fuji (`eip155:43113`) | [`0x1f92f2fa…0a7f`](https://testnet.snowtrace.io/tx/0x1f92f2fa0cceaaef49d647227c9ad67a63e397c043c8983dec06c6c77ac60a7f) | logIndex 1 | 0.01 USDC | `2026-11-26/fuji-sdk-binding.json` | VALID, payer-signed (18 checks) |

A first run the same night settled `0xb66f1deb…1ea9` but the receipt step read the public RPC
before it had the transaction. `bindReceipt` now waits for the receipt (bounded); the run above is
after that fix. The earlier payment has no receipt here.

## x402 market

One paid query to the Avalanche market (`avalanche/market`) on Fuji, bought with the SDK under a
policy (ALLOWED, SIGNED), settled by PayAI, with a payer-signed receipt.

| Date (UTC) | Network | Transaction | Locator | Amount | Receipt | Verifier |
|---|---|---|---|---|---|---|
| 2026-11-27 | Avalanche Fuji | [`0x2777d92e…3cd7`](https://testnet.snowtrace.io/tx/0x2777d92e4f981d5e9132fb6b48fb47eaf7500d778ba6b912569b2e74e5533cd7) | logIndex 1 | 0.01 USDC | `2026-11-26/fuji-market-binding.json` | VALID, payer-signed (18 checks) |

Team self-test with test tokens. The market is Fuji-only; on mainnet each sale would be income.

## x402 market on Fly (testnet, then mainnet)

The market runs on Fly at [`https://nirium-market-avalanche.fly.dev`](https://nirium-market-avalanche.fly.dev/v1/market/info). First a paid query on
testnet through the public URL, then the config switched to mainnet with a payTo created for the
market only (`0xd488453B43Bc09398548a7EC39337e04669F0F51`) and one purchase made by the team. The mainnet purchase was made from
`0xe3b9cEda…87a7` (team self-test wallet) with the **published npm package** (`nirium-avalanche@0.1.0`), under a policy that only
allowed this payTo and at most 0.01 USDC (ALLOWED, SIGNED). The market's payTo balance read
on-chain went 0 → 0.01 USDC.

| Date (UTC) | Network | Transaction | Locator | Amount | Receipt | Verifier |
|---|---|---|---|---|---|---|
| 2026-11-27 | Avalanche Fuji | [`0xdbdc31…64ce`](https://testnet.snowtrace.io/tx/0xdbdc31cbdb78394739a7f63c087e6c57dc4fad52958b8d692c7ea09173e164ce) | logIndex 1 | 0.01 USDC | `2026-11-27/fuji-market-fly-binding.json` | VALID, payer-signed (18 checks) |
| 2026-11-27 | **Avalanche C-Chain mainnet** | [`0x7b973a…b632`](https://snowtrace.io/tx/0x7b973a140c505e6e28df0dc9bc2c65125645c5d3843172e6423f06941873b632) | logIndex 1 | 0.01 USDC | `2026-11-27/cchain-mainnet-market-binding.json` | VALID, payer-signed (18 checks) |

Both are team self-tests: the mainnet sale was paid with team funds and is **not** a customer
sale or usage. From now on, a sale to this payTo from anyone else is income for Nirium.
