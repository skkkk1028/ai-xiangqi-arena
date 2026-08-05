FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=8788 \
    KATAGO_CONFIG_PATH=/app/config/analysis.cfg

WORKDIR /app
COPY package.json ./package.json
COPY src ./src
COPY config ./config

RUN useradd --system --uid 10001 --create-home katago-bridge
USER katago-bridge

EXPOSE 8788
HEALTHCHECK --interval=20s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8788/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
