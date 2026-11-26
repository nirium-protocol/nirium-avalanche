#!/usr/bin/env bash
# Creates fresh Avalanche FUJI keys for this project, outside the repo, readable only by you:
# payer, payTo (also the ERC-8004 validator) and agent-owner keys in one env file (viem).
# Prints addresses only, never a secret. Refuses to overwrite existing keys.
# Mainnet keys are NOT made here: make them by hand and fund them with cents.
set -euo pipefail
umask 077
REPO="$(cd "$(dirname "$0")/.." && pwd)"
KEYDIR="${NIRIUM_KEY_DIR:-$HOME/.nirium-keys}"
case "$KEYDIR" in "$REPO"*) echo "refusing: key dir is inside the repo ($KEYDIR)"; exit 2;; esac
mkdir -p "$KEYDIR"; chmod 700 "$KEYDIR"

EVM_ENV="$KEYDIR/fuji.env"
if [ -e "$EVM_ENV" ]; then echo "refusing: $EVM_ENV already exists (delete it yourself if you mean it)"; exit 2; fi

[ -d "$REPO/avalanche/fuji-demo/node_modules/viem" ] || (cd "$REPO/avalanche/fuji-demo" && npm ci --silent --no-audit --no-fund)
(cd "$REPO/avalanche/fuji-demo" && node --input-type=module -e "
import { generatePrivateKey, privateKeyToAccount } from \"viem/accounts\";
import { writeFileSync } from \"node:fs\";
const payer = generatePrivateKey(), payto = generatePrivateKey(), agent = generatePrivateKey();
const addr = (k) => privateKeyToAccount(k).address;
writeFileSync(process.argv[1], [
  \"# Avalanche Fuji TESTNET keys for nirium-avalanche. Never commit, never paste.\",
  \"NIRIUM_EVM_PAYER_KEY=\" + payer,
  \"NIRIUM_EVM_PAYTO=\" + addr(payto),
  \"NIRIUM_EVM_VALIDATOR_KEY=\" + payto,
  \"NIRIUM_EVM_AGENT_KEY=\" + agent,
  \"\"].join(\"\n\"), { mode: 0o600 });
console.log(\"fuji payer      \" + addr(payer) + \"   <- 20 USDC from faucet.circle.com (Avalanche Fuji)\");
console.log(\"fuji payTo      \" + addr(payto) + \"   <- also the ERC-8004 validator; a little Fuji AVAX for ERC-8004\");
console.log(\"fuji agent      \" + addr(agent) + \"   <- ERC-8004 agent owner; a little Fuji AVAX for ERC-8004\");
" "$EVM_ENV")

echo
echo "keys written to $EVM_ENV (mode 600). Use them with:"
echo "  set -a; . $EVM_ENV; set +a"
