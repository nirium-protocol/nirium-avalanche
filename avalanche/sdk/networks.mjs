// Avalanche networks Nirium supports. USDC addresses from Circle's official list
// (developers.circle.com/stablecoins/usdc-contract-addresses, checked 25-nov-2026); EIP-712 domain
// of both contracts: name "USD Coin", version "2" (read from the contracts on 26-nov-2026).
import { avalanche, avalancheFuji } from "viem/chains";

export const NETWORKS = Object.freeze({
  "eip155:43113": { chain: avalancheFuji, usdc: "0x5425890298aed601595a70AB815c96711a31Bc65", explorer: "https://testnet.snowtrace.io/tx/", mainnet: false },
  "eip155:43114": { chain: avalanche, usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", explorer: "https://snowtrace.io/tx/", mainnet: true },
});
export const USDC_DECIMALS = 6;
export const USDC_EXTRA = Object.freeze({ name: "USD Coin", version: "2" });
/** Independent x402 facilitator used by default. Nirium does not run one. */
export const PAYAI_FACILITATOR = "https://facilitator.payai.network";

export function getNetwork(id) {
  const n = NETWORKS[id];
  if (!n) throw new Error(`unsupported network ${id}; use one of ${Object.keys(NETWORKS).join(", ")}`);
  return n;
}

/** "$0.01" or "0.01" -> atomic USDC units as a string. Rejects more than 6 decimals. */
export function dollarsToAtomic(price) {
  const m = /^\$?(\d+)(?:\.(\d{1,6}))?$/.exec(String(price).trim());
  if (!m) throw new Error(`price "${price}" must look like "$0.01" (at most 6 decimals)`);
  const atomic = BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
  if (atomic <= 0n) throw new Error(`price "${price}" must be above zero`);
  return atomic.toString();
}
