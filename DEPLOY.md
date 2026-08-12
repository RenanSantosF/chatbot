# Deploy pra produção (pra testar de verdade)

Três serviços, cada um cuidando de uma parte:

| O quê | Onde | Por quê |
|---|---|---|
| Banco de dados (Postgres + pgvector) | **Supabase** | Já vem com a extensão `vector` pronta pra habilitar |
| API (NestJS + Socket.io) | **Render** | Processo Node de vida longa — Vercel é serverless e não segura WebSocket bem |
| Frontend (Next.js) | **Vercel** | É o que o Next.js faz de melhor |

Todos têm plano free suficiente pra testar. Depois, se validar o negócio, dá pra subir de tier sem trocar nada de arquitetura.

---

## 1. Banco de dados (Supabase)

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Vá em **SQL Editor** e rode:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
   (é a extensão que guarda os embeddings da Base de Conhecimento — sem isso as migrations da API vão falhar)
3. Em **Project Settings > Database**, copie a **Connection string** no modo **Session pooler** (porta 6543) — é a que aguenta várias conexões simultâneas de uma API tradicional tipo esta. Vai ficar parecido com:
   ```
   postgresql://postgres.xxxxxxxx:SUA_SENHA@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
   ```
   Essa string é o `DATABASE_URL`.

---

## 2. API (Render)

1. Crie um **Web Service** em [render.com](https://render.com) apontando pro repositório, branch `main`.
2. Root directory: `apps/api`
3. Build command:
   ```
   cd ../.. && corepack enable && pnpm install --frozen-lockfile && pnpm --filter api exec prisma migrate deploy && pnpm --filter api run build
   ```
4. Start command:
   ```
   pnpm run start:prod
   ```
5. Variáveis de ambiente (Render > Environment):

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | a connection string do Supabase (passo 1) |
   | `JWT_SECRET` | gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `JWT_EXPIRES_IN` | `7d` |
   | `PORT` | `3001` (Render define a própria porta via `PORT`, mas o Nest já lê essa env — confirme que bate com a porta que o Render expõe) |
   | `ENCRYPTION_KEY` | gere do mesmo jeito que o `JWT_SECRET`, mas **guarde separado** — se perder, ninguém decripta as chaves de IA/WhatsApp já salvas |
   | `WEB_APP_URL` | a URL que a Vercel vai te dar no passo 3 (ex: `https://seu-app.vercel.app`) — sem isso, CORS bloqueia o frontend |
   | `WHATSAPP_VERIFY_TOKEN` | qualquer string que você escolher (ex: `token-secreto-webhook`) — vai reaparecer no passo 4 |
   | `API_PUBLIC_URL` | a URL que o Render vai te dar (ex: `https://sua-api.onrender.com`) — só usada pra mostrar a URL do webhook pronta na tela de Configurações |
   | `GEMINI_API_KEY` / `GEMINI_MODEL` | opcional — deixe em branco. Cada empresa cadastra a própria chave pela tela `/dashboard/ai` |

6. Deploy. Confirme nos logs que apareceu `Nest application successfully started` e `Conectado ao Postgres`.

---

## 3. Frontend (Vercel)

1. Importe o repositório na [Vercel](https://vercel.com), branch `main`.
2. Root directory: `apps/web`
3. Variáveis de ambiente:

   | Variável | Valor |
   |---|---|
   | `API_INTERNAL_URL` | a URL da API no Render (ex: `https://sua-api.onrender.com`) |
   | `NEXT_PUBLIC_SOCKET_URL` | a mesma URL da API no Render |

4. Deploy. Depois de pronto, volte no Render e confirme que `WEB_APP_URL` bate exatamente com a URL que a Vercel gerou (com `https://`, sem barra no final).

---

## 4. WhatsApp Cloud API (Meta Developers)

Isso é por empresa/tenant — cada cliente da plataforma faz esse passo uma vez, pelo próprio Meta Developers deles.

1. Em [developers.facebook.com](https://developers.facebook.com), crie um app do tipo **Business**.
2. Adicione o produto **WhatsApp**.
3. Em **WhatsApp > Configuração da API**:
   - Copie o **Phone number ID**.
   - Gere um **token de acesso permanente**: crie um Usuário do sistema (System User) em Configurações do Negócio, dê a ele permissão `whatsapp_business_messaging` no seu WABA, e gere o token por ali — o token temporário de teste (24h) que aparece na tela inicial não serve pra produção.
4. Em **Configurações do app > Básico**, copie o **App Secret**.
5. Ainda em **WhatsApp > Configuração**, na seção **Webhook**:
   - Callback URL: `https://sua-api.onrender.com/api/webhooks/whatsapp`
   - Verify token: o mesmo valor que você colocou em `WHATSAPP_VERIFY_TOKEN` no Render
   - Clique em **Verify and save** — se dar erro aqui, confira se a API está no ar e se o verify token bate exatamente
   - Inscreva o campo **messages**
6. Na plataforma, faça login como dono da empresa, vá em **Configurações**, e cole: Phone number ID, número (só exibição), token de acesso e App Secret. Salve.
7. Mande uma mensagem de teste pro número do WhatsApp Business da empresa e confirme que ela aparece no **Inbox** da plataforma.

---

## Checklist rápido pra saber se está tudo certo

- [ ] `https://sua-api.onrender.com/api` responde (qualquer rota autenticada deve dar 401, não erro de conexão)
- [ ] Criar conta em `https://seu-app.vercel.app/register` funciona e leva pro dashboard
- [ ] Inbox conecta em tempo real (manda uma mensagem simulada e ela aparece sem dar F5)
- [ ] `/dashboard/ai` salva a API key do Gemini sem erro
- [ ] `/dashboard/settings` mostra a URL do webhook correta (com o domínio do Render, não `localhost`)
- [ ] Handshake do webhook: a Meta aceitou a URL sem erro ao salvar
- [ ] Mensagem real do WhatsApp chega no Inbox

## Coisas pra saber antes de escalar de verdade

- **Custo do Gemini**: cada empresa paga a própria conta do Google AI Studio — a plataforma não intermedia cobrança de IA.
- **Números de teste da Meta**: por padrão, um app novo só manda mensagem pra até 5 números cadastrados como testadores, até passar pela revisão do Meta (App Review) pedindo a permissão `whatsapp_business_messaging` pra produção.
- **Backup do `ENCRYPTION_KEY`**: se rotacionar essa chave sem migrar os dados já criptografados, toda API key e token de WhatsApp salvos ficam ilegíveis. Guarde em um cofre de senhas separado do resto.
