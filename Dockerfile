# =================================================
# OASIS SOLAR — imagem Docker para produção
# =================================================
# Build:  docker build -t oasis-solar .
# Run:    docker run -p 3001:3001 --env-file server/.env oasis-solar
# =================================================

FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# ---------- Stage 1: dependências ----------
FROM base AS deps
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund

# Gera o Prisma Client (precisa do schema)
COPY server/prisma ./server/prisma
RUN cd server && npx prisma generate

# ---------- Stage 2: imagem final ----------
FROM base
RUN apk add --no-cache openssl
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=deps /app/server/prisma ./server/prisma
COPY server/package.json ./server/
COPY server/src ./server/src
COPY client ./client

# Pasta de uploads (volume montável)
RUN mkdir -p ./server/uploads && chown -R node:node ./server

USER node
EXPOSE 3001

# Aplica migrations no startup e inicia o servidor
CMD ["sh", "-c", "cd server && npx prisma migrate deploy && node src/index.js"]
