#!/usr/bin/env bash
# Sobe a aplicação inteira (Postgres + API + web) e tira prints das telas.
#
# Existe porque revisar design sem ver a tela não funciona: durante várias
# rodadas o feedback foi "está feio" e a resposta era um palpite. Com isto,
# dá pra olhar o resultado antes de entregar.
#
# Uso:  ./scripts/dev-preview.sh [rota]
# Ex.:  ./scripts/dev-preview.sh /dashboard/settings/ai
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGDATA=/var/lib/pg/data
SHOTS=${SHOTS:-/tmp/shots}
mkdir -p "$SHOTS"

echo "==> Postgres"
if ! pg_isready -p 5432 >/dev/null 2>&1; then
  mkdir -p /var/lib/pg && chown postgres:postgres /var/lib/pg
  [ -d "$PGDATA" ] || su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $PGDATA -U postgres --auth=trust" >/dev/null
  su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA -l /var/lib/pg/pg.log -o '-p 5432' start" >/dev/null
  sleep 2
fi
psql -U postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='chatbot_app'" | grep -q 1 || \
  psql -U postgres -q -c "CREATE USER chatbot_app WITH PASSWORD 'chatbot_dev_pw' SUPERUSER;"
psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='chatbot_dev'" | grep -q 1 || \
  psql -U postgres -q -c "CREATE DATABASE chatbot_dev OWNER chatbot_app;"
psql -U postgres -d chatbot_dev -q -c "CREATE EXTENSION IF NOT EXISTS vector;"

echo "==> Migrações"
(cd "$ROOT/apps/api" && npx prisma migrate deploy >/dev/null)

# Build antes de subir: rodar o dist velho já causou confusão (a API
# devolvia o formato antigo e a tela quebrava por um bug que não existia).
echo "==> Build"
(cd "$ROOT/apps/api" && pnpm run build >/dev/null)
(cd "$ROOT/apps/web" && pnpm run build >/dev/null)

echo "==> Servidores"
pkill -f "dist/src/main" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
sleep 1
(cd "$ROOT/apps/api" && setsid nohup node dist/src/main >/tmp/api.log 2>&1 </dev/null &)
(cd "$ROOT/apps/web" && setsid nohup pnpm run start >/tmp/web.log 2>&1 </dev/null &)
sleep 14

echo "==> Dados de exemplo"
REG=$(curl -s -X POST http://localhost:3001/api/auth/register -H 'Content-Type: application/json' \
  -d '{"companyName":"Empresa Teste","ownerName":"Usuário Teste","email":"preview@teste.com","password":"senha12345"}' \
  -c /tmp/preview-cookies.txt || true)
TOKEN=$(node -e "try{console.log(JSON.parse(process.argv[1]).accessToken)}catch(e){}" "$REG")
if [ -n "$TOKEN" ]; then
  for i in 1 2 3 4 5; do
    curl -s -o /dev/null -X POST http://localhost:3001/api/conversations/simulate-inbound \
      -H 'Content-Type: application/json' -b /tmp/preview-cookies.txt \
      -d "{\"customerPhone\":\"5511900000$i\",\"customerName\":\"Cliente $i\",\"content\":\"Mensagem de exemplo $i\"}"
  done
fi

echo "==> Prints em $SHOTS"
# O playwright-core fica fora do workspace de propósito: é ferramenta de
# inspeção local, não dependência da aplicação. O navegador em si já vem
# na imagem (PLAYWRIGHT_BROWSERS_PATH), então só falta a biblioteca.
CACHE=${PREVIEW_CACHE:-/tmp/preview-tools}
mkdir -p "$CACHE"
[ -d "$CACHE/node_modules/playwright-core" ] || \
  (cd "$CACHE" && npm i --no-save --silent playwright-core >/dev/null)

# O Chromium herda o proxy do ambiente e não alcança o localhost sem isso.
cd "$CACHE" && env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  node "$ROOT/scripts/capture.mjs" "$TOKEN" "${1:-}" "$SHOTS"
