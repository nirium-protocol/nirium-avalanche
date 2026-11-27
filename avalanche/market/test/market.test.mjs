// Tests for the Avalanche x402 market. Offline: the summary is computed from fixed RPC results,
// and the paid flow runs against a local fake facilitator; the data reader is stubbed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createX402Fetch, settlementOf } from "nirium-avalanche";
import { summarize } from "../data.mjs";
import { createMarketApp, networkNote } from "../server.mjs";

const FUJI = "eip155:43113";
const h = (n) => `0x${BigInt(n).toString(16)}`;

test("summarize: base fee trend, median priority fees, block fill and time, fee pressure", () => {
  const base = { network: FUJI, gasPrice: h(160), newestBlock: { number: h(1019), timestamp: h(2038) }, oldestBlock: { number: h(1000), timestamp: h(2000) }, blocks: 20 };
  const quiet = summarize({ ...base, feeHistory: { oldestBlock: h(1000), baseFeePerGas: [h(10), h(10), h(11)], gasUsedRatio: [0.1, 0.2], reward: [[h(1), h(5), h(9)], [h(3), h(7), h(20)]] } });
  assert.equal(quiet.fees.baseFeeNow, "11");
  assert.equal(quiet.fees.baseFeeChangePct, 10);
  assert.deepEqual(quiet.fees.priorityFeeMedian, { p25: "1", p50: "5", p90: "9" });
  assert.equal(quiet.congestion.avgBlockFill, 0.15);
  assert.equal(quiet.congestion.avgBlockTimeSec, 2);
  assert.equal(quiet.feePressure, "NORMAL");
  const busy = summarize({ ...base, feeHistory: { oldestBlock: h(1000), baseFeePerGas: [h(10), h(20)], gasUsedRatio: [0.9], reward: [[h(1), h(1), h(1)]] } });
  assert.equal(busy.feePressure, "HIGH");
  for (const k of Object.keys(busy)) assert.doesNotMatch(k, /price(?!s)|opportunit|arbitrage|signal/i);
});

test("the market refuses mainnet unless allowed explicitly", () => {
  const payTo = privateKeyToAccount(generatePrivateKey()).address;
  assert.throws(() => createMarketApp({ payTo, network: "eip155:43114" }), /mainnet/);
});

test("info is free, the data is paid, and a paid query returns the network conditions", async () => {
  const payTo = privateKeyToAccount(generatePrivateKey()).address;
  let settled = 0;
  const fac = createServer((req, res) => {
    let b = ""; req.on("data", (c) => { b += c; });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url.endsWith("/supported")) return res.end(JSON.stringify({ kinds: [{ x402Version: 2, scheme: "exact", network: FUJI }], extensions: [], signers: {} }));
      const a = JSON.parse(b).paymentPayload.payload.authorization;
      if (req.url.endsWith("/verify")) return res.end(JSON.stringify({ isValid: true, payer: a.from }));
      settled++; res.end(JSON.stringify({ success: true, transaction: "0x" + "cd".repeat(32), network: FUJI, payer: a.from }));
    });
  });
  await new Promise((r) => fac.listen(0, "127.0.0.1", r));
  const app = createMarketApp({ payTo, facilitatorUrl: `http://127.0.0.1:${fac.address().port}`, read: async () => ({ network: FUJI, feePressure: "NORMAL" }) });
  const srv = createServer(app);
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const info = await (await fetch(`${base}/v1/market/info`)).json();
    assert.equal(info.price, "$0.01");
    assert.equal(info.payTo, payTo);
    assert.equal((await fetch(`${base}/v1/market`)).status, 402);
    const pay = createX402Fetch({ signer: privateKeyToAccount(generatePrivateKey()), network: FUJI, maxAmountPerPayment: "10000" });
    const res = await pay(`${base}/v1/market`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { network: FUJI, feePressure: "NORMAL" });
    assert.equal(settled, 1);
    assert.ok(settlementOf(res));
  } finally { srv.close(); fac.close(); }
});

test("the bare URL describes the market, and the network note tells the truth on each network", async () => {
  const app = createMarketApp({ payTo: "0x241d8C05f2a33F8701B933B704d329CC88367007", network: "eip155:43113" });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;
    const root = await (await fetch(base + "/")).json();
    assert.equal(root.routes.paid, "/v1/market");
    assert.equal(root.routes.info, "/v1/market/info");
    assert.equal(root.verifyReceipts, "https://avalanche.nirium.xyz");
    assert.equal(root.note, "Test network: test tokens only.");
    const info = await (await fetch(base + "/v1/market/info")).json();
    assert.ok(info.notes.includes("Test network: test tokens only."));
  } finally { srv.close(); }
  assert.match(networkNote({ mainnet: true }), /^Mainnet: real USDC/);
  assert.equal(networkNote({ mainnet: false }), "Test network: test tokens only.");
});
