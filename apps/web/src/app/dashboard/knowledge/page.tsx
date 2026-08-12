"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DocumentList } from "@/components/knowledge/document-list";
import { UploadCard } from "@/components/knowledge/upload-card";
import { PageHeader } from "@/components/page-header";
import { PageSkeleton } from "@/components/page-skeleton";
import { apiFetch } from "@/lib/api-client";
import type { KnowledgeDocument } from "@/lib/types";

export default function KnowledgePage() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const result = await apiFetch<KnowledgeDocument[]>("/knowledge/documents");
        setDocuments(result);
      } catch {
        toast.error("Não deu pra carregar os documentos.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Conhecimento"
        description="Documentos que a IA consulta pra responder com precisão."
      />

      {loading ? (
        <PageSkeleton rows={3} />
      ) : (
        <>
          <UploadCard onUploaded={(document) => setDocuments((prev) => [document, ...prev])} />
          <DocumentList documents={documents} onChange={setDocuments} />
        </>
      )}
    </div>
  );
}
