FROM node:20-alpine3.19@sha256:2d07db07a2df6830718ae2a47db6fedce6745f5bcd174c398f2acdda90a77c72 AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM gcr.io/distroless/nodejs20-debian12:nonroot
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER 10001
EXPOSE 3000
CMD ["dist/main.js"]