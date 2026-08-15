"use client";

import { ArrowRight, PartyPopper, SkipForward } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch } from "@/lib/api-client";
import { SITE_NAME } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * A conversa de chegada.
 *
 * Não é um formulário de cadastro adiado — é uma conversa. Cada passo tem
 * UMA pergunta, com respostas prontas pra clicar, e dá pra pular qualquer
 * uma. Isso não é gentileza: pergunta obrigatória num sistema que a pessoa
 * acabou de conhecer não produz dado melhor, produz dado inventado por
 * quem só queria passar da tela.
 *
 * A ordem também foi escolhida. Começa pelo que é fácil e sem risco
 * (quantas pessoas atendem), passa pelo que é orgulho (há quanto tempo
 * existe), e só então chega em faturamento — que tem a opção explícita de
 * não dizer. Perguntar dinheiro primeiro faria a tela inteira parecer
 * qualificação de vendas.
 */
interface Opcao {
  valor: string;
  rotulo: string;
}

interface Passo {
  campo: "atendentes" | "tempoDeMercado" | "faturamento" | "segmento" | "objetivo";
  pergunta: (nome: string) => string;
  ajuda?: string;
  opcoes?: Opcao[];
  placeholder?: string;
}

const PASSOS: Passo[] = [
  {
    campo: "atendentes",
    pergunta: (nome) => `Prazer, ${nome}! Quantas pessoas vão atender por aqui?`,
    ajuda: "Serve pra sabermos se vale organizar setores e rodízio desde já.",
    opcoes: [
      { valor: "SO_EU", rotulo: "Só eu, por enquanto" },
      { valor: "ATE_3", rotulo: "2 ou 3" },
      { valor: "ATE_10", rotulo: "Até 10" },
      { valor: "ATE_30", rotulo: "Até 30" },
      { valor: "MAIS_DE_30", rotulo: "Mais de 30" },
    ],
  },
  {
    campo: "tempoDeMercado",
    pergunta: () => "Há quanto tempo a empresa existe?",
    ajuda:
      "Empresa com estrada costuma ter muita conversa repetida — e é aí que a IA rende mais.",
    opcoes: [
      { valor: "COMECANDO", rotulo: "Estamos começando agora" },
      { valor: "ATE_2_ANOS", rotulo: "Até 2 anos" },
      { valor: "ATE_5_ANOS", rotulo: "Até 5 anos" },
      { valor: "ATE_10_ANOS", rotulo: "Até 10 anos" },
      { valor: "MAIS_DE_10", rotulo: "Mais de 10 anos" },
    ],
  },
  {
    campo: "segmento",
    pergunta: () => "E vocês trabalham com o quê?",
    ajuda: "Uma palavra basta: advocacia, transporte, clínica, loja…",
    placeholder: "Ex: escritório de advocacia",
  },
  {
    campo: "faturamento",
    pergunta: () => "Qual o porte da operação hoje?",
    ajuda: "Pergunta opcional de verdade — é só pra calibrarmos o plano certo pra você.",
    opcoes: [
      { valor: "ATE_20K", rotulo: "Até R$ 20 mil por mês" },
      { valor: "ATE_100K", rotulo: "Até R$ 100 mil" },
      { valor: "ATE_500K", rotulo: "Até R$ 500 mil" },
      { valor: "ACIMA_500K", rotulo: "Acima de R$ 500 mil" },
      { valor: "PREFIRO_NAO_DIZER", rotulo: "Prefiro não dizer" },
    ],
  },
  {
    campo: "objetivo",
    pergunta: () => "Por último: o que você quer que melhore no atendimento?",
    ajuda: "Escreve do seu jeito. A gente lê tudo, e isso guia o que construímos em seguida.",
    placeholder: "Ex: parar de perder mensagem no fim de semana",
  },
];

export function BoasVindas({
  primeiroNome,
  onConcluir,
}: {
  primeiroNome: string;
  onConcluir: () => void;
}) {
  const [indice, setIndice] = useState(0);
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);

  const passo = PASSOS[indice];
  const ultimo = indice === PASSOS.length - 1;

  async function encerrar(finais: Record<string, string>) {
    setSalvando(true);
    try {
      await apiFetch("/onboarding/perfil", {
        method: "POST",
        body: JSON.stringify(finais),
      });
    } catch {
      // Perfil é dado de apoio: falhar aqui não pode prender a pessoa numa
      // tela de boas-vindas que ela não consegue fechar.
    } finally {
      onConcluir();
    }
  }

  function avancar(valor?: string) {
    const finais = valor ? { ...respostas, [passo.campo]: valor } : respostas;
    setRespostas(finais);
    setTexto("");

    if (ultimo) void encerrar(finais);
    else setIndice((atual) => atual + 1);
  }

  async function dispensar() {
    setSalvando(true);
    try {
      await apiFetch("/onboarding/dispensar", { method: "POST" });
    } catch {
      /* mesmo motivo de cima */
    } finally {
      onConcluir();
    }
  }

  return (
    <div className="flex flex-col gap-5 rounded-xl border bg-card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2 text-xs font-medium text-primary">
          <PartyPopper className="size-4" />
          Bem-vindo à {SITE_NAME}
        </div>
        <div className="flex items-center gap-1.5">
          {PASSOS.map((item, i) => (
            <span
              key={item.campo}
              className={cn(
                "h-1 w-5 rounded-full transition-colors",
                i <= indice ? "bg-primary" : "bg-muted",
              )}
              aria-hidden
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold tracking-tight text-balance">
          {passo.pergunta(primeiroNome)}
        </h2>
        {passo.ajuda ? (
          <p className="text-sm text-muted-foreground text-pretty">{passo.ajuda}</p>
        ) : null}
      </div>

      {passo.opcoes ? (
        <div className="flex flex-wrap gap-2">
          {passo.opcoes.map((opcao) => (
            <Button
              key={opcao.valor}
              variant="outline"
              size="sm"
              disabled={salvando}
              onClick={() => avancar(opcao.valor)}
            >
              {opcao.rotulo}
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Label htmlFor="resposta" className="sr-only">
            Sua resposta
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="resposta"
              autoFocus
              value={texto}
              placeholder={passo.placeholder}
              maxLength={280}
              onChange={(evento) => setTexto(evento.target.value)}
              onKeyDown={(evento) => {
                if (evento.key === "Enter" && texto.trim()) avancar(texto.trim());
              }}
              className="max-w-md flex-1"
            />
            <Button
              size="sm"
              disabled={salvando || !texto.trim()}
              onClick={() => avancar(texto.trim())}
            >
              {salvando ? <Spinner /> : null}
              {ultimo ? "Concluir" : "Continuar"}
              <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 text-xs">
        <button
          type="button"
          disabled={salvando}
          onClick={() => avancar()}
          className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Pular esta
        </button>
        <span className="text-muted-foreground/40">·</span>
        <button
          type="button"
          disabled={salvando}
          onClick={() => void dispensar()}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <SkipForward className="size-3" />
          Deixar pra depois
        </button>
      </div>
    </div>
  );
}
