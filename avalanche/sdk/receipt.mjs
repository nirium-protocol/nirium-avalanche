// bindReceipt(): builds a "nirium-payment-binding-v1" receipt for a settled x402 payment on
// Avalanche, bound to the exact USDC Transfer log (block-level logIndex) and its EIP-3009 nonce,
// and signs it as the payer when a signer is given. Format: docs/payment-binding-v1.md.
//
// The receipt adds what the chain does not keep: who declared the payment and what it was for
// (`purpose`). It does not prove delivery.

import { createPublicClient, http, decodeEventLog, parseAbi, isAddressEqual, getAddress } from "viem";
import { contentSha256, canonicalize, sha256Hex, verifyBinding, VERSION, STATEMENT_PREFIX } from "../verify-evm-core.mjs";
import { getNetwork, USDC_DECIMALS } from "./networks.mjs";

const ABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
]);

function sortKeys(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(sortKeys);
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
}

/**
 * @param {object} o
 * @param {string} o.tx         settled tx hash (from the PAYMENT-RESPONSE header's `transaction`)
 * @param {string} o.network    "eip155:43113" | "eip155:43114"
 * @param {string} o.ref        order reference (purpose.ref)
 * @param {string} [o.resource] the paid URL
 * @param {string} [o.note]     short, no personal data
 * @param {string[]} [o.labels] e.g. ["selftest"]; default []
 * @param {object} [o.signer]   viem account of the payer ({ address, signMessage }); omit for an unsigned receipt
 * @param {string} [o.payer]    narrow the Transfer when the tx settled several (batch)
 * @param {string} [o.payTo]
 * @param {string} [o.rpcUrl]
 * @param {number} [o.waitMs]   how long to wait for the tx to appear on the RPC, default 60000
 */
export async function bindReceipt(o) {
  const { tx, network, ref } = o;
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(tx))) throw new Error("bindReceipt: tx must be a 0x 32-byte hash");
  if (typeof ref !== "string" || !ref.trim()) throw new Error("bindReceipt: ref (purpose.ref) is required");
  const net = getNetwork(network);
  const client = createPublicClient({ chain: net.chain, transport: http(o.rpcUrl) });
  const chainId = await client.getChainId();
  if (`eip155:${chainId}` !== network) throw new Error(`RPC chainId ${chainId} does not match ${network}`);
  // Right after settlement the public RPC may not have the receipt yet: wait for it (bounded).
  const receipt = await client.waitForTransactionReceipt({ hash: tx, timeout: o.waitMs ?? 60_000, pollingInterval: 2_000 });
  if (receipt.status !== "success") throw new Error(`tx status ${receipt.status}`);

  const decoded = receipt.logs
    .filter((l) => isAddressEqual(l.address, net.usdc))
    .map((l) => { try { return { log: l, ev: decodeEventLog({ abi: ABI, data: l.data, topics: l.topics }) }; } catch { return null; } })
    .filter(Boolean);
  const payerHint = o.signer?.address ?? o.payer;
  let transfers = decoded.filter((d) => d.ev.eventName === "Transfer");
  if (payerHint) transfers = transfers.filter((d) => isAddressEqual(d.ev.args.from, payerHint));
  if (o.payTo) transfers = transfers.filter((d) => isAddressEqual(d.ev.args.to, o.payTo));
  if (transfers.length !== 1) throw new Error(`expected exactly 1 USDC Transfer${payerHint ? " from " + payerHint : ""}${o.payTo ? " to " + o.payTo : ""}, found ${transfers.length}`);
  const t = transfers[0];
  const payer = getAddress(t.ev.args.from);
  const auths = decoded.filter((d) => d.ev.eventName === "AuthorizationUsed" && isAddressEqual(d.ev.args.authorizer, payer));
  if (auths.length !== 1) throw new Error(`expected exactly 1 AuthorizationUsed by ${payer}, found ${auths.length}`);

  const record = sortKeys({
    labels: o.labels ?? [],
    payment: {
      amount: t.ev.args.value.toString(),
      asset: getAddress(net.usdc),
      decimals: USDC_DECIMALS,
      from: payer,
      locator: { index: t.log.logIndex, kind: "evm-log" },
      network,
      to: getAddress(t.ev.args.to),
      tx,
      x402: { nonce: auths[0].ev.args.nonce, resource: o.resource ?? "unknown", scheme: "exact" },
    },
    purpose: { note: o.note ?? "", ref },
  });
  const hash = contentSha256(record);
  // Compatible with the Audit Trail verifier: sha256(JSON.stringify(record)) is the same hash.
  const plain = sha256Hex(JSON.stringify(record));
  if (plain !== hash || JSON.stringify(record) !== canonicalize(record)) throw new Error("record is not in canonical order (bug)");

  const doc = { version: VERSION, content_sha256: hash, record };
  if (o.signer) {
    if (!isAddressEqual(o.signer.address, payer)) throw new Error(`signer ${o.signer.address} is not the payer ${payer}`);
    const statement = STATEMENT_PREFIX + hash;
    doc.agent = { alg: "eip191-secp256k1", key: getAddress(o.signer.address), signature: await o.signer.signMessage({ message: statement }), statement };
  }
  doc.network = network;
  return doc;
}

/** Verifies a receipt against the chain. Returns { ok, checks }. */
export function verifyReceipt(doc, { requireSignature = true, rpcUrl } = {}) {
  return verifyBinding(doc, { requireSig: requireSignature, rpc: rpcUrl });
}
