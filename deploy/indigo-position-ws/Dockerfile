# deploy/livekit/のようにDocker公式イメージをそのまま使えないため
# (自前のNode.jsアプリのため)、軽量なNodeイメージでビルドする。
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY config.mjs server.mjs ./
COPY lib ./lib
CMD ["node", "server.mjs"]
