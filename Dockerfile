# Node.js backend image (optional Ollama in sibling scripts)
FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache \
    curl \
    bash \
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY . .

# PORT is typically set by the host / orchestrator
EXPOSE ${PORT:-5000}

# Start command
CMD ["node", "index.js"]

