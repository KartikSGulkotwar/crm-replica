# One image, two start commands (see docker-compose.yml / Railway):
#   API + web app:  node apps/server/dist/main.js   (default)
#   Worker:         node apps/worker/dist/main.js
FROM node:24-alpine AS base
RUN npm install -g pnpm@11.5.3
# Non-interactive pnpm (no TTY prompts during docker build).
ENV CI=true
WORKDIR /app

# Download dependencies using only the lockfile, so this layer is cached until it changes.
FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

FROM fetch AS build
COPY . .
RUN pnpm install --frozen-lockfile --offline && pnpm -r build

FROM fetch AS prod-deps
COPY . .
RUN pnpm install --frozen-lockfile --offline --prod --ignore-scripts

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app /app
COPY --from=build --chown=node:node /app/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /app/apps/server/dist apps/server/dist
COPY --from=build --chown=node:node /app/apps/worker/dist apps/worker/dist
COPY --from=build --chown=node:node /app/apps/web/dist apps/web/dist
USER node
EXPOSE 3000
CMD ["node", "apps/server/dist/main.js"]
