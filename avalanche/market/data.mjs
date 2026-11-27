// Network conditions for an Avalanche chain, read from its public RPC. What the x402 market sells.
// Only network facts (fees, block fill, block time). No token prices, no trading language.

export const FEE_PRESSURE_RULE = Object.freeze({
  description: "HIGH when the base fee rose by more than 25% across the window, or blocks were more than 50% full on average. A published heuristic, not a forecast.",
  baseFeeRisePct: 25,
  blockFill: 0.5,
});

async function rpc(url, method, params) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

const hex = (h) => BigInt(h);
const median = (xs) => { const s = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0n; };

/** Pure: builds the market answer from raw RPC results (testable offline). */
export function summarize({ network, feeHistory, gasPrice, newestBlock, oldestBlock, blocks }) {
  const base = feeHistory.baseFeePerGas.map(hex);
  const first = base[0];
  const last = base[base.length - 1];
  const risePct = first > 0n ? Number(((last - first) * 10_000n) / first) / 100 : 0;
  const fills = feeHistory.gasUsedRatio;
  const avgFill = fills.length ? fills.reduce((a, b) => a + b, 0) / fills.length : 0;
  const tip = (i) => median(feeHistory.reward.map((r) => hex(r[i])));
  const span = Number(hex(newestBlock.timestamp) - hex(oldestBlock.timestamp));
  const avgBlockTimeSec = blocks > 1 ? Math.round((span / (blocks - 1)) * 100) / 100 : null;
  const high = risePct > FEE_PRESSURE_RULE.baseFeeRisePct || avgFill > FEE_PRESSURE_RULE.blockFill;
  return {
    network,
    block: Number(hex(newestBlock.number)),
    window: { blocks, oldestBlock: Number(hex(feeHistory.oldestBlock)) },
    fees: {
      unit: "wei per gas",
      baseFeeNow: last.toString(),
      baseFeeWindowStart: first.toString(),
      baseFeeChangePct: risePct,
      priorityFeeMedian: { p25: tip(0).toString(), p50: tip(1).toString(), p90: tip(2).toString() },
      gasPrice: hex(gasPrice).toString(),
    },
    congestion: { avgBlockFill: Math.round(avgFill * 10_000) / 10_000, avgBlockTimeSec },
    feePressure: high ? "HIGH" : "NORMAL",
    feePressureRule: FEE_PRESSURE_RULE.description,
  };
}

/** Reads the last `blocks` blocks from `rpcUrl` and summarizes them. */
export async function readMarket({ rpcUrl, network, blocks = 20 }) {
  const n = `0x${blocks.toString(16)}`;
  const [feeHistory, gasPrice, newestBlock] = await Promise.all([
    rpc(rpcUrl, "eth_feeHistory", [n, "latest", [25, 50, 90]]),
    rpc(rpcUrl, "eth_gasPrice", []),
    rpc(rpcUrl, "eth_getBlockByNumber", ["latest", false]),
  ]);
  const oldestNumber = hex(newestBlock.number) - BigInt(blocks - 1);
  const oldestBlock = await rpc(rpcUrl, "eth_getBlockByNumber", [`0x${oldestNumber.toString(16)}`, false]);
  return { ...summarize({ network, feeHistory, gasPrice, newestBlock, oldestBlock, blocks }), asOf: new Date().toISOString(), source: "public RPC: eth_feeHistory, eth_gasPrice, eth_getBlockByNumber" };
}
