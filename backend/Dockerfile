# syntax=docker/dockerfile:1

# --- Stage: build widget ---
FROM node:20-alpine AS widget
WORKDIR /widget
COPY widget/package.json widget/package-lock.json* ./
RUN npm ci
COPY widget/ ./
RUN npm run build

# --- Stage: build backend ---
FROM node:20-alpine AS build
WORKDIR /backend
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# --- Final image ---
FROM node:20-alpine AS final
WORKDIR /app
ENV NODE_ENV=production

COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev

# Backend compiled output
COPY --from=build /backend/dist ./dist

# Built widget served as static assets
COPY --from=widget /widget/dist ./public

# Run as non-root
USER node

EXPOSE 8080
CMD ["node", "dist/server.js"]
