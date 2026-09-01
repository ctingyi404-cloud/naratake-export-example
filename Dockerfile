# Naratake export — production container.
# SQLite lives on the /app/data volume; uploads on /app/public/uploads.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
ENV DATABASE_URL=file:/app/data/site.db
RUN npx prisma generate && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV DATABASE_URL=file:/app/data/site.db
ENV PORT=3000
COPY --from=build /app ./
VOLUME ["/app/data", "/app/public/uploads"]
EXPOSE 3000
# prepare-db pushes the schema and seeds only when the DB is empty,
# so restarts and upgrades never wipe merchant data.
CMD ["sh", "-c", "node scripts/db-prepare.mjs && npx next start -p ${PORT}"]
