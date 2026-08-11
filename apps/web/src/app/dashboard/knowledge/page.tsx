"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DocumentList } from "@/components/knowledge/document-list";
import { UploadCard } from "@/components/knowledge/upload-card";
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Conhecimento</h1>
        <p className="text-muted-foreground">Documentos que a IA consulta pra responder com precisão.</p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <>
          <UploadCard onUploaded={(document) => setDocuments((prev) => [document, ...prev])} />
          <DocumentList documents={documents} onChange={setDocuments} />
        </>
      )}
    </div>
  );
}
