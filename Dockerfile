FROM node:20-bookworm-slim

# Playwright install --with-deps descarga Chromium e instala
# automáticamente TODAS las dependencias del sistema necesarias
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && \
    npx playwright install --with-deps chromium && \
    npm cache clean --force

COPY . .

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

EXPOSE 3000
CMD ["node", "src/index.js"]
