FROM public.ecr.aws/docker/library/node:20.15.1-alpine3.20 AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production=false
COPY . .
RUN npm run build

FROM public.ecr.aws/docker/library/node:20.15.1-alpine3.20 AS production
RUN addgroup -g 10001 appgroup && adduser -u 10001 -G appgroup -D appuser
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
USER 10001
EXPOSE 3000
CMD ["node", "dist/main.js"]