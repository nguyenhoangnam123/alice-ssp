FROM docker.io/library/node:20-alpine@sha256:2f46fd49c767554c089a5eb219115313a72116c1e4bcef0c39e0e3d8a2f21891 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build || true

FROM gcr.io/distroless/nodejs20-debian12:nonroot
WORKDIR /app
COPY --from=build /app /app
USER 10001
EXPOSE 3000
CMD ["server.js"]