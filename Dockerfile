FROM node:24-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9

WORKDIR /app
RUN npm install -g npm@11.21.2 && apt-get update && DEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::=--force-confold upgrade && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10.34.9

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --prod --no-optional --frozen-lockfile

COPY index.js ./
COPY src ./src

CMD ["node", "index.js"]
