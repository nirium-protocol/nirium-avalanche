// buy.mjs - buys one query from the market with the SDK (policy on), prints the data, and writes
// the payer-signed receipt. Team self-test with test tokens.
//
//   NIRIUM_EVM_PAYER_KEY=0x.. node buy.mjs --url http://localhost:4022/v1/market --payto 0x.. --ref <ref> [--out receipt.json]

import { writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { createX402Fetch, settlementOf, bindReceipt, verifyReceipt, createRulesPolicy } from "nirium-avalanche";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const url = arg("url", "http://localhost:4022/v1/market");
const ref = arg("ref");
const payTo = arg("payto");
const key = process.env.NIRIUM_EVM_PAYER_KEY;
if (!ref || !payTo || !key) { console.error("need --ref, --payto and NIRIUM_EVM_PAYER_KEY"); process.exit(2); }
const network = "eip155:43113";

const signer = privateKeyToAccount(key);
const pay = createX402Fetch({ signer, network, maxAmountPerPayment: "10000", policy: createRulesPolicy({ maxAmount: "10000", allowPayTo: [payTo], onDecision: (r) => console.log(`policy ${r.outcome}`) }) });
const res = await pay(url);
const s = settlementOf(res);
const data = await res.json();
console.log(`HTTP ${res.status}  tx=${s?.transaction}`);
console.log(`market: block ${data.block}, base fee ${data.fees?.baseFeeNow} wei, fill ${data.congestion?.avgBlockFill}, pressure ${data.feePressure}`);
if (!s) process.exit(1);
const receipt = await bindReceipt({ tx: s.transaction, network, ref, resource: url, note: "Nirium x402 market query (Avalanche network conditions)", labels: ["selftest"], signer });
const v = await verifyReceipt(receipt);
console.log(`receipt ${v.ok ? "VALID" : "INVALID"} (${v.checks.filter((c) => c.ok).length}/${v.checks.length})`);
if (arg("out")) writeFileSync(arg("out"), JSON.stringify(receipt, null, 2) + "\n");
process.exitCode = v.ok ? 0 : 1;
