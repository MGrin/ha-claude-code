ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install system dependencies
RUN apk add --no-cache \
    curl \
    bash \
    git \
    nodejs \
    npm \
    jq

# Install Bun (works on aarch64 and amd64 Alpine)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Install Claude Code CLI globally (needed for `claude login` auth)
RUN npm install -g @anthropic-ai/claude-code

# Set up app directory
WORKDIR /app

# Install app dependencies
COPY package.json ./
RUN bun install --production

# Copy application code
COPY src/ ./src/
COPY public/ ./public/

# Copy rootfs (s6-overlay service definitions)
COPY rootfs/ /

# Ensure run script is executable
RUN chmod +x /etc/s6-overlay/s6-rc.d/claude-code/run
