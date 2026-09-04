# Une seule image réunit les trois besoins du projet :
#   - Node, pour le serveur lui-même ;
#   - Python et uv, pour le serveur MCP officiel mcp-clickhouse ;
#   - ffmpeg, pour extraire la dernière image d'un clip et enchaîner les plans.
FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# uv fournit uvx, qui exécute le serveur MCP.
ENV UV_INSTALL_DIR=/usr/local/bin
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

WORKDIR /app

# Le serveur MCP est installé à la construction : au démarrage, plus rien à
# télécharger, et une panne réseau ne prive pas l'agent de ClickHouse.
RUN uv tool install mcp-clickhouse

COPY package.json ./
# Le projet n'a aucune dépendance npm : rien à installer, rien à mettre en cache.
COPY . .

# Le manifeste et les médias vivent sur un volume monté ici.
ENV CINEMAI_SERVER_HOST=0.0.0.0 \
    CINEMAI_SERVER_PORT=8080 \
    PATH="/root/.local/bin:${PATH}"

EXPOSE 8080

# Vérifie que le serveur répond, pas seulement que le processus est vivant.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.CINEMAI_SERVER_PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
