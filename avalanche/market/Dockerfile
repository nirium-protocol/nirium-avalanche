# Image for the avalanche x402 market. Build context: the repository root.
#   fly deploy -c fly.market.toml --remote-only   (from the repository root)
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app/avalanche
# The market uses the nirium-avalanche package from the folder above (file:..).
COPY avalanche/package.json avalanche/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY avalanche/sdk ./sdk
COPY avalanche/policy ./policy
COPY avalanche/verify-evm-core.mjs avalanche/verify-evm-receipt.mjs ./
COPY avalanche/market/package.json avalanche/market/package-lock.json ./market/
WORKDIR /app/avalanche/market
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY avalanche/market/data.mjs avalanche/market/server.mjs avalanche/market/geo.mjs ./
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
