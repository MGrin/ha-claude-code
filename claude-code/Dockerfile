ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install system dependencies
RUN apk add --no-cache \
    curl \
    bash \
    git \
    nodejs \
    npm

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Install Claude Code CLI (for authentication via `claude login`)
RUN npm install -g @anthropic-ai/claude-code

# Set up app directory
WORKDIR /app

# Install app dependencies
COPY package.json bun.lock* ./
RUN bun install --production

# Copy application code
COPY src/ ./src/
COPY public/ ./public/

# Copy rootfs (s6-overlay service definitions)
COPY rootfs/ /

# Persistent data directory (sessions, auth)
RUN mkdir -p /data/.claude
ENV HOME=/data

EXPOSE 5100
