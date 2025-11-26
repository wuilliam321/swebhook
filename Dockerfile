FROM node:20-slim

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY index.js ./
COPY src ./src

CMD ["node", "index.js"]
