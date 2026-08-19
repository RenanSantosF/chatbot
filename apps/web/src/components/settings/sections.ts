import {
  Bot,
  Inbox,
  ClipboardList,
  HardDrive,
  LibraryBig,
  ListTree,
  MessageCircle,
  Route,
  ShieldCheck,
  TriangleAlert,
  Users,
} from "lucide-react";
import type { PermissionKey } from "@/lib/use-permissions";
import type { UserRole } from "@/lib/types";

/**
 * Fonte única das seções de Configurações: alimenta tanto o submenu da
 * barra lateral quanto a navegação interna da área. Duas listas iguais
 * mantidas na mão sempre divergem.
 *
 * Cada seção declara o que é preciso pra usá-la — a mesma exigência que o
 * controlador correspondente na API aplica. É o que permite a navegação
 * marcar como bloqueado o que a pessoa não pode abrir, em vez de deixá-la
 * clicar e receber um erro.
 */
export const SETTINGS_SECTIONS = [
  {
    href: "/dashboard/settings/whatsapp",
    label: "WhatsApp",
    icon: MessageCircle,
    permission: "whatsapp.manage",
  },
  // Atendimento mexe nas mesmas configurações de canal — na API é a mesma
  // permissão, e separar aqui daria a entender que são acessos diferentes.
  {
    href: "/dashboard/settings/inbox",
    label: "Atendimento",
    icon: Inbox,
    permission: "whatsapp.manage",
  },
  { href: "/dashboard/settings/ai", label: "IA", icon: Bot, permission: "ai.manage" },
  {
    href: "/dashboard/settings/knowledge",
    label: "Conhecimento",
    icon: LibraryBig,
    permission: "knowledge.manage",
  },
  {
    href: "/dashboard/settings/collection",
    label: "Dados a coletar",
    icon: ClipboardList,
    permission: "ai.manage",
  },
  {
    href: "/dashboard/settings/routing",
    label: "Direcionamento",
    icon: Route,
    permission: "routing.manage",
  },
  {
    // "Setores", e não "Filas".
    //
    // O sistema usava a mesma palavra pra duas coisas sem relação: aqui, o
    // DEPARTAMENTO pra onde a conversa é encaminhada (Jurídico, Financeiro),
    // e no Inbox, a FILA DE ESPERA — a ordem de quem aguarda resposta há
    // mais tempo. Quem lia "Filas" no menu não tinha como saber qual das
    // duas ia encontrar. A rota e o modelo continuam `queue`: o nome
    // interno não confunde ninguém, e trocá-lo custaria migração à toa.
    href: "/dashboard/settings/queues",
    label: "Setores",
    icon: ListTree,
    permission: "queues.manage",
  },
  // Equipe, Permissões e Armazenamento não passam por permissão granular:
  // o backend as tranca por papel, porque são as telas que definem quem
  // pode o quê e o que é apagado — deixar isso configurável se tornaria
  // uma forma de contornar as próprias regras.
  { href: "/dashboard/settings/team", label: "Equipe", icon: Users, roles: ["OWNER", "ADMIN"] },
  {
    href: "/dashboard/settings/permissions",
    label: "Permissões",
    icon: ShieldCheck,
    roles: ["OWNER"],
  },
  {
    href: "/dashboard/settings/storage",
    label: "Armazenamento",
    icon: HardDrive,
    roles: ["OWNER", "ADMIN"],
  },
  // Por último, e só pro dono: é a única tela daqui que não configura
  // nada — ela encerra a empresa e leva o histórico de todo mundo junto.
  {
    href: "/dashboard/settings/account",
    label: "Conta",
    icon: TriangleAlert,
    roles: ["OWNER"],
  },
] as const satisfies readonly {
  href: string;
  label: string;
  icon: typeof Inbox;
  permission?: PermissionKey;
  roles?: readonly UserRole[];
}[];

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/**
 * Se esta pessoa consegue abrir a seção. Recebe o resultado de
 * `usePermissions()` em vez de chamá-lo aqui pra continuar sendo função
 * pura — o mesmo cálculo serve pro submenu da barra lateral e pra
 * navegação de dentro de Configurações.
 */
export function podeAbrirSecao(
  section: SettingsSection,
  permissoes: {
    can: (key: PermissionKey) => boolean;
    hasRole: (...papeis: UserRole[]) => boolean;
  },
): boolean {
  if ("roles" in section && section.roles) {
    return permissoes.hasRole(...section.roles);
  }
  if ("permission" in section && section.permission) {
    return permissoes.can(section.permission);
  }
  return true;
}
