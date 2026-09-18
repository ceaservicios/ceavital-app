# Build del frontend (React + Vite)
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Runtime del backend (Express + node:sqlite)
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

ENV NODE_ENV=production
ENV HTTPS_MODE=proxy
ENV PORT=3000

# La base SQLite vive en /data (config.dataDir resuelve a /data porque
# sistemaRoot = un nivel por encima de este WORKDIR /app) -- montar como
# volumen persistente en Easypanel para que sobreviva a cada redeploy.
VOLUME ["/data"]

EXPOSE 3000
CMD ["node", "src/server.js"]
