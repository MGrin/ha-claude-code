ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install system dependencies
RUN apk add --no-cache \
    curl \
    bash \
    git \
    nodejs \
    npm \
    jq \
    ttyd \
    python3 \
    py3-pip \
    py3-websockets

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Set up app directory (MCP server + launcher)
WORKDIR /app
COPY package.json ./
RUN bun install --production

COPY src/ ./src/

# Copy rootfs (s6-overlay, launcher script)
COPY rootfs/ /

# Ensure scripts are executable
RUN chmod +x /etc/s6-overlay/s6-rc.d/claude-code/run && \
    chmod +x /usr/local/bin/claude-launcher.sh
