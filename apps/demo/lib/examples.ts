// Examples as stories: receipts the team anchored on Nirium's Audit Trail, opened by CID so they go
// through the same gateway fetch and CID recomputation as anything a visitor pastes. All of them are
// the team's own test payments and are labeled that way on the page.
export const STORIES = [
  {
    cid: "QmYpar3uokiDo7HWh8v1PivcyZskGCE5u9dELJeUiehcW4",
    title: { en: "The first payment on C-Chain mainnet", es: "El primer pago en C-Chain mainnet" },
    text: {
      en: "0.01 USDC on 26 Nov 2026, settled with an EIP-3009 authorization. The public C-Chain RPC answers browsers, so every check runs here.",
      es: "0.01 USDC el 26 nov 2026, liquidado con una autorización EIP-3009. El RPC público de C-Chain responde al navegador, así que aquí corren todas las comprobaciones.",
    },
  },
  {
    cid: "QmNjcqmY3xCnHfpvj8KXj9ZhKFEzyrMmXEQ8jNfBkhpZMz",
    title: { en: "A payment on Fuji", es: "Un pago en Fuji" },
    text: {
      en: "The same kind of receipt on the Fuji testnet, about half an hour earlier the same day.",
      es: "El mismo tipo de recibo en la testnet Fuji, una media hora antes ese mismo día.",
    },
  },
  {
    cid: "QmWMvQ8pcAGs2fojuZvUzxj68VvZfdYYpbR8gqL6j9cCi6",
    title: { en: "A receipt from another network", es: "Un recibo de otra red" },
    text: {
      en: "A payment on Solana devnet. This page recognizes it and sends you to the page that checks Solana.",
      es: "Un pago en devnet de Solana. Esta página lo reconoce y te manda a la que comprueba Solana.",
    },
  },
] as const;
