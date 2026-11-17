# Brasil Dados Utilities — API + MCP (só leitura) e coletores
FROM node:26.0.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3010
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY config ./config
COPY docs/guia-agentes.md ./docs/guia-agentes.md
COPY tsconfig.json ./
# a base (data/) e as extensões do DuckDB (~/.duckdb) vêm de volumes
RUN mkdir -p /app/data /home/node/.duckdb && chown -R node:node /app/data /home/node/.duckdb
USER node
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3010/sources',{headers:{host:'127.0.0.1:3010'}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/server.ts"]
