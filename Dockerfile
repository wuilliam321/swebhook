FROM node:20-slim

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY webhook.js ./

CMD ["node", "webhook.js"]