# Stage 1: Build
FROM node:20.18.0-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

# Stage 2: Runtime
FROM node:20.18.0-alpine AS runtime

RUN addgroup -g 10000 appgroup && \
    adduser -u 10000 -G appgroup -s /bin/sh -D appuser

WORKDIR /app

COPY --from=builder --chown=10000:10000 /app /app

USER 10000

EXPOSE 3000

CMD ["node", "index.js"]