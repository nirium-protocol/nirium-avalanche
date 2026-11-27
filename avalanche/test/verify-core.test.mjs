// Unit tests for verify-evm-core.mjs, the one verifier the CLI, verifyReceipt() and the browser
// share. No network: the full check runs against recorded public Fuji RPC answers for one of the
// team's self-test receipts (fixtures/fuji-sdk-selftest-rpc.json).
//
// node:crypto appears here only as the reference the code used before it moved to viem's sha256,
// so each hash test checks that the two agree.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { verifyMessage } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { canonicalize, contentSha256, sha256Hex, verifyBinding, STATEMENT_PREFIX } from "../verify-evm-core.mjs";
import { computeContextHash } from "../policy/evm-policy.mjs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const receipts = ["2026-11-26", "2026-11-27"].flatMap((d) =>
  readdirSync(new URL(`../../evidence/${d}/`, import.meta.url)).filter((f) => f.endsWith("-binding.json"))
    .map((f) => ({ name: `${d}/${f}`, doc: read(`../../evidence/${d}/${f}`) })));
const recorded = read("../fixtures/fuji-sdk-selftest-rpc.json");
const selftest = read("../../evidence/2026-11-26/fuji-sdk-binding.json");

const nodeSha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const clone = (d) => JSON.parse(JSON.stringify(d));
const failing = (res) => res.checks.filter((c) => !c.ok).map((c) => c.name).sort();

// A fetch that answers eth_chainId and eth_getTransactionReceipt from the recording.
async function withRecordedRpc(fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const answer = ({ id, method, params }) => {
      if (method === "eth_chainId") return { jsonrpc: "2.0", id, result: recorded.chainId };
      if (method === "eth_getTransactionReceipt") {
        return { jsonrpc: "2.0", id, result: params[0].toLowerCase() === recorded.txReceipt.transactionHash.toLowerCase() ? recorded.txReceipt : null };
      }
      throw new Error(`unexpected RPC method ${method}`);
    };
    const out = Array.isArray(body) ? body.map(answer) : answer(body);
    return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
  };
  try { return await fn(); } finally { globalThis.fetch = real; }
}

test("record hash matches every evidence receipt and fixture, and matches node:crypto", () => {
  const fixtures = readdirSync(new URL("../fixtures/", import.meta.url)).filter((f) => f.startsWith("june-"))
    .map((f) => ({ name: f, doc: read(`../fixtures/${f}`) }));
  assert.ok(receipts.length >= 7, `expected the evidence receipts, found ${receipts.length}`);
  for (const { name, doc } of receipts) assert.equal(contentSha256(doc.record), doc.content_sha256, name);
  for (const { name, doc } of [...receipts, ...fixtures]) {
    assert.equal(contentSha256(doc.record), nodeSha(canonicalize(doc.record)), name);
  }
});

test("sha256Hex agrees with node:crypto, including non-ASCII text", () => {
  for (const s of ["", "a", "pago de prueba ñandú", "日本語", "emoji 🧾", " ", JSON.stringify(selftest.record)]) {
    assert.equal(sha256Hex(s), nodeSha(s), JSON.stringify(s));
  }
});

test("the policy contextHash is unchanged (same value node:crypto gave)", () => {
  const cases = [["https://seller.example/paid", "GET", "0x" + "ab".repeat(32)], ["http://localhost:4021/x?y=1", "POST", "0x" + "00".repeat(32)]];
  for (const [url, method, payloadHash] of cases) {
    assert.equal(computeContextHash(url, method, payloadHash), nodeSha(JSON.stringify({ v: 1, url, method, payloadHash })));
  }
});

test("payer signatures on every evidence receipt verify", async () => {
  for (const { name, doc } of receipts) {
    const a = doc.agent;
    assert.equal(a.statement, STATEMENT_PREFIX + doc.content_sha256, name);
    assert.equal(await verifyMessage({ address: a.key, message: a.statement, signature: a.signature }), true, name);
  }
});

test("full check offline: the team's Fuji self-test receipt is VALID", async () => {
  const res = await withRecordedRpc(() => verifyBinding(clone(selftest)));
  assert.deepEqual(failing(res), []);
  assert.equal(res.ok, true);
  assert.equal(res.checks.length, 18);
});

test("full check offline: each altered field fails for its own reason", async () => {
  const STATEMENT = "agent.statement == nirium-audit-v1:<content_sha256>";
  const HASH = "content_sha256 == sha256(canonical(record))";
  const rehash = (d) => { d.content_sha256 = contentSha256(d.record); return d; };
  const AUTH = "AuthorizationUsed(payment.from, x402.nonce) in same tx";
  const other = privateKeyToAccount(generatePrivateKey()).address;
  const cases = [
    ["amount +1, hash not updated", (d) => { d.record.payment.amount = "10001"; }, [HASH, "Transfer.value == payment.amount"]],
    ["amount +1, hash updated", (d) => { d.record.payment.amount = "10001"; rehash(d); }, [STATEMENT, "Transfer.value == payment.amount"]],
    ["destination changed, hash updated", (d) => { d.record.payment.to = other; rehash(d); }, [STATEMENT, "Transfer.to == payment.to"]],
    ["purpose edited, hash not updated", (d) => { d.record.purpose.note = "something else"; }, [HASH]],
    ["purpose edited, hash updated", (d) => { d.record.purpose.ref = "order-99"; rehash(d); }, [STATEMENT]],
    ["nonce changed, hash updated", (d) => { d.record.payment.x402.nonce = "0x" + "11".repeat(32); rehash(d); }, [STATEMENT, AUTH]],
    ["log index moved, hash updated", (d) => { d.record.payment.locator.index = 0; rehash(d); }, [STATEMENT, "log 0 is Transfer"]],
    ["signature altered", (d) => { const s = d.agent.signature; d.agent.signature = s.slice(0, 10) + (s[10] === "a" ? "b" : "a") + s.slice(11); },
      ["EIP-191 signature by agent.key over agent.statement"]],
  ];
  for (const [name, mutate, expected] of cases) {
    const d = clone(selftest);
    mutate(d);
    const res = await withRecordedRpc(() => verifyBinding(d));
    assert.equal(res.ok, false, name);
    assert.deepEqual(failing(res), [...expected].sort(), name);
  }
});

test("browser-safe: the verifier, receipt and policy modules use nothing Node-only, and load with browser exports", () => {
  const files = ["../verify-evm-core.mjs", "../sdk/receipt.mjs", "../sdk/networks.mjs", "../policy/evm-policy.mjs", "../policy/rules-policy.mjs"];
  for (const f of files) {
    // Comments may name what the file avoids, so only code is searched.
    const src = readFileSync(new URL(f, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.doesNotMatch(src, /from\s+["']node:|import\(["']node:|require\(|\bBuffer\b|\bprocess\./, f);
  }
  const urls = files.map((f) => new URL(f, import.meta.url).href);
  const script = `
    for (const u of ${JSON.stringify(urls)}) await import(u);
    const m = await import(${JSON.stringify(urls[0])});
    const doc = ${JSON.stringify(selftest)};
    if (m.contentSha256(doc.record) !== doc.content_sha256) throw new Error("hash");
    console.log("ok");`;
  const r = spawnSync(process.execPath, ["--conditions=browser", "--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "ok");
});
