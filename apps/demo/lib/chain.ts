// What the chain alone shows about an Avalanche transaction: the ERC-20 Transfer logs in it
// (token, from, to, value, block-level logIndex), any EIP-3009 AuthorizationUsed nonce, the block
// and its time. Read-only, straight from a public RPC in the visitor's browser. No receipt is made
// up here: a receipt is what adds who declared the payment and what it was for.

export const FUJI = "eip155:43113";
export const CCHAIN = "eip155:43114";

export const NETWORKS: Record<string, { name: "fuji" | "c-chain"; rpc: string; usdc: string; explorer: string }> = {
  [FUJI]: { name: "fuji", rpc: "https://api.avax-test.network/ext/bc/C/rpc", usdc: "0x5425890298aed601595a70ab815c96711a31bc65", explorer: "https://testnet.snowtrace.io/tx/" },
  [CCHAIN]: { name: "c-chain", rpc: "https://api.avax.network/ext/bc/C/rpc", usdc: "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e", explorer: "https://snowtrace.io/tx/" },
};

// keccak256("Transfer(address,address,uint256)") and keccak256("AuthorizationUsed(address,bytes32)").
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const AUTHORIZATION_USED = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5";
export const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export const explorerTxUrl = (hash: string, network: string) => `${NETWORKS[network].explorer}${hash}`;

export type RpcFailure = "rate-limited" | "blocked" | "unreachable";
export class RpcError extends Error {
  kind: RpcFailure;
  constructor(kind: RpcFailure, message: string) { super(message); this.kind = kind; }
}

/** Maps a transport error (ours or viem's, from the verifier) to something a person can act on. */
export function rpcFailureOf(err: unknown): RpcFailure | null {
  if (err instanceof RpcError) return err.kind;
  const m = String((err as Error)?.message ?? err);
  if (/(Status:|HTTP) 429/.test(m)) return "rate-limited";
  if (/(Status:|HTTP) 40[13]/.test(m)) return "blocked";
  if (/HTTP request failed|Failed to fetch|NetworkError|fetch failed|Load failed|(Status:|HTTP) 5\d\d/.test(m)) return "unreachable";
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** JSON-RPC with growing waits on 429/5xx, so a busy public RPC is not reported as "not found". */
export async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  let status = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    } catch (e) {
      throw new RpcError("unreachable", String((e as Error).message));
    }
    status = res.status;
    if (status === 429 || status >= 500) { await sleep(1000 * 2 ** attempt); continue; }
    if (status === 401 || status === 403) throw new RpcError("blocked", `${method}: HTTP ${status}`);
    const body = await res.json();
    if (body.error) throw new Error(`${method}: ${body.error.message} (code ${body.error.code})`);
    return body.result as T;
  }
  throw new RpcError(status === 429 ? "rate-limited" : "unreachable", `${method}: HTTP ${status}`);
}

export type Transfer = { logIndex: number; token: string; from: string; to: string; value: string; usdc: boolean };
export type TxView = { network: string; hash: string; block: number; blockTime: number | null; failed: boolean; transfers: Transfer[]; nonces: { authorizer: string; nonce: string }[] };
type Log = { address: string; topics: string[]; data: string; logIndex: string };
type Receipt = { status: string; blockNumber: string; logs: Log[] };

const topicAddress = (t: string) => `0x${t.slice(26)}`;

/** Pure: the Transfer and AuthorizationUsed logs of an eth_getTransactionReceipt result. */
export function readTransaction(receipt: Receipt, network: string, hash: string, blockTime: number | null): TxView {
  const usdc = NETWORKS[network]?.usdc;
  const transfers: Transfer[] = [];
  const nonces: TxView["nonces"] = [];
  for (const log of receipt.logs) {
    const [topic0, a, b] = log.topics.map((t) => t.toLowerCase());
    if (topic0 === TRANSFER && log.topics.length === 3) {
      const token = log.address.toLowerCase();
      transfers.push({ logIndex: Number(BigInt(log.logIndex)), token, from: topicAddress(a), to: topicAddress(b), value: BigInt(log.data).toString(), usdc: token === usdc });
    } else if (topic0 === AUTHORIZATION_USED && log.topics.length === 3) {
      nonces.push({ authorizer: topicAddress(a), nonce: b });
    }
  }
  return { network, hash, block: Number(BigInt(receipt.blockNumber)), blockTime, failed: receipt.status !== "0x1", transfers, nonces };
}

/** Looks a tx hash up on one network. null = not there. */
export async function lookupTransaction(hash: string, network: string): Promise<TxView | null> {
  const url = NETWORKS[network].rpc;
  const receipt = await rpc<Receipt | null>(url, "eth_getTransactionReceipt", [hash]);
  if (!receipt) return null;
  const block = await rpc<{ timestamp: string } | null>(url, "eth_getBlockByNumber", [receipt.blockNumber, false]);
  return readTransaction(receipt, network, hash, block ? Number(BigInt(block.timestamp)) : null);
}

/** "10000" with 6 decimals -> "0.01". */
export function formatUnits(amount: string, decimals: number | null): string {
  if (decimals === null || !/^\d+$/.test(amount)) return amount;
  const s = amount.padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
