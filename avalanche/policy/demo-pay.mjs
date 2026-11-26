// demo-pay.mjs - pays an x402 resource on Avalanche only if the rules policy says ALLOW.
//
// Usage:
//   NIRIUM_EVM_PAYER_KEY=0x.. node demo-pay.mjs --url http://localhost:4021/paid \
//     --max 10000 [--approval-above 5000] [--allow-payto 0x..] [--network eip155:43113]
//
// Prints every decision the gate records (ALLOWED, SIGNED or the refusal) and, when paid,
// the settlement tx. On DENY or WAIT nothing is signed and nothing is sent to the seller.
// Mainnet (eip155:43114) needs NIRIUM_ALLOW_MAINNET=1.

import { writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { decodePaymentResponseHeader } from "@x402/fetch";
import { createPolicyX402Fetch } from "./x402-fetch.mjs";
import { createRulesPolicy } from "./rules-policy.mjs";
import { X402PolicyError } from "./evm-policy.mjs";

const USDC = {
  "eip155:43113": "0x5425890298aed601595a70AB815c96711a31Bc65",
  "eip155:43114": "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
};
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const network = opt("--network", "eip155:43113");
const url = opt("--url");
const max = opt("--max");
const key = process.env.NIRIUM_EVM_PAYER_KEY;

if (!url || !max) { console.error("usage: node demo-pay.mjs --url <resource> --max <atomic> [--approval-above n] [--allow-payto 0x..] [--network caip2]"); process.exit(2); }
if (!USDC[network]) { console.error(`unsupported network ${network}`); process.exit(2); }
if (network === "eip155:43114" && process.env.NIRIUM_ALLOW_MAINNET !== "1") { console.error("refusing to pay on mainnet without NIRIUM_ALLOW_MAINNET=1"); process.exit(2); }
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) { console.error("NIRIUM_EVM_PAYER_KEY must be a 0x-prefixed 32-byte hex key"); process.exit(2); }

const signer = privateKeyToAccount(key);
const records = [];
const policy = createRulesPolicy({
  maxAmount: max,
  approvalAbove: opt("--approval-above"),
  allowPayTo: opt("--allow-payto") ? [opt("--allow-payto")] : undefined,
  allowAssets: [USDC[network]],
  onDecision: (r) => {
    records.push(r.outcome);
    const a = r.context?.authorization;
    console.log(`policy ${r.outcome}${a ? `  amount=${a.amount} to=${a.to}` : ""}${r.decision?.reason ? `  reason="${r.decision.reason}"` : ""}`);
  },
});

const pay = createPolicyX402Fetch({ signer, policy, network, asset: USDC[network], maxAmountPerPayment: "1000000" });
console.log(`payer=${signer.address} network=${network} url=${url} policy: max=${max}${opt("--approval-above") ? ` approvalAbove=${opt("--approval-above")}` : ""}`);
try {
  const res = await pay(url);
  const header = res.headers.get("PAYMENT-RESPONSE");
  console.log(`HTTP ${res.status}`);
  if (!header) { console.error("no PAYMENT-RESPONSE header: nothing settled"); process.exit(1); }
  const settle = decodePaymentResponseHeader(header);
  if (!settle.success) { console.error(`settlement failed: ${settle.errorReason}`); process.exit(1); }
  writeFileSync("settle.json", JSON.stringify({ tx: settle.transaction, network, payer: signer.address, resource: url }, null, 2));
  console.log(`tx: ${settle.transaction}`);
  console.log("wrote settle.json");
} catch (e) {
  if (e instanceof X402PolicyError) {
    console.log(`REFUSED by policy: ${e.outcome}. Nothing was signed and nothing was sent to the seller.`);
    process.exit(3);
  }
  throw e;
}
