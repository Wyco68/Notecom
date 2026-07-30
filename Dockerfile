# Next.js reader (app/). Uses output:"standalone" (next.config.mjs) so the
# runtime image is just the server bundle + static assets — no full node_modules.
# The web tier holds no data: it talks to stored/indexd over HTTP.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,id=npm \
    npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Cap the build's heap so Node collects instead of ballooning. It shares a
# small VPS with two Go builds that each compile modernc.org/libc; without a
# ceiling the box OOMs and every parallel build dies with it. Raise this if the
# build reports heap exhaustion on a larger machine.
ENV NODE_OPTIONS=--max-old-space-size=1536
# Next inlines NEXT_PUBLIC_* into the client bundle at build time, so these
# have to arrive here rather than at run time — without them the deployed app
# ships with collaboration disabled and no browser Supabase client. Both are
# publishable values (the anon key is meant to reach the browser; RLS is what
# protects the data), so baking them into the image is safe.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
# This project ships no public/ dir; create it so the run-stage COPY never
# fails (and still picks up assets if one is added later).
# The .next/cache mount persists Next's compiler cache between builds, so an
# unchanged-dependency rebuild only recompiles the routes that actually moved.
RUN --mount=type=cache,target=/app/.next/cache,id=nextcache \
    npm run build && mkdir -p public

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# Standalone output already contains the minimal server + traced node_modules.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
