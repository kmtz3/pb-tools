FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY src/ ./src/
COPY public/ ./public/

# Cloud Run expects PORT env var
ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/server.js"]
