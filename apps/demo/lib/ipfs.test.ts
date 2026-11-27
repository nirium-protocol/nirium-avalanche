// Offline tests for the CID path: detection of what was pasted, the gateway chain (recorded
// answers, no network), and the CID recomputed from the bytes. The bytes anchored on IPFS for each
// team receipt are the compact JSON of its file in evidence/, so these tests use those files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractCid, cidMatches, fetchCid, base32, GATEWAYS } from "./ipfs.ts";
import { classify } from "./receipt.ts";

const anchored = (p: string) => new TextEncoder().encode(JSON.stringify(JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"))));
const fuji = anchored("../../../evidence/2026-11-26/fuji-a2-binding.json");
const FUJI_CID = "QmNjcqmY3xCnHfpvj8KXj9ZhKFEzyrMmXEQ8jNfBkhpZMz";
const cchain = anchored("../../../evidence/2026-11-26/cchain-mainnet-binding.json");
const CCHAIN_CID = "QmYpar3uokiDo7HWh8v1PivcyZskGCE5u9dELJeUiehcW4";
const SIG = "2uyixpix6haUfxhzRfMNtRcZ8fDHGJ1dNLHSZQ5dL6qXK3B6KfTpFpvSpgwXhpqjQ5AmD2xT2KuMt7p8m9g5UfE8";

test("detects what was pasted: CID, gateway URL, transaction hash, receipt, other networks", () => {
  for (const s of [FUJI_CID, `ipfs://${FUJI_CID}`, `https://gateway.pinata.cloud/ipfs/${FUJI_CID}`, `https://${FUJI_CID}.ipfs.dweb.link/`, ` ${FUJI_CID}\n`]) {
    assert.deepEqual(classify(s), { kind: "cid", cid: FUJI_CID }, s);
  }
  assert.deepEqual(classify(SIG), { kind: "foreign", family: "svm" });
  assert.deepEqual(classify(`0x${"AB".repeat(32)}`), { kind: "hash", hash: `0x${"ab".repeat(32)}` });
  assert.equal(classify(new TextDecoder().decode(fuji)).kind, "receipt");
  assert.deepEqual(classify('{"version":"1.1.0","content_sha256":"x","network":"stellar:pubnet"}'), { kind: "foreign", family: "stellar" });
  assert.deepEqual(classify('{"record":{"payment":{"network":"solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"}}}'), { kind: "foreign", family: "svm" });
  assert.equal(extractCid("Qm123"), null);
  assert.equal(classify("hello").kind, "invalid");
});

test("the CID recomputed from the anchored bytes is the CID (v0 and v1)", async () => {
  assert.equal(await cidMatches(FUJI_CID, fuji), true);
  assert.equal(await cidMatches(CCHAIN_CID, cchain), true);
  assert.equal(await cidMatches(FUJI_CID, cchain), false);
  // The same block as CIDv1 (dag-pb, base32): same multihash, different spelling.
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of FUJI_CID) n = n * 58n + BigInt(B58.indexOf(c));
  const mh = Uint8Array.from(n.toString(16).padStart(68, "0").match(/../g)!.map((h) => parseInt(h, 16)));
  const v1 = "b" + base32(Uint8Array.of(0x01, 0x70, ...mh));
  assert.equal(extractCid(v1), v1);
  assert.equal(await cidMatches(v1, fuji), true);
  assert.equal(await cidMatches(v1, cchain), false);
});

// A fetch that answers per gateway from a recorded table, and remembers what was asked.
function recorded(answers: Record<string, () => Response>) {
  const asked: string[] = [];
  const impl = (async (url: string) => {
    asked.push(url);
    const gw = GATEWAYS.find((g) => url.startsWith(g))!;
    return answers[gw] ? answers[gw]() : new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, asked };
}

test("a 429 or a failing gateway moves on to the next one, in order", async () => {
  const { impl, asked } = recorded({
    [GATEWAYS[0]]: () => new Response("slow down", { status: 429 }),
    [GATEWAYS[1]]: () => { throw new TypeError("Failed to fetch"); },
    [GATEWAYS[2]]: () => new Response(fuji, { status: 200 }),
  });
  const got = await fetchCid(FUJI_CID, { fetchImpl: impl });
  assert.equal(got.status, "ok");
  if (got.status !== "ok") return;
  assert.equal(got.gateway, GATEWAYS[2]);
  assert.equal(got.cidCheck, true);
  assert.deepEqual(got.attempts.map((a) => a.status), [429, "error", 200]);
  assert.deepEqual(asked, GATEWAYS.slice(0, 3).map((g) => `${g}/ipfs/${FUJI_CID}`));
});

test("a gateway that serves other bytes is a FAIL that names it, not a receipt", async () => {
  const { impl } = recorded({ [GATEWAYS[0]]: () => new Response(cchain, { status: 200 }) });
  const got = await fetchCid(FUJI_CID, { fetchImpl: impl });
  assert.deepEqual(got, { status: "mismatch", gateway: GATEWAYS[0], attempts: [{ gateway: GATEWAYS[0], status: 200 }] });
});

test("no gateway has it: not-found, with every attempt listed", async () => {
  const { impl } = recorded({});
  const got = await fetchCid(FUJI_CID, { fetchImpl: impl });
  assert.equal(got.status, "not-found");
  assert.equal(got.attempts.length, GATEWAYS.length);
});
