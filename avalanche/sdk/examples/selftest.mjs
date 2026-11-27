// selftest.mjs - the whole SDK in one run on Fuji: a seller charging with x402Serve, a buyer paying
// with createX402Fetch under a policy, a payer-signed receipt with bindReceipt, checked with
// verifyReceipt. Team self-test with test tokens; never usage.
//
//   set -a; . ~/.nirium-keys/fuji.env; set +a     # NIRIUM_EVM_PAYER_KEY, NIRIUM_EVM_PAYTO
//   node examples/selftest.mjs --ref selftest-<date>-fuji-sdk-01 [--out receipt.json]

import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import express from "express";
import { privateKeyToAccount } from "viem/accounts";
import { x402Serve, createX402Fetch, settlementOf, bindReceipt, verifyReceipt, createRulesPolicy } from "../index.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const ref = arg("ref");
const key = process.env.NIRIUM_EVM_PAYER_KEY;
const payTo = process.env.NIRIUM_EVM_PAYTO;
if (!ref || !key || !payTo) { console.error("need --ref, NIRIUM_EVM_PAYER_KEY and NIRIUM_EVM_PAYTO"); process.exit(2); }
const network = "eip155:43113";

const app = express();
app.use(x402Serve({ payTo, network, routes: { "GET /data": { price: "$0.01", description: "Nirium SDK selftest resource" } } }));
app.get("/data", (req, res) => res.json({ ok: true, at: new Date().toISOString() }));
const server = createServer(app);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/data`;

try {
  const signer = privateKeyToAccount(key);
  const pay = createX402Fetch({
    signer, network, maxAmountPerPayment: "10000",
    policy: createRulesPolicy({ maxAmount: "10000", allowPayTo: [payTo], onDecision: (r) => console.log(`policy ${r.outcome}`) }),
  });
  const res = await pay(url);
  const s = settlementOf(res);
  console.log(`HTTP ${res.status}  tx=${s?.transaction}`);
  if (!s) throw new Error("nothing settled");
  const receipt = await bindReceipt({ tx: s.transaction, network, ref, resource: url, note: "Nirium SDK selftest: x402Serve + createX402Fetch with policy", labels: ["selftest"], signer });
  const v = await verifyReceipt(receipt);
  console.log(`receipt ${v.ok ? "VALID" : "INVALID"} (${v.checks.filter((c) => c.ok).length}/${v.checks.length} checks)`);
  if (arg("out")) { writeFileSync(arg("out"), JSON.stringify(receipt, null, 2)); console.log(`wrote ${arg("out")}`); }
  process.exitCode = v.ok ? 0 : 1;
} finally {
  server.close();
}
