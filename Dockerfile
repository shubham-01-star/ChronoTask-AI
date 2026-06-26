# Build stage
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Run stage
FROM node:20-alpine AS runner

WORKDIR /usr/src/app

ENV NODE_ENV=production

COPY --chown=node:node package*.json ./
RUN npm ci --only=production

COPY --chown=node:node --from=builder /usr/src/app/dist ./dist

USER node

EXPOSE 5000

CMD ["node", "dist/index.js"]
