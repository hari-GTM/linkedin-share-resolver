# LinkedIn Share Resolver — Cloud Run image.
#
# Based on the official Playwright image so Chromium + all OS deps are present
# and version-matched to the playwright npm package. The image tag MUST match the
# pinned "playwright" version in package.json (currently 1.61.0).

FROM mcr.microsoft.com/playwright:v1.61.0-noble

ENV NODE_ENV=production \
    # Browsers are already installed in the base image; don't re-download.
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PORT=8080

WORKDIR /app

# Install dependencies first (better layer caching). The base image's postinstall
# browser download is skipped via the env var above. We force dev dependencies
# (--include=dev) because NODE_ENV=production would otherwise make npm omit them,
# and the build needs TypeScript. Dev deps are pruned out after the build.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --include=dev

# Copy sources and build.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies to slim the runtime image.
RUN npm prune --omit=dev

# Run as the non-root user provided by the Playwright base image.
USER pwuser

EXPOSE 8080

CMD ["node", "dist/server.js"]
