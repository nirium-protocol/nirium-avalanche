// createX402Fetch(): pay x402 resources on Avalanche with a per-payment cap and, optionally, the
// pre-sign policy (a payment the policy refuses is never signed). Same idea as initX402 +
// x402Fetch in the `nirium` package.
//
//   const pay = createX402Fetch({ signer: account, network: "eip155:43113", maxAmountPerPayment: "10000", policy });
//   const res = await pay("https://seller.example/paid");
//   const settlement = settlementOf(res);   // { transaction, network, payer } or undefined

import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createPolicyX402Fetch } from "../policy/x402-fetch.mjs";
import { getNetwork } from "./networks.mjs";

/**
 * @param {object} cfg
 * @param {{address: string, signTypedData: Function}} cfg.signer  e.g. a viem account (the payer's own key)
 * @param {"eip155:43113"|"eip155:43114"} [cfg.network]  default Fuji
 * @param {string} cfg.maxAmountPerPayment  cap in atomic USDC; refuses anything above before signing
 * @param {object} [cfg.policy]  X402PolicyHook; when set, nothing is signed without its ALLOW
 * @param {boolean} [cfg.allowMainnet]  must be true to pay on eip155:43114
 * @param {typeof fetch} [cfg.fetch]
 */
export function createX402Fetch(cfg) {
  const network = cfg.network || "eip155:43113";
  const net = getNetwork(network);
  if (net.mainnet && cfg.allowMainnet !== true) throw new Error("createX402Fetch: refusing mainnet without allowMainnet: true (real funds)");
  if (!/^\d+$/.test(String(cfg.maxAmountPerPayment ?? ""))) throw new Error("createX402Fetch: maxAmountPerPayment (atomic USDC) is required");
  if (cfg.policy) {
    return createPolicyX402Fetch({
      signer: cfg.signer, policy: cfg.policy, network, asset: net.usdc,
      maxAmountPerPayment: String(cfg.maxAmountPerPayment), fetch: cfg.fetch,
    });
  }
  return wrapFetchWithPaymentFromConfig(cfg.fetch ?? globalThis.fetch, {
    schemes: [{ network, client: new ExactEvmScheme(cfg.signer) }],
    spendControls: { allowedAssets: [{ network, asset: net.usdc, maxAmountPerPayment: String(cfg.maxAmountPerPayment) }] },
  });
}

/** Reads the settlement from a paid response, or undefined if nothing was settled. */
export function settlementOf(response) {
  const h = response?.headers?.get?.("PAYMENT-RESPONSE");
  if (!h) return undefined;
  const s = decodePaymentResponseHeader(h);
  return s?.success ? s : undefined;
}
