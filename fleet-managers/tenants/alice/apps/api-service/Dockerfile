FROM node:20.15.1-alpine3.20 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

FROM gcr.io/distroless/nodejs20-debian12:nonroot
WORKDIR /app
COPY --from=build /app /app
USER 10001
EXPOSE 8080
CMD ["server.js"]