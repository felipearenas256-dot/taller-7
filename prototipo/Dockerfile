FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY lib ./lib
COPY servicios ./servicios
COPY public ./public
ENV EN_DOCKER=1
# El servicio que se ejecuta se elige en docker-compose.yml (command)
CMD ["node", "servicios/gateway.js"]
