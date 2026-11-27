// Decision receipts ("nirium-decision-v1") on Avalanche: a payer-signed record of what the pre-sign
// policy decided about an x402 payment, including the ones that were never signed (DENY, WAIT and
// every other refusal), which leave no trace on the chain. Format: docs/decision-receipt-v1.md.
//
// No Node-only APIs: runs in Node and in the browser, like the receipt verifier.

import { getAddress, isAddressEqual, verifyMessage } from "viem";
import { canonicalize, contentSha256, STATEMENT_PREFIX } from "../verify-evm-core.mjs";
import { NETWORKS, USDC_DECIMALS } from "./networks.mjs";

export const DECISION_VERSION = "nirium-decision-v1";
export const DECISION_OUTCOMES = Object.freeze([
  "ALLOWED", "SIGNED", "DENY", "WAIT", "TIMEOUT", "ENGINE_ERROR", "EXPIRED", "UNBOUND", "MALFORMED",
  "STALE", "VERSION_UNAVAILABLE", "SIGNER_CHANGED", "CLOCK_INVALID",
]);
const EVM_NETWORK = /^eip155:\d{1,12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const nonempty = (v) => typeof v === "string" && v.trim().length > 0;
const sameAddr = (a, b) => { try { return isAddressEqual(a, b); } catch { return false; } };

/**
 * The record for one policy decision, in canonical key order, or null when the policy refused
 * before it had decoded a payment (CONTEXT_MISMATCH): there is nothing to describe then.
 * @param {object} policyRecord what the policy passed to onDecision: { outcome, context, decision, error }
 * @param {object} [o] { ref, note, labels }
 */
export function decisionRecord(policyRecord, { ref, note, labels = [] } = {}) {
  const c = policyRecord?.context;
  const a = c?.authorization;
  const network = c?.requirements?.network;
  if (!a || !network) return null;
  const outcome = policyRecord.outcome;
  if (!DECISION_OUTCOMES.includes(outcome)) throw new Error(`decisionRecord: unknown outcome ${outcome}`);
  const usdc = NETWORKS[network]?.usdc;
  if (!usdc || !sameAddr(a.verifyingContract, usdc)) throw new Error(`decisionRecord: ${a.verifyingContract} is not USDC on ${network}`);
  const d = policyRecord.decision ?? {};
  const decision = { outcome };
  if (nonempty(d.policyVersion)) decision.policyVersion = String(d.policyVersion);
  const reason = nonempty(d.reason) ? d.reason : (nonempty(policyRecord.error) ? policyRecord.error : undefined);
  if (reason) decision.reason = String(reason).slice(0, 280);
  const intent = {
    amount: String(a.amount), asset: getAddress(a.verifyingContract), contextHash: String(c.contextHash),
    decimals: USDC_DECIMALS, from: getAddress(a.from), method: String(c.method), network: String(network),
    nonce: String(a.nonce), payloadHash: String(a.payloadHash), resource: String(c.url), to: getAddress(a.to),
  };
  const record = { decision, intent, labels: [...labels].map(String) };
  if (nonempty(ref)) record.purpose = note ? { note: String(note), ref } : { ref };
  return JSON.parse(canonicalize(record));
}

/**
 * Builds and signs a decision receipt with the payer's viem account (EIP-191 over the statement).
 * Returns { doc, record } (null when there is no decoded payment). With hashOnly, `doc` has no
 * record: keep `record` yourself to show it later.
 */
export async function bindDecision(policyRecord, { signer, ref, note, labels, hashOnly = false } = {}) {
  const record = decisionRecord(policyRecord, { ref, note, labels });
  if (!record) return null;
  if (!signer || typeof signer.signMessage !== "function") throw new Error("bindDecision: signer must be the payer's viem account (signMessage)");
  if (!sameAddr(signer.address, record.intent.from)) throw new Error(`bindDecision: signer ${signer.address} is not the payer ${record.intent.from}`);
  const content_sha256 = contentSha256(record);
  const statement = STATEMENT_PREFIX + content_sha256;
  const agent = { alg: "eip191-secp256k1", key: getAddress(signer.address), signature: await signer.signMessage({ message: statement }), statement };
  const network = record.intent.network;
  const doc = hashOnly
    ? { version: DECISION_VERSION, content_sha256, agent, network }
    : { version: DECISION_VERSION, content_sha256, record, agent, network };
  return { doc, record };
}

/**
 * Checks a decision receipt: format, hash (with a record), payer signature. Nothing on-chain: a
 * refusal leaves nothing there. For a hash-only document, pass { record } to check that it is the
 * record behind content_sha256. Returns { ok, checks: [{ name, ok, detail }] }.
 */
export async function verifyDecision(doc, { record: heldRecord } = {}) {
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), ...(detail ? { detail } : {}) }); return Boolean(ok); };
  const d = doc ?? {};
  check("version == nirium-decision-v1", d.version === DECISION_VERSION, String(d.version));
  check("network is an EVM CAIP-2 id", EVM_NETWORK.test(String(d.network)), String(d.network));
  check("content_sha256 is 64 hex", HEX64.test(String(d.content_sha256)));
  const record = d.record ?? heldRecord;
  if (record) {
    let canon;
    try { canon = canonicalize(record); } catch { canon = null; }
    check("content_sha256 == sha256(canonical(record))", canon !== null && contentSha256(record) === d.content_sha256,
      d.record ? undefined : "record held by the verifier (hash-only document)");
    check("decision.outcome is a known outcome", DECISION_OUTCOMES.includes(record?.decision?.outcome), String(record?.decision?.outcome));
    check("record.intent.network == network", record?.intent?.network === d.network);
  }
  const ag = d.agent ?? {};
  const statementOk = check("agent.statement == nirium-audit-v1:<content_sha256>", ag.statement === STATEMENT_PREFIX + d.content_sha256);
  check("agent.alg == eip191-secp256k1", ag.alg === "eip191-secp256k1", String(ag.alg));
  if (record) check("agent.key == record.intent.from (the payer signs)", sameAddr(ag.key, record?.intent?.from));
  let sigOk = false;
  if (statementOk && typeof ag.key === "string" && typeof ag.signature === "string") {
    try { sigOk = await verifyMessage({ address: ag.key, message: ag.statement, signature: ag.signature }); } catch { sigOk = false; }
  }
  check("EIP-191 signature by agent.key over agent.statement", sigOk);
  return { ok: checks.every((c) => c.ok), checks };
}

/** An onDecision observer that keeps every policy record, to sign after the payment attempt. */
export function collectDecisions() {
  const records = [];
  return { records, onDecision: (r) => { records.push(r); } };
}
