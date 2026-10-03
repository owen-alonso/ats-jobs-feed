FROM apify/actor-node:22

COPY package.json package-lock.json ./

RUN npm ci --include=dev --audit=false \
    && echo "Node $(node --version), npm $(npm --version)"

COPY . ./

RUN npm run build \
    && npm prune --omit=dev

CMD ["node", "dist/main.js"]
