FROM node:20-alpine

WORKDIR /app
COPY package.json server.js ./
COPY public ./public

ENV PORT=8080
ENV DATA_DIR=/data
USER root
RUN mkdir /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 8080

USER node
CMD ["node", "server.js"]
