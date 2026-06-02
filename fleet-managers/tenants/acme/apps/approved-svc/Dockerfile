FROM docker.io/library/node:20-alpine@sha256:d2b61f78f80f270b1caaf4f1ae491e4c781bfdd114d29b81ff88f74b0aeae675 AS build
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
EXPOSE 3000
CMD ["dist/main.js"]