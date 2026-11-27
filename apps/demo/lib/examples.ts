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
    cid: "Qmf2KvRL7UbJXaHXTpFbiNPNJJFFwq9q9Mg1xDw6uM9EB9",
    title: { en: "A sale of the x402 market on mainnet", es: "Una venta del market x402 en mainnet" },
    text: {
      en: "A $0.01 query to Nirium's x402 market for Avalanche network data, on C-Chain mainnet, paid by the team. The payer signed this receipt for that exact transfer, and every check runs here.",
      es: "Una consulta de $0.01 al market x402 de Nirium por datos de la red de Avalanche, en C-Chain mainnet, pagada por el equipo. Quien pagó firmó este recibo para esa transferencia exacta, y aquí corren todas las comprobaciones.",
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
    cid: "QmNjcqmY3xCnHfpvj8KXj9ZhKFEzyrMmXEQ8jNfBkhpZMz",
    edit: "amount",
    title: { en: "An edited receipt", es: "Un recibo editado" },
    text: {
      en: "The Fuji receipt with its amount changed in this page after it was signed. Watch which links break, and why.",
      es: "El recibo de Fuji con el monto cambiado en esta página después de firmarse. Mira qué líneas se rompen, y por qué.",
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
