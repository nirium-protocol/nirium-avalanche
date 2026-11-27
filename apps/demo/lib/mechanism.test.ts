// Offline tests for the drawing: each link is decided by the verifier's checks, and each edit breaks
// the links it should and only those. Chain answers are the recorded public Fuji RPC answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyReceipt } from "./receipt.ts";
import { readTransaction, FUJI } from "./chain.ts";
import { links, edit, cachingFetch, withFetch, type Edit } from "./mechanism.ts";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const recorded = read("../../../avalanche/fixtures/fuji-sdk-selftest-rpc.json");
const receipt = read("../../../evidence/2026-11-26/fuji-sdk-binding.json");
const tx = readTransaction(recorded.txReceipt, FUJI, recorded.txReceipt.transactionHash, null);

let calls = 0;
const rpc = (async (_url: string, init: RequestInit) => {
  calls++;
  const { id, method, params } = JSON.parse(String(init.body));
  const result = method === "eth_chainId" ? recorded.chainId
    : method === "eth_getTransactionReceipt" && String(params[0]).toLowerCase() === recorded.txReceipt.transactionHash.toLowerCase() ? recorded.txReceipt : null;
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: { "content-type": "application/json" } });
}) as unknown as typeof fetch;

async function check(doc: any, f: typeof fetch) {
  const v = await withFetch(f, () => verifyReceipt(doc));
  assert.ok(v.status === "valid" || v.status === "invalid", v.status);
  return { status: v.status, links: links(doc, tx, "checks" in v ? v.checks : []) };
}
const broken = (ls: ReturnType<typeof links>) => ls.filter((l) => !l.ok).map((l) => l.key).sort();

test("a real receipt: every link passes, and both sides show the same values", async () => {
  const { status, links: ls } = await check(receipt, rpc);
  assert.equal(status, "valid");
  assert.deepEqual(broken(ls), []);
  const by = Object.fromEntries(ls.map((l) => [l.key, l]));
  assert.equal(by.amount.receipt, "0.01 USDC");
  assert.equal(by.amount.chain, "0.01 USDC");
  assert.ok(by.reference.chain && receipt.record.payment.x402.nonce.startsWith(by.reference.chain.slice(0, 6)));
});

test("each edit breaks exactly the links it should, with the verifier re-run from cache", async () => {
  const f = cachingFetch(rpc);
  await check(receipt, f);
  const before = calls;
  const expected: Record<Edit, string[]> = {
    amount: ["amount", "content"],        // the chain moved another amount, and the signature no longer covers it
    destination: ["content", "destination"],
    purpose: ["content"],                 // the chain never had the purpose: only the signature protects it
  };
  for (const [what, keys] of Object.entries(expected)) {
    const { status, links: ls } = await check(edit(receipt, what as Edit), f);
    assert.equal(status, "invalid", what);
    assert.deepEqual(broken(ls), keys, what);
  }
  assert.equal(calls, before, "edits must not ask the RPC again");
});
