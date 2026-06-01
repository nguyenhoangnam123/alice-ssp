FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -S app && adduser -S app -G app

# Next.js standalone output bundles the minimal server.js + only the deps it actually uses.
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public

# Drizzle migrations are run as an init container — bundle them in the image so the same
# artifact can both serve and migrate.
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/src/lib/db ./src/lib/db
COPY --from=build --chown=app:app /app/node_modules/postgres ./node_modules/postgres
COPY --from=build --chown=app:app /app/node_modules/drizzle-orm ./node_modules/drizzle-orm

USER app
EXPOSE 3000
CMD ["node", "server.js"]
