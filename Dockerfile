FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY src ./src
ENV DATA_FILE=/app/data/db.json
VOLUME ["/app/data"]
CMD ["node", "src/index.js"]
