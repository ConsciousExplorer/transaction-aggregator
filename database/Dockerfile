FROM node:24-alpine
WORKDIR /database
COPY package.json package-lock.json drizzle.config.ts schema.ts ./
RUN npm ci
COPY migrations ./migrations
CMD ["npx", "drizzle-kit", "migrate"]
