import type { PrismaClient } from '../../../generated/prisma/client';

/**
 * Modelos isolados por tenant. Toda entidade nova que pertence a uma empresa
 * (Customer, Conversation, Message, Queue, AIInstruction...) entra aqui nas
 * próximas fases e passa a ser protegida automaticamente — ninguém precisa
 * lembrar de escrever `where: { tenantId }` em cada query do sistema.
 */
const TENANT_SCOPED_MODELS = new Set([
  'User',
  'Customer',
  'Conversation',
  'Message',
  'AiSettings',
  'AiInstruction',
  'KnowledgeDocument',
  'AiTool',
  'Task',
  'Queue',
  'QueueMember',
  'WhatsAppSettings',
  /*
   * A conexão por QR code é DA EMPRESA, e faltar aqui não era detalhe.
   *
   * Todo acesso a esta tabela passa por `findFirst()` sem `where` — o
   * serviço confia no isolamento desta lista pra achar "a sessão desta
   * empresa". Fora dela, o `findFirst` devolvia a PRIMEIRA linha da
   * plataforma inteira: a segunda empresa a conectar reescrevia a sessão
   * da primeira (mesmo segredo de webhook, nome de sessão trocado), o
   * painel de uma mostrava o estado da outra, e as mensagens de saída
   * iam pelo WhatsApp de quem não era.
   */
  'EvolutionSettings',
  'InboxSettings',
  'RoutingRule',
  'RolePermission',
  'CollectionField',
  'RetentionSettings',
  'BillingAccount',
  'CustomerNote',
  'AuditLog',
  // Mesma história das configurações da Evolution, com sintoma mais
  // visível: sem isolamento, a lista de etiquetas e a de respostas
  // rápidas mostravam as de todas as empresas juntas.
  'Tag',
  'ConversationTag',
  'QuickReply',
  // KnowledgeChunk não entra aqui: seu campo de embedding é Unsupported,
  // então toda leitura/escrita dele já é SQL raw (ver KnowledgeService),
  // que não passa pela extensão de query do Prisma de jeito nenhum — o
  // isolamento desse model é 100% manual, sempre filtrando tenantId no SQL.
]);

const WHERE_SCOPED_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);

/**
 * Camada central de isolamento multi-tenant: recebe um client "cru" do
 * Prisma e devolve uma versão que injeta/filtra tenantId automaticamente em
 * toda query de um modelo tenant-scoped. tenantId é passado explicitamente
 * (em vez de lido de um contexto assíncrono global) porque o agendamento
 * interno de queries do Prisma não preserva AsyncLocalStorage de forma
 * confiável — ver TenantPrismaService, que gera este client uma vez por
 * requisição já com o tenantId do usuário autenticado.
 */
export function applyTenantScope(client: PrismaClient, tenantId: string) {
  return client.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const scopedArgs = args as Record<string, any>;

          if (WHERE_SCOPED_OPERATIONS.has(operation)) {
            scopedArgs.where = { ...(scopedArgs.where ?? {}), tenantId };
          }

          if (operation === 'create') {
            scopedArgs.data = { ...(scopedArgs.data ?? {}), tenantId };
          }

          if (operation === 'createMany' || operation === 'createManyAndReturn') {
            // `data` aceita lista OU objeto único. Sem tratar o segundo
            // caso, um createMany com um registro só passava sem tenantId
            // — e o banco recusava a escrita (ou, pior, aceitaria se a
            // coluna algum dia ganhasse padrão).
            scopedArgs.data = Array.isArray(scopedArgs.data)
              ? scopedArgs.data.map((item: Record<string, any>) => ({ ...item, tenantId }))
              : { ...(scopedArgs.data ?? {}), tenantId };
          }

          if (operation === 'upsert') {
            scopedArgs.where = { ...(scopedArgs.where ?? {}), tenantId };
            scopedArgs.create = { ...(scopedArgs.create ?? {}), tenantId };
          }

          return query(scopedArgs);
        },
      },
    },
  });
}
