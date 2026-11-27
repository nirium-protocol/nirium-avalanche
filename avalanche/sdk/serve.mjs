// x402Serve(): charge for your own API on Avalanche in three lines, same shape as the Stellar one
// in the `nirium` package:
//
//   app.use(x402Serve({ payTo: "0x...", routes: { "GET /signals": "$0.02" } }));
//
// Runs on YOUR server. Nirium runs nothing here and receives nothing: the buyer pays your payTo
// directly and an independent facilitator (PayAI by default) verifies and settles. No telemetry.
//
// Prices are converted to an explicit USDC amount with the token's EIP-712 domain, because Fuji
// USDC is not a default asset in @x402/evm 2.32.0. The middleware is built on the first request,
// after a /supported preflight, so a facilitator that is down or rejects you answers 503 with a
// hint instead of crashing the process (the same lesson as the Stellar x402Serve).

import { isAddress, getAddress } from "viem";
import { getNetwork, dollarsToAtomic, USDC_EXTRA, PAYAI_FACILITATOR } from "./networks.mjs";

/**
 * @param {object} config
 * @param {string} config.payTo     address that receives the USDC
 * @param {Record<string, string | {price?: string, amount?: string, description?: string}>} config.routes
 *        "GET /signals": "$0.02"; `amount` takes atomic units instead of dollars; method defaults to GET
 * @param {"eip155:43113"|"eip155:43114"} [config.network]  default Fuji
 * @param {string} [config.facilitatorUrl]  default PayAI
 * @param {number} [config.maxTimeoutSeconds] default 120
 * @param {string} [config.appName]
 */
export function x402Serve(config) {
  if (!config || !isAddress(String(config.payTo ?? ""))) throw new Error("x402Serve: `payTo` must be a 0x address. Without it there is nobody to pay.");
  const entries = Object.entries(config.routes || {});
  if (entries.length === 0) throw new Error("x402Serve: `routes` is empty; nothing would ever be charged for.");
  const network = config.network || "eip155:43113";
  const net = getNetwork(network);
  const payTo = getAddress(config.payTo);
  const facilitatorUrl = (config.facilitatorUrl || PAYAI_FACILITATOR).replace(/\/+$/, "");

  const routes = {};
  for (const [key, value] of entries) {
    const spec = typeof value === "string" ? { price: value } : value;
    const amount = spec.amount !== undefined ? String(spec.amount) : dollarsToAtomic(spec.price);
    if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) throw new Error(`x402Serve: route "${key}" needs a positive amount`);
    const routeKey = /^[A-Z]+\s/.test(key) ? key : `GET ${key}`;
    routes[routeKey] = {
      ...(spec.description ? { description: spec.description } : {}),
      accepts: [{
        scheme: "exact", network, payTo,
        price: { amount, asset: net.usdc, extra: { ...USDC_EXTRA } },
        maxTimeoutSeconds: config.maxTimeoutSeconds ?? 120,
      }],
    };
  }

  const preflight = async () => {
    const r = await fetch(`${facilitatorUrl}/supported`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`facilitator returned ${r.status}`);
    const body = await r.json();
    const ok = (body?.kinds ?? []).some((k) => k.network === network && k.scheme === "exact");
    if (!ok) throw new Error(`facilitator does not support exact on ${network}`);
  };

  let cached;
  const build = async () => {
    await preflight();
    const [{ paymentMiddleware, x402ResourceServer }, { HTTPFacilitatorClient }, { ExactEvmScheme }] = await Promise.all([
      import("@x402/express"), import("@x402/core/server"), import("@x402/evm/exact/server"),
    ]);
    const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl });
    const server = new x402ResourceServer(facilitator).register(network, new ExactEvmScheme());
    return paymentMiddleware(routes, server);
  };

  // Only requests to a paid route touch the facilitator. Everything else passes straight
  // through, so a facilitator outage never takes down the rest of the app.
  const paid = Object.keys(routes).map((k) => {
    const [method, path] = k.split(/\s+/, 2);
    return { method: method.toUpperCase(), path, prefix: path.endsWith("/*") ? path.slice(0, -1) : undefined };
  });
  const isPaid = (req) => {
    const path = String(req.path ?? req.url ?? "").split("?")[0];
    return paid.some((r) => r.method === String(req.method).toUpperCase() && (r.prefix ? path.startsWith(r.prefix) : path === r.path));
  };

  return async function niriumX402(req, res, next) {
    if (!isPaid(req)) return next();
    try {
      if (!cached) cached = build().catch((e) => { cached = undefined; throw e; });
      const mw = await cached;
      return mw(req, res, next);
    } catch (err) {
      if (res.headersSent) return;
      res.status(503).json({
        error: "x402 payments unavailable",
        detail: String(err?.message ?? err).slice(0, 200),
        hint: "the facilitator could not be reached or does not support this network",
      });
    }
  };
}
