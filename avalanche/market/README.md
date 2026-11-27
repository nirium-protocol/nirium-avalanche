# Nirium x402 market (Avalanche)

Network conditions of an Avalanche chain for $0.01 per query, paid with x402.

| Route | Paid | What |
|---|---|---|
| `GET /v1/market` | $0.01 (USDC, x402 `exact`) | Base fee now and its change over the last 20 blocks, median priority fees (p25/p50/p90), gas price, average block fill, average block time, and `feePressure` (HIGH or NORMAL) with its published rule |
| `GET /v1/market/info` | free | What is sold, price, network, payTo, facilitator, data source |
| `GET /health` | free | |

- Data comes from the chain's public RPC at request time (`eth_feeHistory`, `eth_gasPrice`,
  `eth_getBlockByNumber`). Network data only: no token prices and no recommendation to transact.
- Payment goes from the buyer straight to the market's `payTo`, settled by an independent
  facilitator (PayAI). The market stores nothing about buyers.
- Fuji only for now. On mainnet each sale is income for Nirium, so the server refuses mainnet
  unless `NIRIUM_MARKET_ALLOW_MAINNET=1`.

```bash
(cd .. && npm ci)   # the market uses the nirium-avalanche package from the folder above
npm ci
NIRIUM_EVM_PAYTO=0x... node server.mjs                                   # port 4022
NIRIUM_EVM_PAYER_KEY=0x... node buy.mjs --payto 0x... --ref order-1      # buys one query, writes a receipt
npm test                                                                 # 3 tests, offline
```

`buy.mjs` uses the SDK with a policy, so the buyer only signs what the policy allows, and it
leaves a payer-signed receipt bound to the payment.

## Deploy

The repository root has the Fly config (`fly.market.toml`) and this folder has the image
(`Dockerfile`). From the repository root:

```bash
fly deploy -c fly.market.toml --remote-only
```

The server holds no key: the only payment setting is the public address that receives each sale.
The config runs on mainnet; its comments list the values that take it back to testnet. CI builds the same image and checks that `/health` answers 200 and `/v1/market` 402.
