FROM node:20-slim

# Install latest Google Chrome & required Linux dependencies
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libxss1 \
    --no-install-recommends \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/googlechrome-linux-keyring.gpg \
    && sh -c 'echo "deb [arch=amd64 signed-by=/usr/share/keyrings/googlechrome-linux-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set Environment variables for Docker/Headless execution
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV DOCKER=true
ENV HEADLESS=true

WORKDIR /app

# Install Node dependencies first for better caching
COPY package*.json ./
RUN npm install

# Copy application source
COPY . .

# Run the automation script
CMD ["node", "run.js"]
