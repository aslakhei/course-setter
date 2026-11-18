# Worker image. Build from the repository root: docker build -f apps/worker/Dockerfile -t course-setter-worker .

FROM node:26-slim AS build
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Node 26 no longer ships corepack; install the pnpm version pinned in package.json.
RUN npm install -g "$(node -p "require('./package.json').packageManager")"
COPY . .
# A self-contained copy of the worker with only its production dependencies.
RUN pnpm --filter @course-setter/worker deploy --prod --legacy /out

FROM node:26-slim
# Fonts for PDF export.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-liberation \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
USER node
EXPOSE 8080
CMD ["node", "src/main.ts"]
