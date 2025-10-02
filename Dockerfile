FROM node:20-slim

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY webhook.js ./
COPY outfit.js ./

CMD ["node", "webhook.js"]
