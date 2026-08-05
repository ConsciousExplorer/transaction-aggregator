FROM node:24.19.0-alpine

WORKDIR /app

COPY src/ src/


COPY package.json .
COPY package-lock.json .

WORKDIR /app/src

RUN npm ci --omit dev

CMD ["node", "app.ts"]