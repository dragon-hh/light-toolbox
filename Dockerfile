FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir /data && chown node:node /data
COPY server ./server
ENV APP_MODE=production PORT=8787 DATA_DIR=/data
USER node
EXPOSE 8787
CMD ["node", "server/index.js"]
