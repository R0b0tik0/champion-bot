FROM node:20-slim

# Instalar Chromium y dependencias del sistema necesarias para Playwright
RUN apt-get update && apt-get install -y \
    chromium \
    libnss3 \
    libnspr4 \
    libatk1.0-0t64 \
    libatk-bridge2.0-0t64 \
    libcups2t64 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2t64 \
    libxshmfence1 \
    libglib2.0-0t64 \
    libnss3-tools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar package.json y lockfile
COPY package*.json ./

# Instalar dependencias de producción
RUN npm ci --only=production && \
    npm cache clean --force

# Copiar el código fuente
COPY . .

# Variables de entorno para Playwright (usar Chromium del sistema)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV CHROMIUM_PATH=/usr/bin/chromium

# Puerto que escucha la app
EXPOSE 3000

CMD ["node", "src/index.js"]
