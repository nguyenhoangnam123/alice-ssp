FROM docker.io/library/node:20-alpine@sha256:d7f1d500e4b64cf4f2e20fdb2e1648dff7b1e1258e863b9b8b063b0f2d90a4a4 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build

FROM gcr.io/distroless/nodejs20-debian12:nonroot
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
USER 10001
EXPOSE 8080
CMD ["dist/index.js"]