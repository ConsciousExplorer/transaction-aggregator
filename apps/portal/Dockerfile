# Build: every dependency, then Next's standalone server
FROM node:24.20.0-alpine AS build

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

# Manifests first: this layer is only invalidated when dependencies change
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Run: only what the server needs (the standalone output and the static assets)
FROM node:24.20.0-alpine

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8084
ENV HOSTNAME=0.0.0.0

WORKDIR /app

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static

# Drop privileges. `node` exists in the base image.
USER node

EXPOSE 8084

CMD ["node", "server.js"]
