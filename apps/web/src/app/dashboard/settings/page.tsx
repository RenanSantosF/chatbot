"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { WhatsAppSettingsCard } from "@/components/settings/whatsapp-settings-card";
import { apiFetch } from "@/lib/api-client";
import type { WhatsAppSettings } from "@/lib/types";

export default function SettingsPage() {
  const [whatsapp, setWhatsapp] = useState<WhatsAppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<WhatsAppSettings>("/whatsapp/settings")
      .then(setWhatsapp)
      .catch(() => toast.error("Não deu pra carregar as configurações."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground">Canais de atendimento e integrações da sua empresa.</p>
      </div>

      {loading || !whatsapp ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <WhatsAppSettingsCard settings={whatsapp} onUpdated={setWhatsapp} />
      )}
    </div>
  );
}
