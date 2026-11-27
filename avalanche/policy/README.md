# Pre-sign policy for x402 on Avalanche

A payment that your policy refuses is never signed.

`@x402/evm` builds the EIP-3009 `TransferWithAuthorization` (amount, destination, token, chain,
nonce) and hands it to the signer. This package wraps that signer: it decodes exactly what is
about to be signed, checks it matches what the seller asked for, asks your policy, and only
signs on an ALLOW that is bound to that exact authorization and still valid. Everything else
ends without a signature, so nothing reaches the seller or the facilitator.

It is the same contract as the Stellar policy hook in the `nirium` package: same verdicts, same
outcomes, same `contextHash`.

## Use

```js
import { privateKeyToAccount } from "viem/accounts";
import { createPolicyX402Fetch } from "nirium-avalanche/policy/x402-fetch";
import { createRulesPolicy } from "nirium-avalanche/policy/rules";

const pay = createPolicyX402Fetch({
  signer: privateKeyToAccount(process.env.NIRIUM_EVM_PAYER_KEY),
  policy: createRulesPolicy({ maxAmount: "10000", allowPayTo: ["0x..."] }),
  network: "eip155:43113",
  asset: "0x5425890298aed601595a70AB815c96711a31Bc65", // Fuji USDC
  maxAmountPerPayment: "10000",
});
const res = await pay("https://seller.example/paid"); // throws X402PolicyError on a refusal
```

`createRulesPolicy` is a small reference engine (max amount, approval line, allowed payTo and
tokens). Any engine works if it implements `evaluate(context) -> { decision, contextHash, ... }`.

## What the policy sees

`context.authorization` is decoded from the typed data itself, not from what the seller said:
`amount`, `to`, `from`, `verifyingContract` (token), `chainId`, `domainName`, `domainVersion`,
`validAfter`, `validBefore`, `nonce`, and `payloadHash` (the EIP-712 digest). `context.contextHash`
is sha256 of `{v: 1, url, method, payloadHash}`; an ALLOW must return it unchanged.

## Verdicts and outcomes

| Engine answer | Outcome | Signed? |
|---|---|---|
| ALLOW with this `contextHash`, not expired, current `policyVersion` | `ALLOWED` then `SIGNED` | yes |
| DENY | `DENY` | no |
| WAIT (a person has to approve) | `WAIT` | no |
| ALLOW with another or no `contextHash` | `UNBOUND` | no |
| ALLOW past `expiresAt`, or without it when `requireExpiry` | `EXPIRED` | no |
| ALLOW under an older `policyVersion` | `STALE` | no |
| no answer in time (5 s, never more than half the payment window) | `TIMEOUT` | no |
| engine throws, unknown verdict, malformed fields | `ENGINE_ERROR` / `MALFORMED` | no |
| typed data that is not EIP-3009, or differs from the requirements | `CONTEXT_MISMATCH` (engine not asked) | no |
| signer address changed, clock not a finite number | `SIGNER_CHANGED` / `CLOCK_INVALID` | no |

`onDecision` is an observer for receipts: it sees every outcome and cannot change any of them.

## Tests

```bash
cd .. && npm ci && npm run test:policy   # 19 tests, no network: typed data comes from the real @x402/evm 2.32.0
```

The last test runs `@x402/fetch` end to end against a local seller: on DENY the seller never
receives a payment; on ALLOW it receives one whose signature verifies as the payer's.

## Live run (Fuji)

`demo-pay.mjs` pays the `../fuji-demo` server through this gate. See `../../evidence/README.md`
for a DENY, a WAIT and an ALLOW against PayAI on Fuji, with the payer's balance before and after.

## Limits

- Only EIP-3009 `exact` is gated. Permit2 and EIP-2612 typed data are refused, not evaluated.
- Not a security boundary against code in the same process: whoever holds the base signer can
  call it directly.
