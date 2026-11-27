// Tests for nirium-avalanche. The pay/serve loop runs offline against a local fake facilitator
// that checks the payer's EIP-3009 signature before "settling". The receipt test reads one real
// Fuji transaction from the team's own evidence over the public RPC.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import express from "express";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyTypedData } from "viem";
import {
  x402Serve, createX402Fetch, settlementOf, bindReceipt, verifyReceipt, dollarsToAtomic,
  createRulesPolicy, X402PolicyError,
} from "../index.mjs";

const FUJI = "eip155:43113";
const FUJI_USDC = "0x5425890298aed601595a70AB815c96711a31Bc65";
const TWA = [
  { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
];

async function listen(server) { await new Promise((r) => server.listen(0, "127.0.0.1", r)); return `http://127.0.0.1:${server.address().port}`; }

/** Fake facilitator: answers /supported, and on /verify and /settle checks the EIP-3009 signature. */
async function fakeFacilitator() {
  const calls = { verify: 0, settle: 0, bad: 0, last: undefined };
  const server = createServer((req, res) => {
    let body = ""; req.on("data", (c) => { body += c; });
    req.on("end", async () => {
      const send = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      if (req.url.endsWith("/supported")) return send({ kinds: [{ x402Version: 2, scheme: "exact", network: FUJI }], extensions: [], signers: { "eip155:*": [] } });
      const { paymentPayload: p, paymentRequirements: r } = JSON.parse(body);
      const a = p.payload.authorization;
      const ok = await verifyTypedData({
        address: a.from, domain: { name: r.extra.name, version: r.extra.version, chainId: 43113, verifyingContract: r.asset },
        types: { TransferWithAuthorization: TWA }, primaryType: "TransferWithAuthorization",
        message: { ...a, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) },
        signature: p.payload.signature,
      }).catch(() => false);
      if (!ok) calls.bad++;
      calls.last = { authorization: a, requirements: r };
      if (req.url.endsWith("/verify")) { calls.verify++; return send({ isValid: ok, payer: a.from, ...(ok ? {} : { invalidReason: "bad_signature" }) }); }
      calls.settle++;
      return send(ok ? { success: true, transaction: "0x" + "ab".repeat(32), network: FUJI, payer: a.from } : { success: false, errorReason: "bad_signature", transaction: "", network: FUJI });
    });
  });
  return { url: await listen(server), calls, close: () => server.close() };
}

async function seller(facilitatorUrl, payTo) {
  const app = express();
  app.use(x402Serve({ payTo, network: FUJI, facilitatorUrl, routes: { "GET /paid": "$0.01", "/free-ish": { amount: "1" } } }));
  app.get("/paid", (req, res) => res.json({ ok: true }));
  app.get("/health", (req, res) => res.json({ up: true }));
  const server = createServer(app);
  return { url: await listen(server), close: () => server.close() };
}

test("dollarsToAtomic converts exactly and rejects bad prices", () => {
  assert.equal(dollarsToAtomic("$0.01"), "10000");
  assert.equal(dollarsToAtomic("1.5"), "1500000");
  assert.equal(dollarsToAtomic("$0.000001"), "1");
  for (const bad of ["$0", "0.0000001", "abc", "-1"]) assert.throws(() => dollarsToAtomic(bad), bad);
});

test("x402Serve refuses a bad config at mount, not at the first payment", () => {
  assert.throws(() => x402Serve({ payTo: "nope", routes: { "/a": "$1" } }), /payTo/);
  assert.throws(() => x402Serve({ payTo: privateKeyToAccount(generatePrivateKey()).address, routes: {} }), /routes/);
  assert.throws(() => x402Serve({ payTo: privateKeyToAccount(generatePrivateKey()).address, routes: { "/a": "$1" }, network: "eip155:1" }), /unsupported network/);
});

test("createX402Fetch refuses mainnet unless allowMainnet is true", () => {
  const signer = privateKeyToAccount(generatePrivateKey());
  assert.throws(() => createX402Fetch({ signer, network: "eip155:43114", maxAmountPerPayment: "10000" }), /mainnet/);
  assert.ok(createX402Fetch({ signer, network: "eip155:43114", maxAmountPerPayment: "10000", allowMainnet: true }));
});

test("pay and charge end to end: the seller is paid with a signature the facilitator verifies as the payer's", async () => {
  const fac = await fakeFacilitator();
  const payTo = privateKeyToAccount(generatePrivateKey()).address;
  const s = await seller(fac.url, payTo);
  try {
    const unpaid = await fetch(`${s.url}/paid`);
    assert.equal(unpaid.status, 402);
    const signer = privateKeyToAccount(generatePrivateKey());
    const pay = createX402Fetch({ signer, network: FUJI, maxAmountPerPayment: "10000" });
    const res = await pay(`${s.url}/paid`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(fac.calls.verify, 1);
    assert.equal(fac.calls.settle, 1);
    assert.equal(fac.calls.bad, 0);
    const { authorization: a, requirements: r } = fac.calls.last;
    assert.equal(a.from.toLowerCase(), signer.address.toLowerCase());
    assert.equal(a.to.toLowerCase(), payTo.toLowerCase());
    assert.equal(String(a.value), "10000");
    assert.equal(r.asset.toLowerCase(), FUJI_USDC.toLowerCase());
    assert.equal(settlementOf(res).transaction, "0x" + "ab".repeat(32));
  } finally { s.close(); fac.close(); }
});

test("the per-payment cap refuses a price above it before anything is signed", async () => {
  const fac = await fakeFacilitator();
  const s = await seller(fac.url, privateKeyToAccount(generatePrivateKey()).address);
  try {
    const pay = createX402Fetch({ signer: privateKeyToAccount(generatePrivateKey()), network: FUJI, maxAmountPerPayment: "9999" });
    await assert.rejects(pay(`${s.url}/paid`));
    assert.equal(fac.calls.verify + fac.calls.settle, 0);
  } finally { s.close(); fac.close(); }
});

test("with a policy, DENY sends nothing to the seller or the facilitator; ALLOW pays", async () => {
  const fac = await fakeFacilitator();
  const payTo = privateKeyToAccount(generatePrivateKey()).address;
  const s = await seller(fac.url, payTo);
  try {
    const signer = privateKeyToAccount(generatePrivateKey());
    const deny = createX402Fetch({ signer, network: FUJI, maxAmountPerPayment: "10000", policy: createRulesPolicy({ maxAmount: "5000" }) });
    await assert.rejects(deny(`${s.url}/paid`), (e) => e instanceof X402PolicyError && e.outcome === "DENY");
    assert.equal(fac.calls.verify + fac.calls.settle, 0);
    const allow = createX402Fetch({ signer, network: FUJI, maxAmountPerPayment: "10000", policy: createRulesPolicy({ maxAmount: "10000", allowPayTo: [payTo] }) });
    const res = await allow(`${s.url}/paid`);
    assert.equal(res.status, 200);
    assert.equal(fac.calls.settle, 1);
  } finally { s.close(); fac.close(); }
});

test("a facilitator that is down answers 503 with a hint on paid routes only, and the app keeps serving", async () => {
  const s = await seller("http://127.0.0.1:9", privateKeyToAccount(generatePrivateKey()).address);
  try {
    const r = await fetch(`${s.url}/paid`);
    assert.equal(r.status, 503);
    assert.match((await r.json()).hint, /facilitator/);
    assert.equal((await fetch(`${s.url}/health`)).status, 200);
  } finally { s.close(); }
});

test("bindReceipt rebuilds the team's real Fuji receipt from the chain, and refuses a signer that is not the payer", async () => {
  const evidence = JSON.parse(readFileSync(new URL("../../../evidence/2026-11-26/fuji-a2-binding.json", import.meta.url), "utf8"));
  const p = evidence.record.payment;
  const doc = await bindReceipt({ tx: p.tx, network: p.network, ref: evidence.record.purpose.ref, note: evidence.record.purpose.note, resource: p.x402.resource, labels: evidence.record.labels });
  assert.deepEqual(doc.record, evidence.record);
  assert.equal(doc.content_sha256, evidence.content_sha256);
  const v = await verifyReceipt(doc, { requireSignature: false });
  assert.equal(v.ok, true);
  await assert.rejects(bindReceipt({ tx: p.tx, network: p.network, ref: "x", signer: privateKeyToAccount(generatePrivateKey()) }), /expected exactly 1 USDC Transfer|not the payer/);
});
