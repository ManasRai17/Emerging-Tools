FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm config set registry https://registry.npmjs.org/ && \
    npm install --network-timeout=1000000 --legacy-peer-deps

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
