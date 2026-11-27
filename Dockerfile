# syntax=docker/dockerfile:1

FROM node:24-slim

ENV NODE_ENV=production \
    DATABASE_PATH=/app/data/ferry.db

WORKDIR /app

RUN npm install --global pnpm@12.3.4

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY src ./src

# Keep the SQLite database on a volume so it survives container rebuilds.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data

USER node
CMD ["node", "src/index.ts"]
