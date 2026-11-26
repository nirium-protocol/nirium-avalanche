// Pre-sign policy gate for x402 `exact` payments on EVM chains (Avalanche C-Chain and Fuji).
//
// Same contract as the Stellar gate in the `nirium` SDK (x402-policy.ts): the policy engine
// is asked AFTER the exact authorization is built and BEFORE anything is signed, and only an
// ALLOW bound to that exact authorization, still valid, reaches the signer. DENY, WAIT, an
// error, a timeout, a malformed or stale answer, or a bad clock sign nothing.
//
// Where it hooks in: @x402/evm 2.32.0 builds the EIP-3009 `TransferWithAuthorization`
// message inside createPaymentPayload and hands it to `signer.signTypedData`. That call is
// the only place where amount, destination, token, chain and nonce all exist together, so
// the gate wraps it. Any other typed data (Permit2, EIP-2612 Permit, anything else) is
// refused before the policy is consulted: this gate only knows how to read EIP-3009.
//
// Not a security boundary against code in the same process: whoever holds the base signer
// can still call it directly.

import { createHash } from "node:crypto";
import { getAddress, hashTypedData, isAddress } from "viem";

const DEFAULT_TIMEOUT_MS = 5000;
const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const SIG65 = /^0x[0-9a-fA-F]{130}$/;

// The exact EIP-3009 type @x402/evm signs (field order matters for the EIP-712 hash).
const TRANSFER_WITH_AUTHORIZATION = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" },
  { name: "nonce", type: "bytes32" },
];

/** @typedef {'ALLOW'|'DENY'|'WAIT'} X402PolicyVerdict */
/**
 * @typedef {Object} X402PaymentRequirementsView
 * @property {string} scheme
 * @property {string} network   CAIP-2, e.g. "eip155:43113"
 * @property {string} asset     ERC-20 contract (EIP-3009 token)
 * @property {string} payTo
 * @property {string} amount    atomic units, decimal string
 * @property {number} maxTimeoutSeconds
 * @property {{name?: string, version?: string}} [extra]  EIP-712 domain the server asked for
 */
/**
 * @typedef {Object} X402PolicyDecision
 * @property {X402PolicyVerdict} decision
 * @property {string} [contextHash]   required on ALLOW, must equal the context's
 * @property {string} [reason]
 * @property {string} [policyVersion] required on ALLOW when `currentVersion` is set
 * @property {number} [expiresAt]     epoch ms; equality counts as expired
 * @property {string} [decisionId]
 */
/**
 * @typedef {Object} X402PolicyHook
 * @property {(ctx: object, opts: {signal: AbortSignal}) => Promise<X402PolicyDecision>} evaluate
 * @property {(ctx: object, opts: {signal: AbortSignal}) => Promise<string>} [currentVersion]
 * @property {number} [timeoutMs]      default 5000, never more than half of maxTimeoutSeconds
 * @property {boolean} [requireExpiry] an ALLOW without expiresAt is unsignable
 * @property {(record: object) => void} [onDecision]  observer; cannot change the outcome
 * @property {() => number} [now]      injectable clock (epoch ms), for tests
 */

/** Outcomes that mean no signature was released. */
export const REFUSALS = Object.freeze([
  "SIGNER_ERROR", "DENY", "WAIT", "TIMEOUT", "ENGINE_ERROR", "EXPIRED", "UNBOUND", "MALFORMED",
  "CONTEXT_MISMATCH", "STALE", "VERSION_UNAVAILABLE", "SIGNER_CHANGED", "CLOCK_INVALID",
]);

export class X402PolicyError extends Error {
  constructor(outcome, message, extra = {}) {
    super(`x402 policy ${outcome}: ${message}`);
    this.name = "X402PolicyError";
    this.outcome = outcome;
    this.decision = extra.decision;
    this.contextHash = extra.contextHash;
  }
}

const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const nonempty = (v) => typeof v === "string" && v.trim().length > 0;

/** Validates a policy hook when it is configured, so bad config fails before any payment. */
export function assertValidPolicyHook(policy) {
  if (!policy || typeof policy !== "object" || typeof policy.evaluate !== "function") {
    throw new Error("policy: `evaluate` must be a function.");
  }
  if (policy.currentVersion !== undefined && typeof policy.currentVersion !== "function") {
    throw new Error("policy: `currentVersion`, when set, must be a function.");
  }
  if (policy.timeoutMs !== undefined && (!Number.isSafeInteger(policy.timeoutMs) || policy.timeoutMs <= 0)) {
    throw new Error("policy: `timeoutMs` must be a positive integer (ms).");
  }
  if (policy.now !== undefined && typeof policy.now !== "function") {
    throw new Error("policy: `now`, when set, must be a function returning epoch milliseconds.");
  }
}

function chainIdOf(network) {
  const m = /^eip155:(\d+)$/.exec(String(network));
  if (!m) throw new X402PolicyError("CONTEXT_MISMATCH", `not an EVM network: ${network}`);
  return BigInt(m[1]);
}

function toBigInt(v, field) {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
    if (typeof v === "string" && /^(0x[0-9a-fA-F]+|\d+)$/.test(v)) return BigInt(v);
  } catch { /* falls through */ }
  throw new X402PolicyError("CONTEXT_MISMATCH", `${field} is not an integer`);
}

function sameAddress(a, b) {
  return isAddress(String(a)) && isAddress(String(b)) && getAddress(a) === getAddress(b);
}

/**
 * Decodes the typed data about to be signed and checks it describes exactly the payment x402
 * selected. This is not policy (that belongs to the engine): it is context integrity, so that
 * what the engine evaluates is what gets signed.
 */
export function describeAuthorization(typedData, requirements, signerAddress) {
  if (!typedData || typeof typedData !== "object") {
    throw new X402PolicyError("CONTEXT_MISMATCH", "no typed data to sign");
  }
  const { domain, types, primaryType, message } = typedData;
  if (primaryType !== "TransferWithAuthorization") {
    throw new X402PolicyError("CONTEXT_MISMATCH", `unsupported primaryType ${String(primaryType)} (only EIP-3009 TransferWithAuthorization is gated)`);
  }
  if (!types || typeof types !== "object") throw new X402PolicyError("CONTEXT_MISMATCH", "typed data has no types");
  const extraTypes = Object.keys(types).filter((k) => k !== "EIP712Domain" && k !== "TransferWithAuthorization");
  if (extraTypes.length) throw new X402PolicyError("CONTEXT_MISMATCH", `unexpected extra types: ${extraTypes.join(", ")}`);
  const fields = types.TransferWithAuthorization;
  const sameFields = Array.isArray(fields) && fields.length === TRANSFER_WITH_AUTHORIZATION.length
    && fields.every((f, i) => f && f.name === TRANSFER_WITH_AUTHORIZATION[i].name && f.type === TRANSFER_WITH_AUTHORIZATION[i].type);
  if (!sameFields) throw new X402PolicyError("CONTEXT_MISMATCH", "TransferWithAuthorization fields differ from EIP-3009");
  if (!domain || typeof domain !== "object" || !message || typeof message !== "object") {
    throw new X402PolicyError("CONTEXT_MISMATCH", "typed data has no domain or message");
  }

  const chainId = chainIdOf(requirements.network);
  if (toBigInt(domain.chainId, "domain.chainId") !== chainId) {
    throw new X402PolicyError("CONTEXT_MISMATCH", "domain.chainId differs from requirements.network");
  }
  if (!sameAddress(domain.verifyingContract, requirements.asset)) {
    throw new X402PolicyError("CONTEXT_MISMATCH", "token contract differs from requirements.asset");
  }
  const extra = requirements.extra || {};
  if (!nonempty(extra.name) || !nonempty(extra.version)) {
    throw new X402PolicyError("CONTEXT_MISMATCH", "requirements.extra has no EIP-712 name/version");
  }
  if (domain.name !== extra.name || domain.version !== extra.version) {
    throw new X402PolicyError("CONTEXT_MISMATCH", "EIP-712 domain name/version differ from requirements.extra");
  }
  if (!sameAddress(message.to, requirements.payTo)) {
    throw new X402PolicyError("CONTEXT_MISMATCH", "destination differs from requirements.payTo");
  }
  const value = toBigInt(message.value, "value");
  if (value !== toBigInt(requirements.amount, "requirements.amount")) {
    throw new X402PolicyError("CONTEXT_MISMATCH", "amount differs from requirements.amount");
  }
  if (!sameAddress(message.from, signerAddress)) {
    throw new X402PolicyError("CONTEXT_MISMATCH", "from differs from signer address");
  }
  if (typeof message.nonce !== "string" || !HEX32.test(message.nonce)) {
    throw new X402PolicyError("CONTEXT_MISMATCH", "nonce is not bytes32");
  }
  const validAfter = toBigInt(message.validAfter, "validAfter");
  const validBefore = toBigInt(message.validBefore, "validBefore");

  let payloadHash;
  try {
    payloadHash = hashTypedData({ domain, types, primaryType, message }).slice(2).toLowerCase();
  } catch (e) {
    throw new X402PolicyError("CONTEXT_MISMATCH", `typed data does not hash (${e?.shortMessage ?? e?.message})`);
  }
  return Object.freeze({
    primaryType,
    payloadHash,
    chainId: chainId.toString(),
    verifyingContract: getAddress(domain.verifyingContract),
    domainName: domain.name,
    domainVersion: domain.version,
    from: getAddress(message.from),
    to: getAddress(message.to),
    amount: value.toString(),
    validAfter: validAfter.toString(),
    validBefore: validBefore.toString(),
    nonce: message.nonce.toLowerCase(),
  });
}

/** min(timeoutMs ?? 5000, maxTimeoutSeconds * 1000 / 2): a slow engine must not eat the payment window. */
export function effectiveTimeoutMs(policy, maxTimeoutSeconds) {
  const base = policy.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (typeof maxTimeoutSeconds === "number" && Number.isFinite(maxTimeoutSeconds) && maxTimeoutSeconds > 0) {
    return Math.max(1, Math.min(base, Math.floor((maxTimeoutSeconds * 1000) / 2)));
  }
  return base;
}

/** sha256 of {v, url, method, payloadHash}: the value an ALLOW must echo back. */
export function computeContextHash(url, method, payloadHash) {
  return sha256hex(JSON.stringify({ v: 1, url, method, payloadHash }));
}

/**
 * Wraps an EVM signer ({ address, signTypedData }) so it only signs with a current ALLOW bound
 * to this exact authorization. Anything else ends without a signature.
 *
 * `getCall` supplies the per-call context (URL, method, requirements): create one gated signer
 * per payment so two concurrent payments never share state. `onRefused` receives the error
 * before it is thrown, because @x402/fetch re-wraps errors and loses their class.
 */
export function createPolicyGatedSigner(base, policy, getCall, onRefused) {
  assertValidPolicyHook(policy);
  if (!base || typeof base.signTypedData !== "function" || !isAddress(String(base.address))) {
    throw new Error("createPolicyGatedSigner: base signer needs an address and signTypedData().");
  }
  // Identity is fixed here. If the base signer changes address mid-payment, nothing is signed.
  const account = getAddress(base.address);
  const now = policy.now ?? Date.now;

  const report = (r) => {
    try {
      const out = policy.onDecision?.(r);
      if (out !== null && (typeof out === "object" || typeof out === "function")) {
        Promise.resolve(out).catch(() => { /* an observer decides nothing */ });
      }
    } catch { /* an observer decides nothing */ }
  };
  const refuse = (outcome, msg, context, decision) => {
    report({ outcome, context, decision, error: msg });
    const err = new X402PolicyError(outcome, msg, { decision, contextHash: context?.contextHash });
    try { onRefused?.(err); } catch { /* idem */ }
    throw err;
  };
  // A clock that does not return a finite number closes: NaN makes every comparison false.
  const readClock = (context, decision) => {
    let t;
    try { t = now(); } catch (e) {
      return refuse("CLOCK_INVALID", `clock threw (${e?.message ?? String(e)})`, context, decision);
    }
    if (typeof t !== "number" || !Number.isFinite(t)) {
      return refuse("CLOCK_INVALID", `clock returned ${String(t)}, not epoch milliseconds`, context, decision);
    }
    return t;
  };

  const signTypedData = async (typedData) => {
    const call = getCall();
    if (!call || !call.requirements) refuse("CONTEXT_MISMATCH", "no payment requirements bound to this signing call");
    if (!sameAddress(base.address, account)) refuse("SIGNER_CHANGED", "base signer address changed after the gate was created");

    let authorization;
    try {
      authorization = describeAuthorization(typedData, call.requirements, account);
    } catch (e) {
      return refuse(e instanceof X402PolicyError ? e.outcome : "CONTEXT_MISMATCH", e?.message ?? String(e));
    }
    const contextHash = computeContextHash(call.url, call.method, authorization.payloadHash);
    // Frozen: the engine reads, it does not rewrite what gets signed.
    const context = Object.freeze({
      contextVersion: 1,
      url: call.url,
      method: call.method,
      requirements: Object.freeze({ ...call.requirements, extra: Object.freeze({ ...(call.requirements.extra || {}) }) }),
      authorization,
      signer: account,
      contextHash,
    });

    const timeoutMs = effectiveTimeoutMs(policy, call.requirements.maxTimeoutSeconds);
    const controller = new AbortController();
    // One deadline for the whole pre-sign phase (evaluate + currentVersion).
    const deadline = readClock(context) + timeoutMs;
    let timer;
    const TIMED_OUT = Symbol("timeout");
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(TIMED_OUT); }, timeoutMs);
    });
    timeout.catch(() => { /* observed by each race */ });

    try {
      let decision;
      try {
        decision = await Promise.race([
          Promise.resolve().then(() => policy.evaluate(context, { signal: controller.signal })),
          timeout,
        ]);
      } catch (e) {
        if (e === TIMED_OUT) return refuse("TIMEOUT", `no decision within ${timeoutMs} ms`, context);
        return refuse("ENGINE_ERROR", e?.message ?? String(e), context);
      }

      // Anything that is not a well-formed ALLOW closes.
      if (!decision || typeof decision !== "object") return refuse("MALFORMED", "engine returned no decision object", context);
      if (decision.decision === "DENY") return refuse("DENY", decision.reason ?? "denied", context, decision);
      if (decision.decision === "WAIT") return refuse("WAIT", decision.reason ?? "wait", context, decision);
      if (decision.decision !== "ALLOW") return refuse("MALFORMED", `unknown verdict ${String(decision.decision)}`, context, decision);
      // Copied before any await: mutating the engine's object later changes nothing.
      const allow = Object.freeze({ ...decision });
      if (allow.contextHash !== contextHash) return refuse("UNBOUND", "ALLOW is not bound to this authorization", context, allow);
      if (allow.expiresAt !== undefined && (typeof allow.expiresAt !== "number" || !Number.isFinite(allow.expiresAt))) {
        return refuse("MALFORMED", "expiresAt must be epoch milliseconds", context, allow);
      }
      if (allow.expiresAt === undefined && policy.requireExpiry) {
        return refuse("EXPIRED", "ALLOW without expiresAt while requireExpiry is set", context, allow);
      }
      const checkClock = () => {
        const t = readClock(context, allow);
        if (t >= deadline) refuse("TIMEOUT", "decision arrived after the deadline", context, allow);
        if (allow.expiresAt !== undefined && t >= allow.expiresAt) refuse("EXPIRED", "ALLOW expired before signing", context, allow);
      };
      if (policy.currentVersion && !nonempty(allow.policyVersion)) {
        return refuse("MALFORMED", "ALLOW has no policyVersion to check against currentVersion", context, allow);
      }
      checkClock();

      // The observer runs HERE, not next to the signer: whatever it changes (the clock, the
      // policy version, the signer's address) is seen by the checks that follow.
      report({ outcome: "ALLOWED", context, decision: allow });

      if (policy.currentVersion) {
        let current;
        try {
          current = await Promise.race([
            Promise.resolve().then(() => policy.currentVersion(context, { signal: controller.signal })),
            timeout,
          ]);
        } catch (e) {
          if (e === TIMED_OUT) return refuse("TIMEOUT", `no current policy version within ${timeoutMs} ms`, context, allow);
          return refuse("VERSION_UNAVAILABLE", `currentVersion failed (${e?.message ?? String(e)})`, context, allow);
        }
        if (!nonempty(current)) return refuse("VERSION_UNAVAILABLE", "currentVersion returned no version", context, allow);
        if (current !== allow.policyVersion) {
          return refuse("STALE", `ALLOW was issued under policy ${allow.policyVersion}, current is ${current}`, context, allow);
        }
      }

      // Final checks, always, with no await before the signer.
      checkClock();
      if (!sameAddress(base.address, account)) return refuse("SIGNER_CHANGED", "base signer address changed while the policy was evaluated", context, allow);
      if (timer) clearTimeout(timer);
      let signature;
      try {
        // The original object, not a copy someone could have touched.
        signature = await base.signTypedData(typedData);
      } catch (e) {
        report({ outcome: "SIGNER_ERROR", context, decision: allow, error: e?.message ?? String(e) });
        throw e;
      }
      if (typeof signature !== "string" || !SIG65.test(signature)) {
        return refuse("SIGNER_ERROR", "signer returned no 65-byte signature", context, allow);
      }
      report({ outcome: "SIGNED", context, decision: allow });
      return signature;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  // Read-only chain access may be forwarded; no other signing method is exposed.
  const gated = { address: account, signTypedData };
  if (typeof base.readContract === "function") gated.readContract = (args) => base.readContract(args);
  return Object.freeze(gated);
}
