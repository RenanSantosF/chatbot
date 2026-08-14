import { Bot, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Uma conversa de verdade, parada, no topo da página.
 *
 * É a peça central por decisão: quem procura um sistema de atendimento não
 * quer ler o que ele faz, quer ver como fica. E a coisa mais própria deste
 * produto — a IA respondendo sozinha até o momento em que passa pra uma
 * pessoa — só se explica mostrando as duas na mesma tela.
 *
 * Usa os mesmos tokens de balão do painel (bubble-in / bubble-out) porque
 * não é ilustração: é o produto, com o mesmo verde que o cliente vai ver
 * depois de entrar.
 */

type Fala =
  | { de: "cliente"; texto: string; hora: string }
  | { de: "ia"; texto: string; hora: string }
  | { de: "atendente"; nome: string; texto: string; hora: string }
  | { de: "sistema"; texto: string };

const CONVERSA: Fala[] = [
  { de: "cliente", texto: "Boa tarde! Vocês fazem inventário?", hora: "14:02" },
  {
    de: "ia",
    texto:
      "Boa tarde! Fazemos sim, tanto judicial quanto extrajudicial. Para eu te orientar melhor: já existe processo aberto?",
    hora: "14:02",
  },
  { de: "cliente", texto: "Ainda não. O falecimento foi semana passada.", hora: "14:03" },
  {
    de: "ia",
    texto:
      "Sinto muito pela sua perda. Nesse caso o prazo para abrir é de 60 dias, então dá tempo com folga. Vou te passar para a nossa equipe de sucessões — pode me confirmar seu nome completo?",
    hora: "14:03",
  },
  { de: "sistema", texto: "Encaminhado para a equipe: o cliente relatou um caso com prazo." },
  {
    de: "atendente",
    nome: "Marina",
    texto: "Oi! Sou a Marina, do time de sucessões. Consigo te atender agora mesmo.",
    hora: "14:05",
  },
];

export function ConversaDemo() {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-[0_20px_60px_-24px_oklch(0_0_0/35%)]">
      <div className="flex items-center gap-3 border-b bg-card px-4 py-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
          RS
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Roberto Silveira</p>
          <p className="truncate text-xs text-muted-foreground">online agora</p>
        </div>
      </div>

      <div className="chat-wallpaper flex flex-col gap-2 p-4">
        {CONVERSA.map((fala, indice) => {
          if (fala.de === "sistema") {
            return (
              <div key={indice} className="flex justify-center py-1">
                <span className="max-w-[85%] rounded-full bg-bubble-in px-3 py-1 text-center text-[11px] font-medium text-muted-foreground shadow-xs">
                  {fala.texto}
                </span>
              </div>
            );
          }

          const doCliente = fala.de === "cliente";
          return (
            <div
              key={indice}
              className={cn("flex w-full", doCliente ? "justify-start" : "justify-end")}
            >
              <div
                className={cn(
                  "flex max-w-[85%] flex-col gap-0.5 rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed shadow-[0_1px_1px_oklch(0_0_0/6%)]",
                  doCliente
                    ? "rounded-bl-sm bg-bubble-in text-bubble-in-foreground"
                    : "rounded-br-sm bg-bubble-out text-bubble-out-foreground",
                )}
              >
                {fala.de === "atendente" ? (
                  <span className="text-[12px] font-semibold text-bubble-out-foreground/80">
                    {fala.nome}
                  </span>
                ) : null}

                <span className="text-pretty">{fala.texto}</span>

                <span
                  className={cn(
                    "flex items-center justify-end gap-1 text-[10px] leading-none",
                    doCliente ? "text-muted-foreground" : "text-bubble-out-foreground/70",
                  )}
                >
                  {fala.de === "ia" ? (
                    <span className="flex items-center gap-0.5 font-medium">
                      <Bot className="size-3" />
                      IA
                    </span>
                  ) : null}
                  <span>{fala.hora}</span>
                  {doCliente ? null : <CheckCheck className="size-3 text-sky-400" />}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
