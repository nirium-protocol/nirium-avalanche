// make-binding.mjs - builds a "nirium-payment-binding-v1" JSON from a settled x402 tx.
// Thin CLI over bindReceipt() in ../sdk (the logic lives there, once).
//
// Usage:
//   node make-binding.mjs --ref <purpose.ref> [--settle settle.json | --tx 0x.. --network eip155:43113]
//                         [--resource <url>] [--note <text>] [--payer 0x..] [--payto 0x..]
//                         [--no-sign] [--out binding.json]
//
// Env (only when signing):
//   NIRIUM_EVM_PAYER_KEY  payer private key. Never printed or written. Its address must equal
//                         the Transfer.from found on chain, or nothing is written.
import { readFileSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { bindReceipt } from "../sdk/receipt.mjs";

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; };
const die = (msg, code = 2) => { console.error(msg); process.exit(code); };

const settle = arg("settle") ? JSON.parse(readFileSync(arg("settle"), "utf8")) : {};
const tx = arg("tx", settle.tx);
const network = arg("network", settle.network || "eip155:43113");
const ref = arg("ref");
if (!tx || !/^0x[0-9a-fA-F]{64}$/.test(tx)) die("need --tx 0x<64 hex> or --settle settle.json");
if (!ref) die("need --ref <purpose.ref>, e.g. selftest-2026-11-26-fuji-01");

let signer;
if (!process.argv.includes("--no-sign")) {
  const key = process.env.NIRIUM_EVM_PAYER_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) die("NIRIUM_EVM_PAYER_KEY required to sign (or pass --no-sign)");
  signer = privateKeyToAccount(key);
}

let doc;
try {
  doc = await bindReceipt({
    tx, network, ref, signer,
    resource: arg("resource", settle.resource || "unknown"),
    note: arg("note", "Nirium selftest payment, our own keys"),
    labels: ["selftest"],
    payer: arg("payer", settle.payer), payTo: arg("payto"),
  });
} catch (e) { die(e.message, 1); }

const out = arg("out", "binding.json");
writeFileSync(out, JSON.stringify(doc, null, 2));
const p = doc.record.payment;
console.log(`wrote ${out}  tx=${p.tx}  logIndex=${p.locator.index}  amount=${p.amount}  from=${p.from}  to=${p.to}  nonce=${p.x402.nonce}  content_sha256=${doc.content_sha256}  signed=${!!doc.agent}`);
