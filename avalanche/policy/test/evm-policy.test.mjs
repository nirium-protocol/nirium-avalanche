// Tests for the EVM pre-sign gate. No RPC, no network, nothing broadcast.
// Typed data comes from the real @x402/evm 2.32.0 ExactEvmScheme, so the gate is tested
// against exactly what the package asks a signer to sign.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyTypedData } from "viem";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import {
  encodePaymentRequiredHeader, decodePaymentSignatureHeader, encodePaymentResponseHeader,
} from "@x402/core/http";
import {
  createPolicyGatedSigner, describeAuthorization, computeContextHash, effectiveTimeoutMs,
  X402PolicyError,
} from "../evm-policy.mjs";
import { createPolicyX402Fetch } from "../x402-fetch.mjs";
import { createRulesPolicy } from "../rules-policy.mjs";

const FUJI = "eip155:43113";
const FUJI_USDC = "0x5425890298aed601595a70AB815c96711a31Bc65";
const PAY_TO = privateKeyToAccount(generatePrivateKey()).address;
const URL_ = "https://policy.test/paid";

const requirements = (over = {}) => ({
  scheme: "exact", network: FUJI, asset: FUJI_USDC, payTo: PAY_TO, amount: "10000",
  maxTimeoutSeconds: 120, extra: { name: "USD Coin", version: "2" }, ...over,
});

/** A base signer that records whether it was ever asked to sign. */
function spySigner() {
  const account = privateKeyToAccount(generatePrivateKey());
  const spy = { calls: 0, address: account.address };
  spy.signTypedData = async (td) => { spy.calls++; return account.signTypedData(td); };
  return spy;
}

/** Runs the real ExactEvmScheme through a gate; resolves to { error, records, base }. */
async function pay(policy, { req = requirements(), base = spySigner(), method = "GET" } = {}) {
  const records = [];
  // Returns the observer's own result, so the gate sees (and swallows) an async rejection.
  const p = { ...policy, onDecision: (r) => { records.push(r.outcome); return policy.onDecision?.(r); } };
  let refused;
  const gated = createPolicyGatedSigner(base, p, () => ({ url: URL_, method, requirements: req }), (e) => { refused = e; });
  try {
    const result = await new ExactEvmScheme(gated).createPaymentPayload(2, { ...req });
    return { result, records, base };
  } catch (e) {
    return { error: refused ?? e, records, base };
  }
}

const allowBound = (over = {}) => ({ async evaluate(ctx) { return { decision: "ALLOW", contextHash: ctx.contextHash, ...over }; } });

test("ALLOW bound to the context signs exactly once, and the signature is the payer's", async () => {
  const { result, records, base, error } = await pay(allowBound());
  assert.equal(error, undefined);
  assert.equal(base.calls, 1);
  assert.deepEqual(records, ["ALLOWED", "SIGNED"]);
  const auth = result.payload.authorization;
  assert.equal(auth.to.toLowerCase(), PAY_TO.toLowerCase());
  assert.equal(String(auth.value), "10000");
});

for (const [name, decision, outcome] of [
  ["DENY", { decision: "DENY", reason: "no" }, "DENY"],
  ["WAIT", { decision: "WAIT", reason: "needs a person" }, "WAIT"],
  ["unknown verdict", { decision: "MAYBE" }, "MALFORMED"],
  ["ALLOW with a wrong contextHash", { decision: "ALLOW", contextHash: "00".repeat(32) }, "UNBOUND"],
  ["ALLOW without contextHash", { decision: "ALLOW" }, "UNBOUND"],
]) {
  test(`${name} signs nothing (${outcome})`, async () => {
    const { error, base } = await pay({ async evaluate() { return decision; } });
    assert.ok(error instanceof X402PolicyError, String(error));
    assert.equal(error.outcome, outcome);
    assert.equal(base.calls, 0);
  });
}

test("no decision object, engine throw and timeout sign nothing", async () => {
  for (const [policy, outcome] of [
    [{ async evaluate() { return null; } }, "MALFORMED"],
    [{ async evaluate() { throw new Error("engine down"); } }, "ENGINE_ERROR"],
    [{ timeoutMs: 20, evaluate: () => new Promise(() => {}) }, "TIMEOUT"],
  ]) {
    const { error, base } = await pay(policy);
    assert.equal(error.outcome, outcome);
    assert.equal(base.calls, 0);
  }
});

test("expiry: expired ALLOW, malformed expiresAt and requireExpiry sign nothing", async () => {
  const fixed = 1_000_000;
  for (const [policy, outcome] of [
    [{ now: () => fixed, async evaluate(c) { return { decision: "ALLOW", contextHash: c.contextHash, expiresAt: fixed }; } }, "EXPIRED"],
    [{ async evaluate(c) { return { decision: "ALLOW", contextHash: c.contextHash, expiresAt: "soon" }; } }, "MALFORMED"],
    [{ requireExpiry: true, async evaluate(c) { return { decision: "ALLOW", contextHash: c.contextHash }; } }, "EXPIRED"],
  ]) {
    const { error, base } = await pay(policy);
    assert.equal(error.outcome, outcome);
    assert.equal(base.calls, 0);
  }
});

test("policy version: stale, unavailable and missing sign nothing; current signs", async () => {
  const allowV = (v) => async (c) => ({ decision: "ALLOW", contextHash: c.contextHash, policyVersion: v });
  for (const [policy, outcome] of [
    [{ evaluate: allowV("v1"), currentVersion: async () => "v2" }, "STALE"],
    [{ evaluate: allowV("v1"), currentVersion: async () => { throw new Error("db down"); } }, "VERSION_UNAVAILABLE"],
    [{ evaluate: allowV("v1"), currentVersion: async () => "" }, "VERSION_UNAVAILABLE"],
    [{ evaluate: allowV(undefined), currentVersion: async () => "v1" }, "MALFORMED"],
  ]) {
    const { error, base } = await pay(policy);
    assert.equal(error.outcome, outcome);
    assert.equal(base.calls, 0);
  }
  const ok = await pay({ evaluate: allowV("v1"), currentVersion: async () => "v1" });
  assert.equal(ok.error, undefined);
  assert.equal(ok.base.calls, 1);
});

test("a clock that is not a finite number signs nothing", async () => {
  for (const now of [() => NaN, () => "now", () => { throw new Error("no clock"); }]) {
    const { error, base } = await pay({ now, async evaluate(c) { return { decision: "ALLOW", contextHash: c.contextHash }; } });
    assert.equal(error.outcome, "CLOCK_INVALID");
    assert.equal(base.calls, 0);
  }
});

test("a signer that changes address during evaluation signs nothing", async () => {
  const base = spySigner();
  const other = privateKeyToAccount(generatePrivateKey()).address;
  const { error } = await pay({ async evaluate(c) { base.address = other; return { decision: "ALLOW", contextHash: c.contextHash }; } }, { base });
  assert.equal(error.outcome, "SIGNER_CHANGED");
  assert.equal(base.calls, 0);
});

test("an observer that throws or rejects cannot block or change the payment", async () => {
  const policy = { ...allowBound(), onDecision() { throw new Error("observer bug"); } };
  const a = await pay(policy);
  assert.equal(a.error, undefined);
  const b = await pay({ ...allowBound(), onDecision: async () => { throw new Error("async observer bug"); } });
  assert.equal(b.error, undefined);
});

test("mutating the engine's ALLOW after returning it changes nothing", async () => {
  let ref;
  const { error, base } = await pay({ async evaluate(c) { ref = { decision: "ALLOW", contextHash: c.contextHash }; setTimeout(() => { ref.decision = "DENY"; }, 0); return ref; } });
  assert.equal(error, undefined);
  assert.equal(base.calls, 1);
});

test("context integrity: the engine is never asked about a payment that differs from the requirements", async () => {
  let asked = 0;
  const policy = { async evaluate(c) { asked++; return { decision: "ALLOW", contextHash: c.contextHash }; } };
  const cases = [
    ["wrong chain", { network: "eip155:43114" }],
    ["wrong token", { asset: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E" }],
    ["wrong domain name", { extra: { name: "Fake Coin", version: "2" } }],
    ["no domain in extra", { extra: {} }],
  ];
  for (const [name, over] of cases) {
    // The scheme signs what `req` says; the gate is told the requirements differ.
    const base = spySigner();
    const told = requirements(over);
    let refused;
    const gated = createPolicyGatedSigner(base, policy, () => ({ url: URL_, method: "GET", requirements: told }), (e) => { refused = e; });
    await assert.rejects(new ExactEvmScheme(gated).createPaymentPayload(2, requirements()), name);
    assert.equal(refused?.outcome, "CONTEXT_MISMATCH", name);
    assert.equal(base.calls, 0, name);
  }
  assert.equal(asked, 0);
});

test("describeAuthorization rejects other typed data (Permit, extra types, wrong payTo, amount or from)", async () => {
  const signer = spySigner();
  let typed;
  const capture = { address: signer.address, signTypedData: async (td) => { typed = td; return signer.signTypedData(td); } };
  await new ExactEvmScheme(capture).createPaymentPayload(2, requirements());
  const req = requirements();
  assert.equal(describeAuthorization(typed, req, signer.address).amount, "10000");
  const bad = (f) => { const t = structuredClone({ ...typed, message: { ...typed.message } }); f(t); return t; };
  for (const [name, td] of [
    ["Permit primaryType", bad((t) => { t.primaryType = "Permit"; })],
    ["extra type", bad((t) => { t.types = { ...t.types, Extra: [{ name: "x", type: "uint256" }] }; })],
    ["reordered fields", bad((t) => { t.types = { ...t.types, TransferWithAuthorization: [...t.types.TransferWithAuthorization].reverse() }; })],
    ["other payTo", bad((t) => { t.message.to = privateKeyToAccount(generatePrivateKey()).address; })],
    ["other amount", bad((t) => { t.message.value = 10001n; })],
    ["other from", bad((t) => { t.message.from = privateKeyToAccount(generatePrivateKey()).address; })],
    ["bad nonce", bad((t) => { t.message.nonce = "0x1234"; })],
  ]) {
    assert.throws(() => describeAuthorization(td, req, signer.address), (e) => e instanceof X402PolicyError && e.outcome === "CONTEXT_MISMATCH", name);
  }
});

test("contextHash binds url, method and the EIP-712 digest", () => {
  const h = computeContextHash(URL_, "GET", "ab".repeat(32));
  assert.notEqual(h, computeContextHash(URL_, "POST", "ab".repeat(32)));
  assert.notEqual(h, computeContextHash(URL_ + "?x=1", "GET", "ab".repeat(32)));
  assert.notEqual(h, computeContextHash(URL_, "GET", "cd".repeat(32)));
});

test("timeout never exceeds half of the payment window", () => {
  assert.equal(effectiveTimeoutMs({}, 120), 5000);
  assert.equal(effectiveTimeoutMs({}, 4), 2000);
  assert.equal(effectiveTimeoutMs({ timeoutMs: 100 }, 120), 100);
});

test("rules policy: ALLOW under the limit, WAIT above the approval line, DENY above the max or to a stranger", async () => {
  const allow = await pay(createRulesPolicy({ maxAmount: "20000", allowPayTo: [PAY_TO], allowAssets: [FUJI_USDC] }));
  assert.equal(allow.error, undefined);
  for (const [policy, outcome] of [
    [createRulesPolicy({ maxAmount: "5000" }), "DENY"],
    [createRulesPolicy({ maxAmount: "20000", approvalAbove: "5000" }), "WAIT"],
    [createRulesPolicy({ maxAmount: "20000", allowPayTo: [privateKeyToAccount(generatePrivateKey()).address] }), "DENY"],
    [createRulesPolicy({ maxAmount: "20000", allowAssets: ["0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"] }), "DENY"],
  ]) {
    const { error, base } = await pay(policy);
    assert.equal(error.outcome, outcome);
    assert.equal(base.calls, 0);
  }
});

// End to end through @x402/fetch against a local server that answers like an x402 seller.
// The server never forwards anything to a facilitator: it only checks what it receives.
async function withSeller(fn) {
  const seen = { paid: 0, payloads: [] };
  const server = createServer((req, res) => {
    const sig = req.headers["payment-signature"];
    if (!sig) {
      const pr = { x402Version: 2, resource: { url: `http://localhost:${server.address().port}/paid` }, accepts: [requirements()] };
      res.writeHead(402, { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(pr), "content-type": "application/json" });
      return res.end("{}");
    }
    seen.paid++;
    seen.payloads.push(decodePaymentSignatureHeader(sig));
    res.writeHead(200, { "PAYMENT-RESPONSE": encodePaymentResponseHeader({ success: true, transaction: "0x" + "11".repeat(32), network: FUJI }), "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try { return await fn(`http://127.0.0.1:${server.address().port}/paid`, seen); } finally { server.close(); }
}

test("e2e: DENY never sends a payment to the seller; ALLOW sends one the payer really signed", async () => {
  await withSeller(async (url, seen) => {
    const base = spySigner();
    const deny = createPolicyX402Fetch({ signer: base, policy: createRulesPolicy({ maxAmount: "1" }), network: FUJI, asset: FUJI_USDC, maxAmountPerPayment: "10000" });
    await assert.rejects(deny(url), (e) => e instanceof X402PolicyError && e.outcome === "DENY");
    assert.equal(seen.paid, 0);
    assert.equal(base.calls, 0);

    const allow = createPolicyX402Fetch({ signer: base, policy: createRulesPolicy({ maxAmount: "10000", allowPayTo: [PAY_TO] }), network: FUJI, asset: FUJI_USDC, maxAmountPerPayment: "10000" });
    const res = await allow(url);
    assert.equal(res.status, 200);
    assert.equal(seen.paid, 1);
    assert.equal(base.calls, 1);
    const { authorization, signature } = seen.payloads[0].payload;
    const ok = await verifyTypedData({
      address: base.address,
      domain: { name: "USD Coin", version: "2", chainId: 43113, verifyingContract: FUJI_USDC },
      types: { TransferWithAuthorization: [
        { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
      ] },
      primaryType: "TransferWithAuthorization",
      message: { ...authorization, value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) },
      signature,
    });
    assert.equal(ok, true);
  });
});
