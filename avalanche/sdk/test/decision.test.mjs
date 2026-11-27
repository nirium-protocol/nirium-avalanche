// Decision receipts from REAL policy decisions: the same offline pay loop as sdk.test.mjs (a fake
// facilitator that checks the payer's EIP-3009 signature), so the receipts are built from exactly
// what the policy hands to onDecision.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  x402Serve, createX402Fetch, createRulesPolicy, X402PolicyError,
  bindDecision, verifyDecision, decisionRecord, collectDecisions, DECISION_VERSION,
} from "../index.mjs";

const FUJI = "eip155:43113";
const FUJI_USDC = "0x5425890298aed601595a70AB815c96711a31Bc65";
let payer, other, payTo, fac, shop;

async function listen(s) { await new Promise((r) => s.listen(0, "127.0.0.1", r)); return `http://127.0.0.1:${s.address().port}`; }

before(async () => {
  payer = privateKeyToAccount(generatePrivateKey());
  other = privateKeyToAccount(generatePrivateKey());
  payTo = privateKeyToAccount(generatePrivateKey()).address;
  const facServer = createServer((req, res) => {
    let body = ""; req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const send = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      if (req.url.endsWith("/supported")) return send({ kinds: [{ x402Version: 2, scheme: "exact", network: FUJI }], extensions: [], signers: { "eip155:*": [] } });
      const { paymentPayload: p } = JSON.parse(body);
      const from = p.payload.authorization.from;
      if (req.url.endsWith("/verify")) return send({ isValid: true, payer: from });
      return send({ success: true, transaction: "0x" + "ab".repeat(32), network: FUJI, payer: from });
    });
  });
  fac = { server: facServer, url: await listen(facServer) };
  const app = express();
  app.use(x402Serve({ payTo, network: FUJI, facilitatorUrl: fac.url, routes: { "GET /paid": "$0.01" } }));
  app.get("/paid", (req, res) => res.json({ ok: true }));
  const shopServer = createServer(app);
  shop = { server: shopServer, url: await listen(shopServer) };
});
after(() => { fac.server.close(); shop.server.close(); });

async function attempt(rules) {
  const col = collectDecisions();
  const pay = createX402Fetch({ signer: payer, network: FUJI, maxAmountPerPayment: "10000", policy: createRulesPolicy({ ...rules, onDecision: col.onDecision }) });
  let error;
  try { await pay(`${shop.url}/paid`); } catch (e) { error = e; }
  return { records: col.records, error };
}

test("a DENY that never reached the chain gets a payer-signed receipt saying what it would have paid and why", async () => {
  const { records, error } = await attempt({ maxAmount: "5000" });
  assert.ok(error instanceof X402PolicyError && error.outcome === "DENY");
  assert.deepEqual(records.map((r) => r.outcome), ["DENY"]);
  const { doc, record } = await bindDecision(records[0], { signer: payer, ref: "order-deny", labels: ["test"] });
  assert.equal(doc.version, DECISION_VERSION);
  assert.equal(doc.network, FUJI);
  assert.deepEqual(record.decision, { outcome: "DENY", policyVersion: "rules-v1", reason: "amount 10000 above limit 5000" });
  assert.equal(record.intent.amount, "10000");
  assert.equal(record.intent.asset, FUJI_USDC);
  assert.equal(record.intent.decimals, 6);
  assert.equal(record.intent.from, payer.address);
  assert.equal(record.intent.to, payTo);
  assert.match(record.intent.nonce, /^0x[0-9a-f]{64}$/);
  assert.equal(record.intent.resource, `${shop.url}/paid`);
  assert.match(record.intent.payloadHash, /^[0-9a-f]{64}$/);
  const v = await verifyDecision(doc);
  assert.equal(v.ok, true, JSON.stringify(v.checks.filter((c) => !c.ok)));
});

test("WAIT, and an ALLOW followed by SIGNED, each get their own receipt", async () => {
  const w = await attempt({ maxAmount: "20000", approvalAbove: "5000" });
  assert.deepEqual(w.records.map((r) => r.outcome), ["WAIT"]);
  const wait = await bindDecision(w.records[0], { signer: payer, ref: "order-wait" });
  assert.equal(wait.record.decision.outcome, "WAIT");
  assert.equal((await verifyDecision(wait.doc)).ok, true);

  const a = await attempt({ maxAmount: "10000", allowPayTo: [payTo] });
  assert.equal(a.error, undefined);
  assert.deepEqual(a.records.map((r) => r.outcome), ["ALLOWED", "SIGNED"]);
  for (const r of a.records) {
    const { doc } = await bindDecision(r, { signer: payer, ref: "order-allow" });
    assert.equal((await verifyDecision(doc)).ok, true);
  }
});

test("hash-only receipts keep the content private and still verify; the held record must match", async () => {
  const { records } = await attempt({ maxAmount: "5000" });
  const { doc, record } = await bindDecision(records[0], { signer: payer, ref: "order-private", hashOnly: true });
  assert.equal(doc.record, undefined);
  assert.equal((await verifyDecision(doc)).ok, true);
  assert.equal((await verifyDecision(doc, { record })).ok, true);
  const changed = { ...record, decision: { ...record.decision, outcome: "ALLOWED" } };
  assert.equal((await verifyDecision(doc, { record: changed })).ok, false);
});

test("an edited decision, an altered signature or a key that is not the payer fail", async () => {
  const { records } = await attempt({ maxAmount: "5000" });
  const { doc } = await bindDecision(records[0], { signer: payer, ref: "order-tamper" });
  const flipped = structuredClone(doc); flipped.record.decision.outcome = "ALLOWED";
  const v1 = await verifyDecision(flipped);
  assert.equal(v1.ok, false);
  assert.ok(v1.checks.some((c) => c.name.startsWith("content_sha256") && !c.ok));
  const badSig = structuredClone(doc); badSig.agent.signature = badSig.agent.signature.slice(0, -2) + (badSig.agent.signature.endsWith("1b") ? "1c" : "1b");
  assert.equal((await verifyDecision(badSig)).ok, false);
  await assert.rejects(bindDecision(records[0], { signer: other, ref: "x" }), /is not the payer/);
});

test("a refusal before any payment was decoded has nothing to describe", () => {
  assert.equal(decisionRecord({ outcome: "CONTEXT_MISMATCH", error: "not EIP-3009" }), null);
});
