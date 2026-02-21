FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

RUN addgroup -S twinbot && adduser -S twinbot -G twinbot

COPY package*.json ./

RUN npm ci --omit=dev --no-audit --no-fund

COPY . .
RUN mkdir -p memory && chown -R twinbot:twinbot /app

USER twinbot

EXPOSE 18789

CMD ["npm", "start"]
