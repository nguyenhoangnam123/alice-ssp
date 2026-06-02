FROM node:20.11.1-alpine@sha256:f3299f16246c71ab8b304d6745bb4059fa9571b828c1a5d2e18f8a9be5261b57 AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

FROM node:20.11.1-alpine@sha256:f3299f16246c71ab8b304d6745bb4059fa9571b828c1a5d2e18f8a9be5261b57 AS runtime

RUN addgroup -g 10001 appgroup && \
    adduser -u 10001 -G appgroup -s /bin/sh -D appuser

WORKDIR /app
COPY --from=build --chown=10001:10001 /app .

USER 10001

EXPOSE 3000

CMD ["node", "index.js"]