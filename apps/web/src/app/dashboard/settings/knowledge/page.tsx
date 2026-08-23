"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DocumentList } from "@/components/knowledge/document-list";
import { InstructionsManager } from "@/components/knowledge/instructions-manager";
import { UploadCard } from "@/components/knowledge/upload-card";
import { PageHeader } from "@/components/page-header";
import { PageSkeleton } from "@/components/page-skeleton";
import { apiFetch } from "@/lib/api-client";
import type { AiInstruction, KnowledgeDocument } from "@/lib/types";

/**
 * Tudo o que a IA sabe sobre a empresa, numa tela só.
 *
 * São duas formas de ensinar a mesma coisa, e elas viviam separadas: as
 * REGRAS ficavam em Configurações > IA, entre chave de API, modelo e
 * ferramentas, e os DOCUMENTOS aqui. A divisão seguia a arquitetura do
 * sistema, não a cabeça de quem usa: escrever "a consulta custa R$ 300" e
 * subir a tabela de preços em PDF são a mesma tarefa — dizer à IA o que
 * ela precisa responder.
 *
 * A ordem também importa. As regras vêm primeiro porque são o caminho
 * curto: escrever uma frase resolve o caso mais comum, e o documento é
 * pra quando o assunto não cabe numa frase.
 */
export default function KnowledgePage() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [instructions, setInstructions] = useState<AiInstruction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [docs, regras] = await Promise.all([
          apiFetch<KnowledgeDocument[]>("/knowledge/documents"),
          apiFetch<AiInstruction[]>("/ai/instructions"),
        ]);
        setDocuments(docs);
        setInstructions(regras);
      } catch {
        toast.error("Não deu pra carregar o conhecimento.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Conhecimento"
        description="O que a IA sabe sobre a sua empresa: regras escritas por você e documentos que ela consulta."
      />

      {loading ? (
        <PageSkeleton rows={3} />
      ) : (
        <>
          <InstructionsManager instructions={instructions} onChange={setInstructions} />

          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-[15px] font-semibold">Documentos</h2>
              <p className="text-sm text-muted-foreground text-pretty">
                Pra quando o assunto não cabe numa frase — tabela de preços,
                catálogo, manual.
              </p>
            </div>
            <UploadCard onUploaded={(document) => setDocuments((prev) => [document, ...prev])} />
            <DocumentList documents={documents} onChange={setDocuments} />
          </section>
        </>
      )}
    </div>
  );
}
