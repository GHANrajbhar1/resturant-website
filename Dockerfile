FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=5500
ENV DB_FILE=/app/data/spiceroot.db

RUN mkdir -p /app/data

EXPOSE 5500

CMD ["npm", "start"]
