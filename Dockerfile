# Next.js reader (app/). Uses output:"standalone" (next.config.mjs) so the
# runtime image is just the server bundle + static assets — no full node_modules.
# The web tier holds no data: it talks to stored/indexd over HTTP.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# This project ships no public/ dir; create it so the run-stage COPY never
# fails (and still picks up assets if one is added later).
RUN npm run build && mkdir -p public

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# Standalone output already contains the minimal server + traced node_modules.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
