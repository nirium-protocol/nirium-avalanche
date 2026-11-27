// One-click examples: the team's own test payments from evidence/, imported as they are so the
// page never shows a copy that drifted. Each one is labeled as a team self-test in the UI.
import fuji from "../../../evidence/2026-11-26/fuji-a2-binding.json";
import fujiPolicy from "../../../evidence/2026-11-26/fuji-policy-allow-binding.json";
import fujiSdk from "../../../evidence/2026-11-26/fuji-sdk-binding.json";
import fujiMarket from "../../../evidence/2026-11-27/fuji-market-fly-binding.json";
import cchain from "../../../evidence/2026-11-26/cchain-mainnet-binding.json";
import cchainMarket from "../../../evidence/2026-11-27/cchain-mainnet-market-binding.json";

export const EXAMPLES = [
  { id: "fuji", label: { en: "Fuji payment", es: "Pago en Fuji" }, doc: fuji },
  { id: "fuji-policy", label: { en: "Fuji, after a policy ALLOW", es: "Fuji, tras un ALLOW de la política" }, doc: fujiPolicy },
  { id: "fuji-sdk", label: { en: "Fuji, paid with the library", es: "Fuji, pagado con la librería" }, doc: fujiSdk },
  { id: "fuji-market", label: { en: "Fuji, market query", es: "Fuji, consulta al market" }, doc: fujiMarket },
  { id: "cchain", label: { en: "C-Chain mainnet payment", es: "Pago en C-Chain mainnet" }, doc: cchain },
  { id: "cchain-market", label: { en: "C-Chain mainnet, market query", es: "C-Chain mainnet, consulta al market" }, doc: cchainMarket },
] as const;
