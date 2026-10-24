FROM node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205

WORKDIR /app

RUN npm install -g pnpm@10.34.1

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --prod

COPY index.js ./
COPY src ./src

CMD ["node", "index.js"]
