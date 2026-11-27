# nirium-avalanche

Nirium receipts for x402 payments on Avalanche.

A Nirium receipt is a signed statement about a payment: which order it paid and who declared it.
The chain already shows payer, receiver, amount and hash. The receipt adds what the chain does not
keep, and this repo ties that statement to one specific USDC transfer so anyone can check it
against Avalanche with a public RPC and nothing else. It can also be pointed at from an ERC-8004
validation request.

Status: work in progress, Fuji first. Nothing here has had an external audit.

## What is here

| Path | What it does |
|---|---|
| `docs/payment-binding-v1.md` | The receipt format |
| `avalanche/verify-evm-receipt.mjs` | Checks a receipt against a USDC `Transfer` log (tx hash + logIndex) and the EIP-3009 `AuthorizationUsed` nonce |
| `avalanche/sdk/` | The library: `x402Serve` to charge, `createX402Fetch` to pay (optional policy), `bindReceipt` and `verifyReceipt` for payer-signed receipts |
| `avalanche/policy/` | Pre-sign policy: a payment your policy refuses is never signed (DENY, WAIT, timeout and every malformed answer sign nothing) |
| `avalanche/fuji-demo/` | x402 `exact` payment on Avalanche with PayAI as facilitator, then writes and signs the receipt |
| `avalanche/erc8004-fuji/` | Points an ERC-8004 validation request at a receipt (Fuji) |
| `scripts/` | Fuji key setup |
| `evidence/` | Payments made by the team to test the flow, with their receipts |

## Check a receipt

```bash
cd avalanche && npm ci && node verify-evm-receipt.mjs <receipt.json>
```

Exit code 0 means valid, 1 means a check failed, 2 means bad input. `--no-sig` skips the signature
check and says so in the output; it is only for testing against third-party transactions.

## Run the tests

```bash
cd avalanche && npm ci && bash run-tests.sh      # 10 cases, Avalanche C-Chain
```

The suite checks a real public transaction over public RPC, so it needs network access. The
fixtures point at a third-party payment and are labeled as such. They test the verifier; they are
not usage of this project.

## Fuji keys

```bash
bash scripts/new-testnet-keys.sh   # payer, payTo/validator and agent-owner keys in ~/.nirium-keys (mode 600)
```

The script prints addresses only and refuses to overwrite keys or to write inside the repo. Fund
the payer with Fuji USDC at faucet.circle.com (it has a captcha, so it is done by hand). Mainnet
keys are never made by a script here.

## Rules this code follows

- Non-custodial: every key belongs to whoever pays or receives. Nirium never holds one.
- Mainnet payments need `NIRIUM_ALLOW_MAINNET=1` on the client. Payments made by the team to test
  the flow are labeled `selftest` and are never counted as usage.
- Receipts are tamper-evident, not tamper-proof: an edited receipt no longer matches its hash or
  its signature.
- Keys never go in this repo. See `.gitignore`.

## History

This repo was split out of a combined Solana + Avalanche repo on 26-nov-2026. The history before
that date was kept, so commits that mention both chains come from that period.

## License

Apache-2.0
