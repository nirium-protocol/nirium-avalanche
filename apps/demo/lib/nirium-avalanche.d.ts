// Types for the parts of the nirium-avalanche package (plain .mjs) this app uses.
declare module "nirium-avalanche/verify" {
  export type Check = { name: string; ok: boolean; detail: string };
  export function verifyBinding(doc: unknown, opts?: { requireSig?: boolean; rpc?: string }): Promise<{ ok: boolean; checks: Check[] }>;
  export function contentSha256(record: unknown): string;
  export const VERSION: string;
}

declare module "nirium-avalanche/decision" {
  export const DECISION_VERSION: string;
  export function verifyDecision(doc: unknown, opts?: { record?: unknown }): Promise<{ ok: boolean; checks: { name: string; ok: boolean; detail?: string }[] }>;
}
