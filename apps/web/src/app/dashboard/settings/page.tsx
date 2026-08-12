import { redirect } from "next/navigation";

/** A área de Configurações abre direto na primeira seção. */
export default function SettingsIndexPage() {
  redirect("/dashboard/settings/whatsapp");
}
