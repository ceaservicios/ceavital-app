# Build del frontend (React + Vite)
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Runtime del backend (Express + PostgreSQL)
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

ENV NODE_ENV=production
ENV HTTPS_MODE=proxy
ENV PORT=3000

# La base de datos es PostgreSQL (variable DATABASE_URL, ver .env.example).
# /data solo conserva el archivo SQLite de la epoca anterior, que se importa una
# unica vez con IMPORTAR_SQLITE=/data/ceavital.db (no se modifica ni se borra).
VOLUME ["/data"]

EXPOSE 3000
# entrada.js arranca la app o, con MODO_BKPS=on, la app de backups (ceavital-app-bkps).
CMD ["node", "src/entrada.js"]
