FROM node:20-slim

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY webhook.js ./
COPY .env ./

# Default to port 3000 if not specified
ENV PORT=3000

EXPOSE $PORT

CMD ["npm", "start"]
