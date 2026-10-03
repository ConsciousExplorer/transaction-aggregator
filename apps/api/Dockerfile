FROM node:24.20.0-alpine

ENV NODE_ENV=production

WORKDIR /app

# Manifests first: this layer is only invalidated when dependencies change,
# so editing source does not trigger a reinstall.
COPY package.json package-lock.json ./

RUN npm ci --omit=dev

COPY src/ src/

# Drop privileges after everything is in place. `node` exists in the base image.
USER node

CMD ["node", "--import", "@opentelemetry/auto-instrumentations-node/register", "src/app.ts"]
