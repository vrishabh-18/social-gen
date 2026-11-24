FROM node:20-slim AS client
WORKDIR /client
COPY client/package.json ./
RUN npm install
COPY client/ ./
RUN npx vite build

FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package.json ./
RUN npm install --omit=dev
COPY server/ ./
COPY --from=client /client/dist /app/client/dist
ENV DATA_DIR=/data CLIENT_DIST=/app/client/dist PORT=3000
VOLUME /data
EXPOSE 3000
CMD ["npx", "tsx", "src/index.ts"]
