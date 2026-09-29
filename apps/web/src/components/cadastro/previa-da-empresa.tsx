"use client";

import { Bot, CheckCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { iniciais, primeiroNome } from "@/lib/cadastro";
import { cn } from "@/lib/utils";

/**
 * A empresa sendo montada ao vivo, enquanto a pessoa responde.
 *
 * Não é ilustração solta: é a conversa que o cliente DELA vai ter, com o
 * nome que ela acabou de digitar. Ver "Olá! Aqui é a assistente da
 * Clínica Sorriso" aparecer sozinho é o que faz o cadastro deixar de ser
 * formulário e virar o começo do produto.
 *
 * Enquanto o nome da empresa está sendo digitado, a IA "digita" também
 * (os três pontinhos) e só responde quando a pessoa para — trocar a frase
 * a cada tecla piscaria a tela inteira.
 */
export function PreviaDaEmpresa({
  empresa,
  responsavel,
  etapa,
}: {
  empresa: string;
  responsavel: string;
  /** Até onde o cadastro chegou: libera as partes da conversa aos poucos. */
  etapa: number;
}) {
  const nomeDaEmpresa = empresa.trim();
  const [estavel, setEstavel] = useState(nomeDaEmpresa);
  useEffect(() => {
    const espera = setTimeout(() => setEstavel(nomeDaEmpresa), 650);
    return () => clearTimeout(espera);
  }, [nomeDaEmpresa]);
  const digitando = nomeDaEmpresa !== estavel || !estavel;
  const pessoa = primeiroNome(responsavel);

  return (
    <div className="w-full max-w-sm">
      <div className="overflow-hidden rounded-3xl bg-white shadow-[0_40px_120px_-30px_oklch(0.62_0.15_165/55%)] ring-1 ring-white/10">
        <div className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3">
          <span
            className={cn(
              "flex size-10 items-center justify-center rounded-full text-sm font-semibold transition-colors duration-500",
              estavel
                ? "bg-primary text-primary-foreground"
                : "bg-neutral-100 text-neutral-400",
            )}
          >
            {iniciais(estavel) || <Bot className="size-4.5" />}
          </span>
          <div className="min-w-0">
            <p
              key={estavel}
              className="cadastro-entra truncate text-sm font-semibold text-neutral-950"
            >
              {estavel || "Sua empresa"}
            </p>
            <p className="flex items-center gap-1.5 text-xs text-neutral-500">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden />
              online · responde na hora
            </p>
          </div>
        </div>

        <div className="chat-wallpaper flex min-h-[340px] flex-col gap-2 p-4">
          <Balao lado="cliente" hora="23:41">
            Oi! Vocês atendem amanhã cedo?
          </Balao>

          {digitando ? (
            <div className="self-end rounded-lg rounded-tr-[3px] bg-bubble-out px-3 py-2.5 shadow-xs">
              <span
                className="cadastro-digitando flex gap-1"
                aria-label="Digitando"
              >
                <span className="size-1.5 rounded-full bg-bubble-out-foreground/60" />
                <span className="size-1.5 rounded-full bg-bubble-out-foreground/60" />
                <span className="size-1.5 rounded-full bg-bubble-out-foreground/60" />
              </span>
            </div>
          ) : (
            <Balao key={estavel} lado="ia" hora="23:41">
              Olá! Aqui é a assistente virtual da <strong>{estavel}</strong>.
              Atendemos sim, a partir das 8h. Quer que eu já reserve um horário?
            </Balao>
          )}

          {etapa >= 3 && !digitando ? (
            <Balao lado="cliente" hora="23:42">
              Quero! Às 9h dá?
            </Balao>
          ) : null}

          {etapa >= 4 && pessoa && !digitando ? (
            <div className="cadastro-entra flex justify-center py-1">
              <span className="rounded-full bg-bubble-in px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-xs">
                Reserva anotada — {pessoa} confirma de manhã
              </span>
            </div>
          ) : null}

          {etapa >= 6 && pessoa && !digitando ? (
            <Balao lado="atendente" hora="08:02" nome={pessoa}>
              Bom dia! Confirmado pras 9h. Até já 😊
            </Balao>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Balao({
  lado,
  hora,
  nome,
  children,
}: {
  lado: "cliente" | "ia" | "atendente";
  hora: string;
  nome?: string;
  children: React.ReactNode;
}) {
  const nosso = lado !== "cliente";
  return (
    <div
      className={cn(
        "cadastro-entra flex max-w-[85%] flex-col rounded-lg px-2.5 pt-1.5 pb-1 text-[13.5px] leading-[18px] shadow-xs",
        nosso
          ? "self-end rounded-tr-[3px] bg-bubble-out text-bubble-out-foreground"
          : "self-start rounded-tl-[3px] bg-bubble-in text-bubble-in-foreground",
      )}
    >
      {nome ? (
        <span className="text-[12px] font-medium opacity-75">{nome}</span>
      ) : null}
      <span>{children}</span>
      <span className="mt-0.5 flex items-center justify-end gap-1 self-end text-[10.5px] opacity-60">
        {lado === "ia" ? (
          <span className="inline-flex items-center gap-0.5 font-medium">
            <Bot className="size-3" />
            IA
          </span>
        ) : null}
        {hora}
        {nosso ? <CheckCheck className="size-3.5 text-sky-500" /> : null}
      </span>
    </div>
  );
}
