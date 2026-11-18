# Worker image. Build from the repository root: docker build -f apps/worker/Dockerfile -t course-setter-worker .

FROM node:26-slim AS build
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Node 26 no longer ships corepack; install the pnpm version pinned in package.json.
RUN npm install -g "$(node -p "require('./package.json').packageManager")"
COPY . .
# Production dependencies of the worker and the workspace packages it uses, kept in the workspace
# layout: Node strips TypeScript types only outside node_modules, and @course-setter/core is reached
# through a symlink to packages/core (so its real path is outside node_modules).
RUN pnpm install --frozen-lockfile --prod --filter "@course-setter/worker..."

FROM node:26-slim
# Liberation Sans is metric-compatible with Arial, the font OCAD maps use for text.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-liberation \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/package.json ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/core ./packages/core
COPY --from=build /repo/apps/worker ./apps/worker
WORKDIR /repo/apps/worker
USER node
EXPOSE 8080
CMD ["node", "src/main.ts"]
