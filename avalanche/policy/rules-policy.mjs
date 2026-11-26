// A small reference policy engine, for demos and tests. Real deployments plug in their own.
//
// Rules, checked against what is actually about to be signed (context.authorization):
//   - the token must be in `allowAssets` (if given),
//   - the destination must be in `allowPayTo` (if given),
//   - amount > `maxAmount` gives DENY,
//   - amount > `approvalAbove` (and <= maxAmount) gives WAIT: a person has to approve it,
//   - anything else gives ALLOW, bound to this authorization, valid for `ttlMs`.

import { getAddress } from "viem";

export function createRulesPolicy({
  maxAmount, approvalAbove, allowPayTo, allowAssets, ttlMs = 30_000, policyVersion = "rules-v1",
  now = Date.now, onDecision,
} = {}) {
  if (maxAmount === undefined) throw new Error("createRulesPolicy: maxAmount (atomic units) is required");
  const max = BigInt(maxAmount);
  const approval = approvalAbove === undefined ? undefined : BigInt(approvalAbove);
  const payTo = allowPayTo ? new Set(allowPayTo.map((a) => getAddress(a))) : undefined;
  const assets = allowAssets ? new Set(allowAssets.map((a) => getAddress(a))) : undefined;

  return {
    now,
    onDecision,
    async evaluate(ctx) {
      const a = ctx.authorization;
      const amount = BigInt(a.amount);
      if (assets && !assets.has(getAddress(a.verifyingContract))) return { decision: "DENY", reason: "token not allowed", policyVersion };
      if (payTo && !payTo.has(getAddress(a.to))) return { decision: "DENY", reason: "destination not allowed", policyVersion };
      if (amount > max) return { decision: "DENY", reason: `amount ${amount} above limit ${max}`, policyVersion };
      if (approval !== undefined && amount > approval) return { decision: "WAIT", reason: `amount ${amount} needs approval (above ${approval})`, policyVersion };
      return { decision: "ALLOW", contextHash: ctx.contextHash, expiresAt: now() + ttlMs, policyVersion };
    },
  };
}
