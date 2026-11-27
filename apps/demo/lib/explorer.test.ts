// Offline tests for the explorer logic. The chain answers are the recorded public Fuji RPC answers
// for one of the team's self-test receipts (avalanche/fixtures/fuji-sdk-selftest-rpc.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classify, verifyReceipt, isChainCheck } from "./receipt.ts";
import { readTransaction, formatUnits, rpcFailureOf, FUJI, CCHAIN } from "./chain.ts";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const recorded = read("../../../avalanche/fixtures/fuji-sdk-selftest-rpc.json");
const receipt = read("../../../evidence/2026-11-26/fuji-sdk-binding.json");
const mainnetReceipt = read("../../../evidence/2026-11-26/cchain-mainnet-binding.json");

async function withFetch<T>(impl: (body: { id: number; method: string; params: unknown[] }) => Response | Promise<Response>, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => impl(JSON.parse(String(init.body)))) as typeof fetch;
  try { return await fn(); } finally { globalThis.fetch = real; }
}
const recordedRpc = ({ id, method, params }: { id: number; method: string; params: unknown[] }) => {
  const result = method === "eth_chainId" ? recorded.chainId
    : method === "eth_getTransactionReceipt" && String(params[0]).toLowerCase() === recorded.txReceipt.transactionHash.toLowerCase() ? recorded.txReceipt : null;
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: { "content-type": "application/json" } });
};

test("classify: the network comes from the receipt, and bad input is named", () => {
  const r = classify(JSON.stringify(receipt));
  assert.equal(r.kind === "receipt" ? r.network : null, FUJI);
  const m = classify(JSON.stringify(mainnetReceipt));
  assert.equal(m.kind === "receipt" ? m.network : null, CCHAIN);
  assert.deepEqual(classify(` ${receipt.record.payment.tx.toUpperCase().replace("0X", "0x")}\n`), { kind: "hash", hash: receipt.record.payment.tx.toLowerCase() });
  assert.deepEqual(classify("{ not json"), { kind: "invalid", reason: "not-json" });
  assert.deepEqual(classify('{"a":1}'), { kind: "invalid", reason: "not-a-receipt" });
  assert.deepEqual(classify('{"record":{"payment":{"network":"eip155:1"}}}'), { kind: "invalid", reason: "unknown-network" });
  assert.deepEqual(classify("0x1234"), { kind: "invalid", reason: "unrecognized" });
});

test("a real Fuji receipt is VALID with the shared verifier, checks split receipt / chain", async () => {
  const v = await withFetch(recordedRpc, () => verifyReceipt(receipt));
  assert.equal(v.status, "valid");
  if (v.status !== "valid") return;
  assert.equal(v.checks.length, 18);
  assert.ok(v.checks.some((c) => isChainCheck(c.name)) && v.checks.some((c) => !isChainCheck(c.name)));
  assert.equal(isChainCheck("content_sha256 == sha256(canonical(record))"), false);
  assert.equal(isChainCheck("Transfer.value == payment.amount"), true);
});

test("an altered receiver is INVALID, not a transport problem", async () => {
  const d = structuredClone(receipt);
  d.record.payment.to = "0x000000000000000000000000000000000000dEaD";
  const v = await withFetch(recordedRpc, () => verifyReceipt(d));
  assert.equal(v.status, "invalid");
});

test("an RPC that refuses or limits requests is reported as such, not as an invalid receipt", async () => {
  const blocked = await withFetch(() => new Response("no", { status: 403 }), () => verifyReceipt(receipt));
  assert.deepEqual(blocked, { status: "rpc-error", failure: "blocked" });
  assert.equal(rpcFailureOf(new Error("HTTP request failed.\n\nStatus: 429")), "rate-limited");
  assert.equal(rpcFailureOf(new Error("HTTP request failed.\n\nURL: https://api.avax-test.network")), "unreachable");
  assert.equal(rpcFailureOf(new Error("missing record.payment")), null);
});

test("what the chain alone shows: the USDC Transfer at its block logIndex, and the EIP-3009 nonce", () => {
  const v = readTransaction(recorded.txReceipt, FUJI, receipt.record.payment.tx, null);
  assert.equal(v.failed, false);
  assert.equal(v.block, Number(BigInt(recorded.txReceipt.blockNumber)));
  assert.equal(v.transfers.length, 1);
  const [x] = v.transfers;
  assert.equal(x.logIndex, receipt.record.payment.locator.index);
  assert.equal(x.from, receipt.record.payment.from.toLowerCase());
  assert.equal(x.to, receipt.record.payment.to.toLowerCase());
  assert.equal(x.value, "10000");
  assert.equal(x.usdc, true);
  assert.deepEqual(v.nonces, [{ authorizer: receipt.record.payment.from.toLowerCase(), nonce: receipt.record.payment.x402.nonce.toLowerCase() }]);
  assert.equal(formatUnits(x.value, 6), "0.01");
});

test("a decision receipt is recognized and checked by hash and payer signature", async () => {
  const { verifyDecision } = await import("nirium-avalanche/decision");
  for (const name of ["deny", "wait"]) {
    const doc = read(`../../../evidence/2026-11-27/fuji-decision-${name}.json`);
    const c = classify(JSON.stringify(doc));
    assert.equal(c.kind, "decision");
    assert.equal((await verifyDecision(doc)).ok, true, name);
    const edited = structuredClone(doc);
    edited.record.decision.outcome = "ALLOWED";
    assert.equal((await verifyDecision(edited)).ok, false, `${name} edited`);
  }
});
