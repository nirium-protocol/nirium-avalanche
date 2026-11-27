# nirium-avalanche

Nirium on Avalanche C-Chain and Fuji: pay and charge with x402, refuse payments before they are
signed, and prove what a payment was for.

```js
import { x402Serve, createX402Fetch, settlementOf, bindReceipt, verifyReceipt, createRulesPolicy } from "./index.mjs";

// Charge for your own API (runs on your server; Nirium runs nothing and receives nothing)
app.use(x402Serve({ payTo: "0x...", network: "eip155:43113", routes: { "GET /data": "$0.01" } }));

// Pay, with a policy: a payment it refuses is never signed
const pay = createX402Fetch({
  signer: account, network: "eip155:43113", maxAmountPerPayment: "10000",
  policy: createRulesPolicy({ maxAmount: "10000", allowPayTo: ["0x..."] }),
});
const res = await pay("https://seller.example/data");

// Prove what it was for: a payer-signed receipt bound to the exact USDC transfer
const receipt = await bindReceipt({ tx: settlementOf(res).transaction, network: "eip155:43113", ref: "order-42", signer: account });
const { ok } = await verifyReceipt(receipt);
```

| Function | What it does |
|---|---|
| `x402Serve(config)` | Express middleware. Prices in dollars (`"$0.01"`) or atomic units (`{ amount }`), converted to an explicit USDC amount with its EIP-712 domain. PayAI by default (an independent facilitator). Built on the first paid request after a `/supported` preflight: a facilitator that is down answers 503 with a hint on paid routes only; the rest of the app keeps serving. No telemetry. |
| `createX402Fetch(cfg)` | `fetch` that pays x402 `exact` with a per-payment cap. With `policy`, nothing is signed without the policy's ALLOW (see `../policy/`). Mainnet needs `allowMainnet: true`. |
| `settlementOf(res)` | The settlement from the `PAYMENT-RESPONSE` header, or `undefined`. |
| `bindReceipt(o)` | Reads the settled tx (waits for the RPC to have it), finds the USDC `Transfer` from the payer and its EIP-3009 nonce, builds the receipt in canonical order and signs it as the payer. Refuses a signer that is not the payer. |
| `verifyReceipt(doc)` | The chain verifier (`../verify-evm-receipt.mjs`). |

The receipt adds what the chain does not keep: who declared the payment and what it was for. It
does not prove delivery. Format: `../../docs/payment-binding-v1.md`.

## Tests

```bash
npm ci && npm test   # 9 tests
```

The pay/charge loop runs offline against a local fake facilitator that checks the payer's
EIP-3009 signature before "settling": paid end to end, the per-payment cap, a policy DENY that
sends nothing to the seller or the facilitator, and a facilitator outage. The receipt test
rebuilds one of the team's real Fuji receipts from the chain over the public RPC.

`examples/selftest.mjs` runs the whole thing live on Fuji through PayAI (team self-test, test
tokens). See `../../evidence/README.md`.
