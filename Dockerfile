# Alpine fijado en 3.24: es la primera con postgresql18-client (pg_dump de las copias de
# seguridad, ver src/services/copias.service.js). Las dos etapas usan la misma imagen.

# Build del frontend (React + Vite)
FROM node:22-alpine3.24 AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Runtime del backend (Express + PostgreSQL)
FROM node:22-alpine3.24
# pg_dump para las copias de seguridad. Su versión mayor tiene que ser >= la de la base de
# Easypanel (el panel /sa > Copias muestra las dos); si se actualiza la base, subir también este.
RUN apk add --no-cache postgresql18-client
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

ENV NODE_ENV=production
ENV HTTPS_MODE=proxy
ENV PORT=3000

# La base de datos es PostgreSQL (variable DATABASE_URL, ver .env.example).
# /data solo conserva los archivos SQLite de la epoca anterior (pasados a
# PostgreSQL el 2026-09-19); la app ya no los usa.
VOLUME ["/data"]

EXPOSE 3000
CMD ["node", "src/server.js"]
