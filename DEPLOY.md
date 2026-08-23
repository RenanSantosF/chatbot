# Deploy pra produção (pra testar de verdade)

Três serviços, cada um cuidando de uma parte:

| O quê | Onde | Por quê |
|---|---|---|
| Banco de dados (Postgres + pgvector) | **Supabase** | Já vem com a extensão `vector` pronta pra habilitar |
| API (NestJS + Socket.io) | **Railway** (ou Render) | Processo Node de vida longa — Vercel é serverless e não segura WebSocket bem |
| Frontend (Next.js) | **Railway** | Mesmo lugar da API, um serviço separado. (A Vercel também serve, mas é bloqueada por proxy em muitas redes corporativas.) |

Todos têm plano free suficiente pra testar. Depois, se validar o negócio, dá pra subir de tier sem trocar nada de arquitetura.

---

## 1. Banco de dados (Supabase)

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Vá em **SQL Editor** e rode:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
   (é a extensão que guarda os embeddings da Base de Conhecimento — sem isso as migrations da API vão falhar)
3. Em **Project Settings > Database**, copie a **Connection string** do
   pooler na **porta 6543** — é a que aguenta várias conexões simultâneas de
   uma API tradicional tipo esta. Vai ficar parecido com:

   > O Supabase renomeou essas opções: a porta 6543 hoje aparece como
   > **Transaction pooler**, e o nome **Session pooler** passou a valer pra
   > outra coisa, na porta 5432. Se a tela não bater com o texto, vá pela
   > porta.

   ```
   postgresql://postgres.xxxxxxxx:SUA_SENHA@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
   ```
   Essa string é o `DATABASE_URL`.

---

## 2. API (Railway)

O repo é um monorepo pnpm (`apps/api` + `apps/web` compartilhando um `pnpm-lock.yaml` na raiz). Pra isso funcionar, o **Root Directory do serviço precisa ser a raiz do repositório** (deixe em branco), não `apps/api` — só assim o Nixpacks enxerga o `pnpm-lock.yaml`/`pnpm-workspace.yaml` e sabe que é um workspace pnpm em vez de tentar `npm install` isolado dentro de `apps/api` (é exatamente isso que causa o erro `Prisma only supports Node.js versions 20.19+...` rodando em Node 18: sem ver o lockfile, ele nem escolhe o gerenciador nem a versão certos).

O `railway.json` na raiz do repo já define o build e o start certos:
```json
{
  "build": { "builder": "NIXPACKS", "buildCommand": "pnpm --filter api run build" },
  "deploy": { "startCommand": "cd apps/api && npx prisma migrate deploy && node dist/src/main" }
}
```
E o `engines.node` no `package.json` (raiz e `apps/api`) garante que o Nixpacks escolha Node 22+ em vez do padrão antigo.

1. Crie um serviço em [railway.app](https://railway.app) apontando pro repositório, branch `main`.
2. Em **Settings > Source**: Root Directory = *(vazio, raiz do repo)*.
3. Em **Settings > Build**, confirme que Build e Start command batem com o `railway.json` acima — se tiver algo customizado salvo por cima, apague pra deixar o `railway.json` mandar.
4. Variáveis de ambiente (Settings > Variables):

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | a connection string do Supabase (passo 1) |
   | `JWT_SECRET` | gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `JWT_EXPIRES_IN` | `7d` |
   | `PORT` | `3001` |
   | `ENCRYPTION_KEY` | gere do mesmo jeito que o `JWT_SECRET`, mas **guarde separado** — se perder, ninguém decripta as chaves de IA/WhatsApp já salvas |
   | `WEB_APP_URL` | a URL do serviço web (passo 3, ex: `https://seu-app.up.railway.app`) — sem isso, CORS bloqueia o frontend |
   | `WHATSAPP_VERIFY_TOKEN` | qualquer string que você escolher (ex: `token-secreto-webhook`) — vai reaparecer no passo 4 |
   | `API_PUBLIC_URL` | a URL pública que o Railway vai te dar (Settings > Networking > Generate Domain) — só usada pra mostrar a URL do webhook pronta na tela de Configurações |
   | `GEMINI_API_KEY` / `GEMINI_MODEL` | opcional — deixe em branco. Cada empresa cadastra a própria chave pela tela `/dashboard/ai` |
   | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | gere o PAR com `npx web-push generate-vapid-keys` (o mesmo par nas duas variáveis, um valor em cada). Sem elas o aviso com o painel fechado fica desligado — o resto funciona igual |
   | `VAPID_SUBJECT` | um e-mail seu. **O `mailto:` na frente faz parte do valor** (`mailto:voce@seudominio.com`) — a norma pede uma URL, não um e-mail solto. Se você esquecer, o sistema completa sozinho e registra no log |

5. Deploy. Confirme nos logs que apareceu `Nest application successfully started` e `Conectado ao Postgres`.

**Prefere Render?** Funciona igual: Root directory *(vazio, raiz do repo)*, Build command `pnpm --filter api run build`, Start command `cd apps/api && npx prisma migrate deploy && node dist/src/main`, mesmas variáveis da tabela acima trocando `API_PUBLIC_URL` pela URL que o Render gerar.

---

## 3. Frontend (Railway)

É um **segundo serviço** no mesmo projeto do Railway, apontando pro mesmo
repositório. O que muda é o arquivo de configuração que ele obedece.

1. No projeto do Railway: **New > GitHub Repo**, escolha o mesmo repositório.
2. Em **Settings > Source**: Root Directory = *(vazio, a raiz do repo)*.

   Este é o passo que quebra o build se estiver errado. Apontar pra
   `apps/web` faz o Nixpacks procurar o `pnpm-lock.yaml` lá dentro, não
   achar (ele mora na raiz, como em todo monorepo pnpm) e falhar com
   `ERR_PNPM_NO_LOCKFILE ... frozen-lockfile`.

3. Em **Settings > Config-as-code**, defina o caminho como `railway.web.json`.

   Sem isso, os dois serviços leriam o `railway.json` da raiz e o frontend
   tentaria subir a API. O `railway.web.json` já está no repositório com o
   build e o start certos:

   ```json
   {
     "build": { "buildCommand": "pnpm --filter web run build" },
     "deploy": { "startCommand": "pnpm --filter web exec next start -H 0.0.0.0" }
   }
   ```

4. Variáveis de ambiente:

   | Variável | Valor |
   |---|---|
   | `API_INTERNAL_URL` | a URL pública da API (ex: `https://sua-api.up.railway.app`) |
   | `NEXT_PUBLIC_SOCKET_URL` | a mesma URL pública da API |
   | `NEXT_PUBLIC_SITE_URL` | o endereço público **deste site** (ex: `https://clara.com.br`) — de onde saem `canonical`, sitemap, robots e a imagem que aparece ao colar o link no WhatsApp |

   Sobre a última: sem ela o site sobe funcionando, mas com as tags de SEO
   apontando pro `localhost` de quem gerou o build — o Google indexaria um
   endereço que não existe e o card de compartilhamento viria sem imagem.
   Ponha o domínio final (com `https://`, sem barra no fim) antes de
   divulgar o link.

   As três precisam existir **antes do build**, não só no deploy:
   `NEXT_PUBLIC_*` é embutida no JavaScript durante o `next build`, e o
   rewrite de `/api/*` é resolvido no mesmo momento. Se você criar a
   variável depois, force um redeploy.

5. **Settings > Networking > Generate Domain** pra ter a URL pública.
6. Volte no serviço da API e ajuste `WEB_APP_URL` pra essa URL (com
   `https://`, sem barra no final). Sem isso o CORS barra o frontend.

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
   - Callback URL: `https://sua-api.up.railway.app/api/webhooks/whatsapp`
   - Verify token: o mesmo valor que você colocou em `WHATSAPP_VERIFY_TOKEN` na API
   - Clique em **Verify and save** — se dar erro aqui, confira se a API está no ar e se o verify token bate exatamente
   - Inscreva o campo **messages**
6. Na plataforma, faça login como dono da empresa, vá em **Configurações**, e cole: Phone number ID, número (só exibição), token de acesso e App Secret. Salve.
7. Mande uma mensagem de teste pro número do WhatsApp Business da empresa e confirme que ela aparece no **Inbox** da plataforma.

---

## 5. WhatsApp por QR code (Evolution) — alternativa à Meta

Este é o **outro** caminho: em vez de conta comercial aprovada, o número
conecta como um aparelho vinculado, igual ao WhatsApp Web. Vale a pena
saber o que muda antes de subir qualquer coisa:

| | Meta (oficial) | Evolution |
|---|---|---|
| Aprovação | Verificação de negócio + App Review | Nenhuma |
| Custo | Por conversa | Só o servidor |
| Tempo pra conectar | Dias a semanas | Minutos |
| Iniciar conversa | Modelo aprovado | **Não dá** — só responder quem falou antes |
| Anexo | Sim | **Ainda não** neste sistema |
| Estabilidade | A Meta garante | A sessão cai; relê o QR code |
| Risco | Nenhum | O número pode ser bloqueado pela Meta |

É uma escolha **por empresa**, e é exclusiva: conectar a Evolution faz
todas as mensagens daquela empresa saírem por lá.

### 5.1 Subir o servidor

O `deploy/evolution/docker-compose.yml` já está no repositório, com
Postgres e Redis (a versão 2 exige os dois: sem Postgres a sessão se perde
a cada reinício, sem Redis a reconexão fica instável).

Numa VPS com Docker:

```bash
git clone <este-repo> && cd <este-repo>/deploy/evolution

# A chave que você vai colar na tela do sistema:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Cole o valor em AUTHENTICATION_API_KEY e ajuste SERVER_URL
# pro endereço público, depois:
docker compose up -d
docker compose logs -f evolution
```

Ponha um proxy reverso com HTTPS na frente (Caddy resolve em três linhas,
Traefik e nginx também servem). **Não deixe a porta 8080 aberta na
internet sem TLS**: a chave da API viaja em cabeçalho, e em HTTP puro ela
vai em texto limpo — quem a pegar manda mensagem pelo WhatsApp do seu
cliente.

No Railway dá pra fazer sem compose: **New > Docker Image**, imagem
`evoapicloud/evolution-api:v2.3.7`, e as mesmas variáveis do arquivo
(trocando os endereços pelos que o Railway gerar). Veja o modo enxuto
abaixo pra não precisar de Postgres nem Redis novos.

Dois detalhes do Railway que custam meia hora cada:

- **A porta é 8080.** A Evolution escuta em `SERVER_PORT` (padrão 8080) e
  NÃO lê a variável `PORT` que o Railway injeta. Ao gerar o domínio,
  informe 8080 — senão o endereço existe e devolve 502, com o contêiner
  de pé, o que parece falha da imagem e não é.
- **`SERVER_URL` sai do domínio, então gere o domínio primeiro.** Dá pra
  fugir do copia-e-cola usando a referência do próprio Railway:
  `SERVER_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}` — ele preenche sozinho e
  continua certo se o domínio mudar.

### 5.1.1 Modo enxuto: um serviço só, nenhum banco novo

O plano gratuito do Railway limita quantos serviços você cria, e a
Evolution "completa" pede três (ela + Postgres + Redis). Dá pra rodar com
**um**, sem perder nada que importe num teste:

**Redis vira cache em memória.** Troque por:

```
CACHE_REDIS_ENABLED=false
CACHE_LOCAL_ENABLED=true
```

A Evolution cai no cache local sozinha. O cache morre junto com o
contêiner — para um número só, isso é uma reconexão mais lenta depois de
reiniciar, não perda de sessão. A sessão vive no Postgres.

**O Postgres precisa ser OUTRO — não o banco da API.**

Schema separado não basta, e essa lição custou uma queda de produção. As
duas aplicações usam Prisma, e `prisma migrate deploy` pega um advisory
lock de número FIXO (`72707369`) que vale para o banco inteiro, não para
o schema. Com as duas no mesmo banco, dois deploys simultâneos disputam o
mesmo cadeado: um espera dez segundos, desiste com `P1002`, e a migração
fica marcada como falha. A partir daí todo deploy da API morre com
`P3009` até alguém limpar a linha na mão — ver "Quando der errado".

No plano gratuito do Supabase dá pra ter **dois projetos**: crie um só
pra Evolution. É de graça e resolve de vez.

Mantenha o schema separado de qualquer forma, para as 36 tabelas dela não
se misturarem com as suas:

1. No **SQL Editor** do Supabase:
   ```sql
   CREATE SCHEMA IF NOT EXISTS evolution;
   ```
2. Use a connection string com o schema **e o limite de conexões**:
   ```
   DATABASE_CONNECTION_URI=postgresql://...supabase.com:5432/postgres?schema=evolution&connection_limit=8&pool_timeout=30
   ```

   O `connection_limit` não é ajuste fino, é o que impede a Evolution de
   derrubar o banco sozinha. Ao conectar, o WhatsApp despeja o histórico do
   aparelho de uma vez — centenas de conversas e contatos em segundos — e o
   Prisma abre conexão à vontade pra dar conta. O pooler gratuito do
   Supabase aceita 15 clientes; passa disso e tudo para com
   `EMAXCONNSESSION: max clients reached`, inclusive quem mais estiver
   naquele banco.

   Vale o mesmo pra API, aliás: se ela dividir o banco com qualquer outra
   coisa, ponha um `connection_limit` nela também.

Duas armadilhas nesse endereço:

- **Porta 5432 — nunca a 6543.** A Evolution roda migrações ao subir, e o
  pooler em modo transação (6543) não aguenta o travamento que a migração
  usa: ela sobe e morre em laço, com um erro que não diz isso.

  Das três opções que o Supabase oferece, duas servem e uma não:

  | Opção | Porta | Serve |
  |---|---|---|
  | Direct connection | 5432 | Sim, mas o endereço é só IPv6 |
  | **Session pooler** | 5432 | **Sim — e resolve em IPv4 também** |
  | Transaction pooler | 6543 | Não |

  Prefira o **Session pooler**: é modo sessão, então o travamento da
  migração funciona, e ele não depende de a rede de saída ter IPv6. A
  conexão direta funciona igual onde houver IPv6 — a diferença é só o
  risco de descobrir que não há.
- **`?schema=evolution` não é opcional.** Sem ele as tabelas dela caem no
  `public`, junto com as suas. Não há colisão de nome hoje (as dela são
  `"Message"`, as suas são `messages`), mas um `prisma migrate` seu
  passando por ali fica bem mais assustador de ler.

Fica assim: **1 serviço novo** no Railway, nenhum banco novo.

### 5.2 Apontar a API para o servidor

**Estas duas variáveis vão no serviço da API, e nunca no painel de quem
usa o produto.**

| Variável | Valor |
|---|---|
| `EVOLUTION_BASE_URL` | O endereço do seu servidor Evolution |
| `EVOLUTION_API_KEY` | A `AUTHENTICATION_API_KEY` que você gerou |

O endereço aceita domínio pelado (`algo.up.railway.app`) e barra
sobrando: a API completa o `https://` e apara o fim.

> **Por que não pedir isso ao cliente.** A chave da Evolution é
> **global**: quem a tem cria, lê e **apaga qualquer sessão** do servidor,
> não só a sua. A tela chegou a pedi-la a cada empresa, e isso entregava a
> cada cliente o poder de derrubar o WhatsApp de todos os outros. Não é
> preferência de tela — é isolamento entre empresas.
>
> Se a chave vazar, troque-a no servidor Evolution **e** na variável, nesta
> ordem. As sessões já pareadas continuam de pé; só as chamadas da API
> passam a usar a nova.

Além delas, o servidor precisa **chamar a API de volta** quando chegar
mensagem:

- `API_PUBLIC_URL` preenchida no serviço da API (é dela que sai a URL do
  webhook). Sem ela, conectar falha na hora, com recado explícito.
- A API acessível pela internet. Em desenvolvimento isso quer dizer um
  túnel (`ngrok`, `cloudflared`) — `localhost` conecta e nunca recebe
  nada, que é a falha mais difícil de diagnosticar deste caminho.

### 5.3 Conectar

Em **Configurações > WhatsApp**, role até *Conectar lendo um QR code*. Há
dois caminhos, e a tela já abre no que funciona no aparelho em uso.

**Ler QR code** (computador)

1. **Conectar WhatsApp** → a imagem aparece.
2. No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho.

**Usar código** (celular)

1. Informe o número que vai atender, com DDI e DDD, só dígitos.
2. **Conectar WhatsApp** → sai um código de oito caracteres.
3. No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho →
   **Conectar com número de telefone** → digite o código.

O segundo existe porque no celular não dá para escanear a própria tela, e
porque um código se dita por telefone quando quem contrata não é quem tem
o aparelho. Os dois expiram em cerca de um minuto.

Em nenhum dos dois há endereço ou chave para preencher: o sistema cria a
sessão, registra o webhook e troca o canal da empresa sozinho.

### 5.4 A variável que o anexo exige

`DATABASE_SAVE_DATA_NEW_MESSAGE` precisa ser **`true`**.

A Evolution não hospeda arquivo: para devolver o binário de uma foto, ela
localiza a mensagem no banco DELA e pede ao WhatsApp. Com a gravação
desligada, essa busca não acha nada e o painel mostra "não deu pra buscar
este anexo" — com a foto virando um cartão de arquivo genérico.

O custo é o banco da Evolution crescer com as mensagens. Ele é limitado do
lado de cá: assim que uma mídia chega, a API baixa e guarda uma cópia
própria (`S3_BUCKET`), e daí em diante o painel serve dessa cópia sem
perguntar nada à Evolution. Ou seja, o banco dela só precisa segurar a
mensagem por segundos — dá para podá-lo periodicamente sem perder anexo
nenhum.

As outras `DATABASE_SAVE_*` continuam em `false`: contatos, conversas e
histórico são coisas que já vivem no nosso banco.

### 5.5 Quando der errado

| Sintoma | Causa quase sempre |
|---|---|
| QR code aparece, some e nunca conecta | O contêiner não alcança `web.whatsapp.com` (é de lá que ele lê a versão do WhatsApp Web a cada conexão) — confira a saída de rede dele |
| Conecta, mas mensagem não chega no Inbox | `API_PUBLIC_URL` errada, ou a API não é acessível de fora |
| "a chave da API do servidor foi recusada" | `EVOLUTION_API_KEY` na API diferente da `AUTHENTICATION_API_KEY` do servidor |
| "a sessão não existe mais no servidor" | O servidor foi recriado do zero — conecte de novo |
| Cai sozinho toda hora | Celular sem bateria/internet, ou WhatsApp Web aberto demais em outros lugares |
| "a conexão por QR code não está disponível nesta instalação" | Faltou `EVOLUTION_BASE_URL` ou `EVOLUTION_API_KEY` no serviço da API |
| "não deu pra buscar este anexo no WhatsApp" | `DATABASE_SAVE_DATA_NEW_MESSAGE` em `false` — ver abaixo |
| `failed to decrypt message` / `Invalid PreKey ID` | O pareamento nasceu quebrado, ou sobraram aparelhos vinculados antigos — ver abaixo |
| A API começa a falhar com `P3009` | Uma migração ficou marcada como falha por disputa de cadeado — ver abaixo |
| `EMAXCONNSESSION: max clients reached` | Quase sempre `DATABASE_SAVE_IS_ON_WHATSAPP` ligada — ver abaixo. Depois disso, `connection_limit` na string |
| Variável que você definiu parece ignorada | A imagem embute um `.env` com os padrões dela. O que você define no painel ganha; o que você não define NÃO fica vazio, fica no padrão — que é `true` |
| A API para de responder junto com isso | Mesma causa: a Evolution consumiu as 15 conexões do pooler e não sobrou nenhuma |

### `Invalid PreKey ID`: conecta, e a mensagem não chega

A Evolution recebe a mensagem e não consegue descriptografá-la, então a
descarta antes de virar webhook. O painel fica mudo com a sessão
conectada — mesmo sintoma de webhook errado, causa completamente
diferente.

O material de criptografia se estabelece no instante do pareamento. Ele
nasce quebrado quando o banco está engasgado nesse momento (procure por
`transaction failed, rolling back` no log: é o Baileys tentando gravar as
chaves e não conseguindo), e também quando sobraram vínculos antigos —
cada QR lido cria um aparelho vinculado a mais, e os anteriores continuam
valendo no celular.

Refazer o pareamento do zero, com o banco saudável:

1. No celular: WhatsApp > Aparelhos conectados > remova **todos** os
   vínculos da plataforma, inclusive o atual.
2. Na tela de Configurações > WhatsApp: **Desconectar** (isso apaga a
   sessão no servidor, não só desliga).
3. Conectar de novo e ler o QR.

Resolver o banco ANTES de repareá-lo não é detalhe de ordem: é a única
forma de as chaves serem gravadas.

### `EMAXCONNSESSION` logo depois de ler o QR code

`DATABASE_SAVE_IS_ON_WHATSAPP` grava uma linha por contato, e o código
dispara todos em paralelo: quatrocentos contatos viram quatrocentas
consultas simultâneas no instante da conexão. Num pooler gratuito (15
clientes) isso estoura na hora, e derruba junto quem mais estiver naquele
banco.

Ela vem ligada por padrão pela imagem, então precisa ser desligada por
extenso:

```
DATABASE_SAVE_IS_ON_WHATSAPP=false
```

O sistema não usa esse cache — quem descobre se o número existe é o
próprio envio, que já falha com motivo legível.

### Migração travada em `P3009`

Acontece quando dois `prisma migrate deploy` correm no mesmo banco ao
mesmo tempo. O sintoma é a API não subir mais, com o nome da migração
culpada no log. No SQL Editor:

```sql
-- 1. A migração chegou a aplicar alguma coisa?
--    O tempo esgota pegando o cadeado, antes de qualquer SQL, então o
--    normal é tudo vir vazio.
SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
FROM _prisma_migrations
ORDER BY started_at DESC
LIMIT 5;

-- 2a. Nada aplicado: apague a tentativa e deixe o próximo deploy refazer.
DELETE FROM _prisma_migrations WHERE migration_name = 'NOME_DA_MIGRACAO';

-- 2b. Aplicou tudo mas não foi marcada: marque como concluída.
UPDATE _prisma_migrations
SET finished_at = now(), rolled_back_at = NULL, applied_steps_count = 1
WHERE migration_name = 'NOME_DA_MIGRACAO';
```

Antes de escolher entre 2a e 2b, confira no banco se os objetos que a
migração cria já existem. Aplicar de novo por cima do que existe falha
com "already exists", e marcar como concluída o que não aplicou deixa o
banco sem as colunas que o código espera — os dois erros são piores que a
pergunta.

Não fixe a versão do WhatsApp Web à mão: da 2.3 em diante a Evolution a
busca sozinha, e a variável antiga (`CONFIG_SESSION_PHONE_VERSION`) não é
mais lida. Se você encontrar um tutorial mandando defini-la, ele é de uma
versão anterior.

A versão da **imagem**, essa sim, está fixa no compose de propósito. A Evolution muda
o formato dos eventos entre versões maiores, e o sistema traduz esse
formato — deixar em `latest` é como as mensagens param de chegar de
madrugada sem ninguém ter tocado em nada. Ao atualizar, teste recebendo
uma mensagem antes de considerar feito.

---

## Checklist rápido pra saber se está tudo certo

- [ ] `https://sua-api.up.railway.app/api` responde (qualquer rota autenticada deve dar 401, não erro de conexão)
- [ ] Criar conta em `https://seu-app.vercel.app/register` funciona e leva pro dashboard
- [ ] Inbox conecta em tempo real (manda uma mensagem simulada e ela aparece sem dar F5)
- [ ] `/dashboard/ai` salva a API key do Gemini sem erro
- [ ] `/dashboard/settings` mostra a URL do webhook correta (com o domínio da API em produção, não `localhost`)
- [ ] Handshake do webhook: a Meta aceitou a URL sem erro ao salvar
- [ ] Mensagem real do WhatsApp chega no Inbox

## Coisas pra saber antes de escalar de verdade

### ⚠️ A API roda em UMA réplica. Não aumente esse número sem ler isto.

O botão de escalar horizontalmente no Railway parece inofensivo e não é: hoje o sistema tem duas coisas que assumem um único processo, e nenhuma delas dá erro ao ser violada — as duas simplesmente passam a se comportar errado, em silêncio.

- **Tempo real quebra pela metade.** O socket.io guarda as conexões na memória do processo, sem adaptador externo (Redis). Com duas réplicas, quem estiver conectado na réplica A não recebe a mensagem que chegou pelo webhook na réplica B: o balão não aparece, o contador não sobe, a notificação não toca. Recarregar a página resolve — e é exatamente por isso que o defeito demora a ser diagnosticado.

- **O cliente recebe a despedida duas vezes.** O encerramento automático (`AutoCloseService`) e a varredura de retenção (`RetentionSweepService`) rodam num `setInterval` dentro de cada processo. Duas réplicas, dois relógios: a mensagem de "vou encerrar por aqui" sai duplicada pro mesmo cliente.

Para escalar de verdade seria preciso, no mínimo, um adaptador de Redis no gateway e mover os dois trabalhos periódicos pra fora do processo web (um serviço próprio, ou um agendador externo chamando uma rota). Enquanto isso não existe: **uma réplica**.

- **Custo do Gemini**: cada empresa paga a própria conta do Google AI Studio — a plataforma não intermedia cobrança de IA.
- **Números de teste da Meta**: por padrão, um app novo só manda mensagem pra até 5 números cadastrados como testadores, até passar pela revisão do Meta (App Review) pedindo a permissão `whatsapp_business_messaging` pra produção.
### ⚠️ O número pode ser bloqueado, e isso não é hipótese remota

A conexão por QR code usa a Evolution, um cliente **não oficial** do WhatsApp. Isso viola os Termos de Serviço da Meta, e a conta pode ser bloqueada por padrão de comportamento — sem aviso, sem recurso e a qualquer momento. O que dá pra fazer é reduzir a probabilidade; o risco continua existindo por definição.

Por isso: **não use o número pessoal de ninguém**, e tenha um plano pro dia em que cair (segundo número, ou a migração pro canal oficial da Meta).

O que o sistema já faz sozinho:

- **Cadência de envio.** Toda mensagem sai com 1,5 s de espera e com o "digitando" aceso no aparelho do cliente. Sem isso, a IA respondendo dez conversas dispararia as dez no mesmo instante — o padrão que mais denuncia automação.
- **Confere o número antes da primeira abordagem.** Disparar pra número inexistente é o que quem varre faixas de número faz, e é dos sinais mais fortes de spam que existem. Um dígito errado no painel produzia exatamente esse sinal.
- **Teto de 30 primeiras abordagens por dia.** Responder quem escreveu **não tem limite** — não é isso que derruba conta. O teto vale só pra falar primeiro com quem nunca escreveu.

O que depende de você:

- **Aqueça o número.** Chip novo que conecta e já começa a disparar é o perfil clássico de conta descartável. Use normalmente por alguns dias antes de ligar o atendimento em volume.
- **Não use pra prospecção.** A tela de puxar conversa existe pra retomar um orçamento ou avisar que o pedido chegou — não pra oferecer serviço a quem não pediu. É o uso que mais bloqueia número.

- **Backup do `ENCRYPTION_KEY`**: se rotacionar essa chave sem migrar os dados já criptografados, toda API key e token de WhatsApp salvos ficam ilegíveis. Guarde em um cofre de senhas separado do resto.
