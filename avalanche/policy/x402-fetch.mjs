// fetch() that pays x402 `exact` on an EVM chain only when the policy says ALLOW.
//
// One gated signer and one x402 client per call, so two concurrent payments never share
// state. The selected requirements are captured in onBeforePaymentCreation (that hook runs
// before the authorization exists) and handed to the gate, which checks them against the
// typed data it is asked to sign.
//
// NEVER register onPaymentCreationFailure here: it can return a payload that did not go
// through the signer, which would bypass the gate.

import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createPolicyGatedSigner, X402PolicyError } from "./evm-policy.mjs";

/**
 * @param {object} cfg
 * @param {{address: string, signTypedData: Function, readContract?: Function}} cfg.signer  e.g. a viem account
 * @param {object} cfg.policy        X402PolicyHook (see evm-policy.mjs)
 * @param {string} cfg.network       "eip155:43113" or "eip155:43114"
 * @param {string} cfg.asset         USDC contract on that network
 * @param {string} cfg.maxAmountPerPayment  atomic units cap; also allows a non-default asset in @x402/core
 * @param {typeof fetch} [cfg.fetch]
 */
export function createPolicyX402Fetch(cfg) {
  const { signer, policy, network, asset, maxAmountPerPayment } = cfg;
  const baseFetch = cfg.fetch ?? globalThis.fetch;
  if (!/^eip155:\d+$/.test(String(network))) throw new Error("createPolicyX402Fetch: network must be eip155:<chainId>");
  if (!asset || !maxAmountPerPayment) throw new Error("createPolicyX402Fetch: asset and maxAmountPerPayment are required");

  return async function policyFetch(url, init) {
    const slot = { requirements: undefined, error: undefined };
    const method = String(init?.method ?? "GET").toUpperCase();
    const gated = createPolicyGatedSigner(
      signer, policy,
      () => ({ url: String(url), method, requirements: slot.requirements }),
      (err) => { slot.error = err; },
    );
    const client = new x402Client()
      .register(network, new ExactEvmScheme(gated))
      .onBeforePaymentCreation(async ({ selectedRequirements: r }) => {
        slot.requirements = {
          scheme: r.scheme, network: r.network, asset: r.asset, payTo: r.payTo,
          amount: r.amount, maxTimeoutSeconds: r.maxTimeoutSeconds,
          extra: { name: r.extra?.name, version: r.extra?.version },
        };
      });
    client.setSpendControls({ allowedAssets: [{ network, asset, maxAmountPerPayment }] });
    try {
      return await wrapFetchWithPayment(baseFetch, client)(url, init);
    } catch (e) {
      // @x402/fetch re-wraps errors and loses the class: hand back the gate's own error.
      if (slot.error instanceof X402PolicyError) throw slot.error;
      throw e;
    }
  };
}
