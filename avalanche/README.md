# nirium-avalanche

Pay and charge with x402 on Avalanche, refuse a payment before it is signed, and keep a
payer-signed receipt bound to the exact USDC `Transfer` log.

The chain already shows who paid whom, how much and when. The receipt adds what the chain does
not keep: which order the payment was for and who declared it. Anyone can check it against
Avalanche with a public RPC. Part of [Nirium](https://nirium.xyz). Source, tests and the team's
test payments: [nirium-avalanche](https://github.com/nirium-protocol/nirium-avalanche).

```bash
npm install nirium-avalanche
```

```js
import { x402Serve, createX402Fetch, settlementOf, bindReceipt, verifyReceipt, createRulesPolicy } from "nirium-avalanche";

// Charge for your own API. Runs on your server: Nirium runs nothing in the middle.
app.use(x402Serve({ payTo: "0x...", network: "eip155:43113", routes: { "GET /data": "$0.01" } }));

// Pay, with a policy: a payment it refuses is never signed.
const pay = createX402Fetch({ signer: account, network: "eip155:43113", maxAmountPerPayment: "10000",
  policy: createRulesPolicy({ maxAmount: "10000" }) });
const res = await pay("https://seller.example/data", { headers: { "X-Nirium-Ref": "order-42" } });

// A payer-signed receipt bound to the transfer, and its check against the chain.
const receipt = await bindReceipt({ tx: settlementOf(res).transaction, network: "eip155:43113", ref: "order-42", signer: account });
const { ok } = await verifyReceipt(receipt);
```

`account` is a viem account for the payer's own key. Networks: Avalanche Fuji and C-Chain mainnet (mainnet needs `allowMainnet: true`). `x402Serve` needs `express` (4.22.3+ or 5.3.0+) in your
app. Settlement is done by PayAI, an independent x402 facilitator.

| Import | What it is |
|---|---|
| `nirium-avalanche` | `x402Serve`, `createX402Fetch`, `settlementOf`, `bindReceipt`, `verifyReceipt`, `createRulesPolicy` |
| `nirium-avalanche/policy` | The pre-sign policy gate (decodes what is about to be signed, asks your policy, signs only on a bound ALLOW) |
| `nirium-avalanche/policy/rules` | A small reference policy engine: max amount, approval line, allowlists |
| `nirium-avalanche/receipt` | `bindReceipt` and `verifyReceipt` on their own, without the Express middleware |
| `nirium-avalanche/verify` | The receipt verifier as a library. No Node-only code, so it runs in Node and in the browser |

Check a receipt from the command line:

```bash
npx nirium-verify-evm receipt.json
```

Exit code 0 means valid, 1 means a check failed, 2 means bad input.

Receipts are tamper-evident, not tamper-proof, and they do not prove that goods or a service
were delivered. Non-custodial: every key stays with whoever pays or receives. No external audit
yet. Report security problems privately: [SECURITY.md](https://github.com/nirium-protocol/nirium-avalanche/blob/main/SECURITY.md).

License: Apache-2.0
