#!/usr/bin/env bash
#
# Reproduz o relato "encerro, resolvo, o cliente escreve de novo e a IA não
# responde".
#
# O que ele mede é uma coisa só: depois de a conversa ser reaberta, a IA
# chega a ser CHAMADA? Por isso a chave usada pode ser falsa — o defeito
# acontecia antes de qualquer chamada ao provedor, na decisão do `aiMode`.
#
# Precisa da aplicação de pé (ver dev-preview.sh) e do cenário que
# reproduz: IA ligada e SEM chave própria, rodando com a do ambiente.
#
#   psql -U postgres -d chatbot_dev -c \
#     'UPDATE ai_settings SET active = true, "apiKeyEncrypted" = NULL;'
#   GEMINI_API_KEY=qualquer-coisa node dist/src/main
#
set -e
FONE=5527999777002
Q() { psql -U postgres -d chatbot_dev -tAc "$1"; }
CONV() { Q "SELECT c.id FROM conversations c JOIN customers k ON k.id=c.\"customerId\" WHERE k.phone='$FONE'"; }
MODO() { Q "SELECT c.\"aiMode\" FROM conversations c JOIN customers k ON k.id=c.\"customerId\" WHERE k.phone='$FONE'"; }

curl -s -X POST http://localhost:3001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"preview@teste.com","password":"senha12345"}' -c /tmp/pc.txt -o /dev/null
manda() { curl -s -o /dev/null -X POST http://localhost:3001/api/conversations/simulate-inbound \
  -H 'Content-Type: application/json' -b /tmp/pc.txt \
  -d "{\"customerPhone\":\"$FONE\",\"customerName\":\"Cliente do Relato\",\"content\":\"$1\"}"; }

Q "DELETE FROM messages WHERE \"conversationId\" IN (SELECT c.id FROM conversations c JOIN customers k ON k.id=c.\"customerId\" WHERE k.phone='$FONE');" >/dev/null
Q "DELETE FROM conversations WHERE \"customerId\" IN (SELECT id FROM customers WHERE phone='$FONE');" >/dev/null
Q "DELETE FROM customers WHERE phone='$FONE';" >/dev/null

manda "Oi, primeira mensagem"; sleep 3
ID=$(CONV)
echo "1. conversa nova     -> a IA foi chamada? $(grep -c "provedor de IA pra conversa $ID" /tmp/api.log) vez(es)"

# O atendente assume e resolve — o fluxo exato do relato.
Q "UPDATE conversations SET \"aiMode\"='HUMAN_ACTIVE', status='RESOLVED' WHERE id='$ID';" >/dev/null
ANTES=$(grep -c "provedor de IA pra conversa $ID" /tmp/api.log || true)
echo "2. atendente resolve -> status = $(Q "SELECT status FROM conversations WHERE id='$ID'"), aiMode = $(MODO)"

manda "Oi de novo, voltei"; sleep 4
DEPOIS=$(grep -c "provedor de IA pra conversa $ID" /tmp/api.log || true)
echo "3. cliente escreve de novo:"
echo "     aiMode depois da reabertura = $(MODO)"
echo "     a IA foi chamada nesta rodada? $([ "$DEPOIS" -gt "$ANTES" ] && echo SIM || echo NAO)"
echo
[ "$DEPOIS" -gt "$ANTES" ] && echo "==> A IA voltou a atender. Correto." || echo "==> A IA NAO foi nem chamada: o cliente escreveu pra ninguem."
