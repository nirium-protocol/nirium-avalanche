import { fileURLToPath } from "node:url";

// The repo root, so the app can import the package from ../../avalanche (file: link, the code of
// this same commit) and the team's receipts from ../../evidence.
const root = fileURLToPath(new URL("../..", import.meta.url));

// The demo lives at nirium.xyz/avalanche: nirium.xyz rewrites /avalanche/* to this deployment, so every
// path here starts with /avalanche. The old address (avalanche.nirium.xyz/ and /explorer) redirects there.
/** @type {import("next").NextConfig} */
export default {
  basePath: "/avalanche",
  async redirects() {
    return [
      { source: "/", destination: "https://nirium.xyz/avalanche", permanent: false, basePath: false },
      { source: "/explorer", destination: "https://nirium.xyz/avalanche/explorer", permanent: false, basePath: false },
    ];
  },
  turbopack: { root },
  outputFileTracingRoot: root,
  poweredByHeader: false,
};
