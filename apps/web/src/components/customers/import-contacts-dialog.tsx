"use client";

import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";

interface ImportResult {
  criados: number;
  atualizados: number;
  recusados: { line: number; reason: string }[];
}

export function ImportContactsDialog({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function upload(file: File) {
    setSending(true);
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const report = await apiFetch<ImportResult>("/customers/import", {
        method: "POST",
        body,
      });
      setResult(report);
      onImported();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Não deu pra importar o arquivo.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button size="sm" variant="outline">
            <Upload className="size-4" />
            Importar contatos
          </Button>
        }
      />
      <SheetContent className="gap-0 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Importar contatos</SheetTitle>
          <SheetDescription>
            Um arquivo CSV com colunas de nome e telefone. Os cabeçalhos podem ser
            &quot;nome/telefone&quot;, &quot;name/phone&quot;, &quot;celular&quot;,
            &quot;whatsapp&quot; — a gente reconhece.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 py-2">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
          <Button onClick={() => inputRef.current?.click()} disabled={sending}>
            {sending ? "Importando..." : "Escolher arquivo CSV"}
          </Button>

          <div className="rounded-md bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">Exemplo</p>
            <pre className="overflow-x-auto">{`nome;telefone;email
Maria Souza;27 99999-8888;maria@exemplo.com
João Lima;+55 11 98888-7777;`}</pre>
            <p className="mt-2">
              Telefone sem DDI recebe o 55 automaticamente. Quem já está cadastrado não é
              sobrescrito — só preenchemos o que estava em branco.
            </p>
          </div>

          {result ? (
            <div className="flex flex-col gap-2 text-sm">
              <p>
                <strong>{result.criados}</strong> criados ·{" "}
                <strong>{result.atualizados}</strong> atualizados
              </p>
              {result.recusados.length > 0 ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                  <p className="mb-1 text-xs font-medium">
                    {result.recusados.length} linha(s) não entraram:
                  </p>
                  <ul className="max-h-40 overflow-y-auto text-xs text-muted-foreground">
                    {result.recusados.map((item) => (
                      <li key={item.line}>
                        Linha {item.line}: {item.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
