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
  Users,
} from "lucide-react";

/**
 * Fonte única das seções de Configurações: alimenta tanto o submenu da
 * barra lateral quanto a navegação interna da área. Duas listas iguais
 * mantidas na mão sempre divergem.
 */
export const SETTINGS_SECTIONS = [
  { href: "/dashboard/settings/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { href: "/dashboard/settings/inbox", label: "Atendimento", icon: Inbox },
  { href: "/dashboard/settings/ai", label: "IA", icon: Bot },
  { href: "/dashboard/settings/knowledge", label: "Conhecimento", icon: LibraryBig },
  { href: "/dashboard/settings/collection", label: "Dados a coletar", icon: ClipboardList },
  { href: "/dashboard/settings/routing", label: "Direcionamento", icon: Route },
  { href: "/dashboard/settings/queues", label: "Filas", icon: ListTree },
  { href: "/dashboard/settings/team", label: "Equipe", icon: Users },
  { href: "/dashboard/settings/permissions", label: "Permissões", icon: ShieldCheck },
  { href: "/dashboard/settings/storage", label: "Armazenamento", icon: HardDrive },
] as const;
