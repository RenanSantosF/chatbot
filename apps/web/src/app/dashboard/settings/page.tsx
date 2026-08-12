"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { WhatsAppSettingsCard } from "@/components/settings/whatsapp-settings-card";
import { PageHeader } from "@/components/page-header";
import { PageSkeleton } from "@/components/page-skeleton";
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
      <PageHeader
        title="Configurações"
        description="Canais de atendimento e integrações da sua empresa."
      />

      {loading || !whatsapp ? (
        <PageSkeleton rows={2} />
      ) : (
        <WhatsAppSettingsCard settings={whatsapp} onUpdated={setWhatsapp} />
      )}
    </div>
  );
}
