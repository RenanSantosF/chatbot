import { Bot, LibraryBig, ListTree, MessageCircle, Route, ShieldCheck, Users } from "lucide-react";

/**
 * Fonte única das seções de Configurações: alimenta tanto o submenu da
 * barra lateral quanto a navegação interna da área. Duas listas iguais
 * mantidas na mão sempre divergem.
 */
export const SETTINGS_SECTIONS = [
  { href: "/dashboard/settings/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { href: "/dashboard/settings/ai", label: "IA", icon: Bot },
  { href: "/dashboard/knowledge", label: "Conhecimento", icon: LibraryBig },
  { href: "/dashboard/settings/routing", label: "Direcionamento", icon: Route },
  { href: "/dashboard/settings/queues", label: "Filas", icon: ListTree },
  { href: "/dashboard/settings/team", label: "Equipe", icon: Users },
  { href: "/dashboard/settings/permissions", label: "Permissões", icon: ShieldCheck },
] as const;
