import type { UserRole } from '../../../generated/prisma/client';

/**
 * Catálogo de tudo que pode ser liberado ou bloqueado por papel. O dono
 * nunca aparece aqui: OWNER passa por cima de qualquer regra por definição
 * (senão ele conseguiria se trancar pra fora da própria empresa).
 */
export const PERMISSION_CATALOG = [
  {
    group: 'Atendimento',
    items: [
      { key: 'conversations.send', label: 'Responder conversas' },
      { key: 'conversations.assign', label: 'Assumir e transferir conversas' },
      { key: 'conversations.resolve', label: 'Resolver e fechar conversas' },
      { key: 'conversations.priority', label: 'Mudar a prioridade' },
      { key: 'conversations.attachments', label: 'Enviar anexos' },
    ],
  },
  {
    group: 'Clientes e dados',
    items: [
      { key: 'customers.view', label: 'Ver a lista de clientes' },
      { key: 'metrics.view', label: 'Ver relatórios e indicadores' },
    ],
  },
  {
    group: 'Configuração',
    items: [
      { key: 'ai.manage', label: 'Configurar a IA' },
      { key: 'knowledge.manage', label: 'Gerenciar a base de conhecimento' },
      { key: 'queues.manage', label: 'Gerenciar filas' },
      { key: 'quickReplies.manage', label: 'Gerenciar respostas rápidas' },
      { key: 'routing.manage', label: 'Gerenciar regras de direcionamento' },
      { key: 'whatsapp.manage', label: 'Configurar o WhatsApp' },
      { key: 'team.manage', label: 'Gerenciar a equipe' },
    ],
  },
] as const;

export type PermissionKey =
  (typeof PERMISSION_CATALOG)[number]['items'][number]['key'];

export const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.flatMap((group) =>
  group.items.map((item) => item.key),
) as PermissionKey[];

/**
 * Padrão de fábrica de cada papel. Admin nasce com tudo (é o "quase dono"),
 * atendente só com o que precisa pra atender. O dono pode afrouxar ou
 * apertar qualquer um desses depois.
 */
export const PERMISSION_DEFAULTS: Record<
  Exclude<UserRole, 'OWNER'>,
  Record<PermissionKey, boolean>
> = {
  ADMIN: Object.fromEntries(ALL_PERMISSION_KEYS.map((key) => [key, true])) as Record<
    PermissionKey,
    boolean
  >,
  AGENT: {
    'conversations.send': true,
    'conversations.assign': true,
    'conversations.resolve': true,
    'conversations.priority': true,
    'conversations.attachments': true,
    'customers.view': true,
    'metrics.view': false,
    'ai.manage': false,
    'knowledge.manage': false,
    'queues.manage': false,
    // Usar é de todo mundo; editar, não. Resposta rápida guarda o que a
    // empresa fala pro cliente — dados bancários entre eles —, e um texto
    // trocado sai assinado pela empresa em toda conversa até alguém notar.
    'quickReplies.manage': false,
    'routing.manage': false,
    'whatsapp.manage': false,
    'team.manage': false,
  },
};
