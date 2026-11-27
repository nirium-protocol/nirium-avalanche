// Runs the same verifier as `npx nirium-verify-evm` (nirium-avalanche/verify, the shared core) on a
// receipt the visitor pasted, and sorts the result for the page. Nothing leaves the browser except
// the RPC calls the verifier makes to the receipt's own network.

import { verifyBinding, type Check } from "nirium-avalanche/verify";
import { NETWORKS, HASH_RE, rpcFailureOf, type RpcFailure } from "./chain.ts";

export type Input =
  | { kind: "receipt"; doc: Record<string, any>; network: string }
  | { kind: "hash"; hash: string }
  | { kind: "invalid"; reason: "not-json" | "not-a-receipt" | "unknown-network" | "unrecognized" };

/** Decides what was pasted. The network comes from the receipt itself, never from the page. */
export function classify(text: string): Input {
  const t = text.trim();
  if (!t) return { kind: "invalid", reason: "unrecognized" };
  if (t.startsWith("{")) {
    let doc: any;
    try { doc = JSON.parse(t); } catch { return { kind: "invalid", reason: "not-json" }; }
    const network = doc?.record?.payment?.network;
    if (typeof network !== "string") return { kind: "invalid", reason: "not-a-receipt" };
    if (!NETWORKS[network]) return { kind: "invalid", reason: "unknown-network" };
    return { kind: "receipt", doc, network };
  }
  if (HASH_RE.test(t)) return { kind: "hash", hash: t.toLowerCase() };
  return { kind: "invalid", reason: "unrecognized" };
}

export type Verdict =
  | { status: "valid" | "invalid"; checks: Check[] }
  | { status: "incomplete"; checks: Check[]; failure: RpcFailure }
  | { status: "rpc-error"; failure: RpcFailure }
  | { status: "bad-input"; message: string };

const TRANSPORT = /HTTP request failed|Failed to fetch|Status: \d{3}/;

export async function verifyReceipt(doc: unknown): Promise<Verdict> {
  let res;
  try {
    res = await verifyBinding(doc);
  } catch (e) {
    const failure = rpcFailureOf(e);
    return failure ? { status: "rpc-error", failure } : { status: "bad-input", message: String((e as Error).message) };
  }
  // A check that failed because the RPC did not answer is not a verdict on the receipt.
  const transport = res.checks.find((c) => !c.ok && TRANSPORT.test(c.detail));
  if (transport) return { status: "incomplete", checks: res.checks, failure: rpcFailureOf(transport.detail) ?? "unreachable" };
  return { status: res.ok ? "valid" : "invalid", checks: res.checks };
}

/** Checks the chain answers, as opposed to checks of the receipt document on its own. */
export const isChainCheck = (name: string) => /chainId|^tx |^log |^Transfer\.|AuthorizationUsed/.test(name);

/** Key for a plain-language reason (see i18n.ts), when a check has one. */
export function reasonKey(name: string): string | null {
  if (name.startsWith("content_sha256")) return "hash";
  if (name.startsWith("agent.statement")) return "statement";
  if (name.startsWith("EIP-191 signature")) return "signature";
  if (name.startsWith("agent.key")) return "signer";
  if (name.startsWith("agent block")) return "unsigned";
  if (name.startsWith("Transfer.value")) return "amount";
  if (name.startsWith("Transfer.to")) return "destination";
  if (name.startsWith("Transfer.from")) return "authority";
  if (name.startsWith("AuthorizationUsed")) return "nonce";
  if (/^tx (receipt found|status)/.test(name)) return "tx";
  if (/^log \d+ /.test(name)) return "index";
  return null;
}
