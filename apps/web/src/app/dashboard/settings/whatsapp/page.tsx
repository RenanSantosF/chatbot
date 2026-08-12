"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { WhatsAppSettingsCard } from "@/components/settings/whatsapp-settings-card";
import { PageSkeleton } from "@/components/page-skeleton";
import { apiFetch } from "@/lib/api-client";
import type { WhatsAppSettings } from "@/lib/types";

export default function WhatsappSettingsPage() {
  const [whatsapp, setWhatsapp] = useState<WhatsAppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<WhatsAppSettings>("/whatsapp/settings")
      .then(setWhatsapp)
      .catch(() => toast.error("Não deu pra carregar as configurações."))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !whatsapp) {
    return <PageSkeleton rows={2} />;
  }

  return <WhatsAppSettingsCard settings={whatsapp} onUpdated={setWhatsapp} />;
}
