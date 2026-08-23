"use client";

import { BellOff, BellRing, Check, MonitorSmartphone } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useRealtime } from "@/components/realtime-provider";
import { suportaPush } from "@/lib/push";

/**
 * O controle de avisos que NÃO some.
 *
 * O botão da faixa do topo é um convite: ele aparece pra quem ainda não
 * decidiu e sai de cena quando a decisão é tomada. Isso deixava dois
 * buracos, e os dois davam no mesmo lugar — a pessoa não recebia aviso e
 * não tinha onde mexer nisso:
 *
 * - quem clicou em "Bloquear" na caixinha do navegador via o sino
 *   desaparecer para sempre, sem nunca saber que existia um caminho de
 *   volta (e o caminho existe: é nas permissões do site, não aqui);
 * - quem ativou e depois quis desligar não tinha como, a não ser mexendo
 *   nas configurações do navegador.
 *
 * Aqui os três estados são visíveis e nomeados. E o que ele afirma é
 * sempre sobre ESTE aparelho: a inscrição é por navegador, então quem usa
 * o celular e o computador precisa ligar nos dois — dizer "ativado" no
 * telefone porque o desktop está inscrito seria a pior mentira possível.
 */
/** Nunca muda depois que a página carrega — é uma característica do navegador. */
const naoMuda = () => () => {};

/**
 * Este navegador recebe aviso do sistema?
 *
 * Pelo `useSyncExternalStore` e não por um efeito que chama `setState`: o
 * servidor não tem `navigator` e responderia "não" por todo mundo. Aqui
 * ele responde `null` — "ainda não sei" — e o cliente já entra com a
 * resposta certa no primeiro render, sem um quadro dizendo a coisa errada.
 */
function useSuportaPush(): boolean | null {
  return useSyncExternalStore(naoMuda, suportaPush, () => null);
}

export function AvisosCard() {
  const {
    notifPermission,
    enableNotifications,
    avisosNesteAparelho,
    disableNotifications,
  } = useRealtime();
  const [ocupado, setOcupado] = useState(false);

  const suporta = useSuportaPush();

  async function alternar() {
    setOcupado(true);
    try {
      if (avisosNesteAparelho) await disableNotifications();
      else await enableNotifications();
    } finally {
      setOcupado(false);
    }
  }

  const bloqueado = notifPermission === "denied";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-4" />
          Avisos de mensagem nova
        </CardTitle>
        <CardDescription className="text-pretty">
          Recebe um aviso do sistema quando um cliente escreve, mesmo com o
          painel fechado. A configuração é por aparelho — ligue no celular e no
          computador separadamente.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {suporta === false ? (
          <p className="text-sm text-muted-foreground text-pretty">
            Este navegador não recebe avisos do sistema. No iPhone é preciso
            primeiro adicionar o painel à tela de início (Compartilhar &gt;
            Adicionar à Tela de Início) e abrir por lá.
          </p>
        ) : bloqueado ? (
          /*
           * Bloqueado não é um botão, é uma instrução.
           *
           * Depois de "Bloquear", o navegador ignora qualquer novo pedido
           * — chamar `requestPermission()` aqui devolveria "denied" na
           * hora, sem mostrar nada, e o botão pareceria quebrado. O
           * caminho de volta passa pelas permissões do site, e é isso que
           * a pessoa precisa ler.
           */
          <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
              <BellOff className="size-4 shrink-0" />
              Os avisos estão bloqueados neste navegador
            </p>
            <p className="text-xs text-amber-800/90 text-pretty dark:text-amber-300/90">
              O bloqueio foi dado ao site e só você pode desfazer. No computador,
              clique no cadeado ao lado do endereço &gt; Notificações &gt;
              Permitir. No Android, Configurações do site &gt; Notificações.
              Depois recarregue esta página.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={alternar} disabled={ocupado || suporta === null}>
              {avisosNesteAparelho ? (
                <>
                  <BellOff className="size-4" />
                  Desativar neste aparelho
                </>
              ) : (
                <>
                  <BellRing className="size-4" />
                  Ativar neste aparelho
                </>
              )}
            </Button>
            {avisosNesteAparelho ? (
              <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
                <Check className="size-4" />
                Ativado aqui
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MonitorSmartphone className="size-4" />
                Desligado neste aparelho
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
